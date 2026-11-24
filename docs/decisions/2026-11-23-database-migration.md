# 数据库迁移决策：JSON 文件 → PostgreSQL

日期：2026-11-23
状态：已采纳；阶段 1 已完成，本机已切换到 PostgreSQL（2026-11-23）
关联：`2026-09-09-user-data-storage.md`（F1 跨进程并发写残留、升级触发条件）

## 背景

项目目标从「单机自用」转向「可商业化」，已满足 `2026-09-09-user-data-storage.md` 中「必须升级为正式数据库」的触发条件（多实例部署、多设备共享数据）。现状问题：

1. **单文件全量读写**：`data/server/users.json` 每次写入都要读取→修改→整体覆盖，`writeQueue` 只在同一进程内串行，无法多实例部署。
2. **整包上传、后写覆盖**：客户端 `saveData()` 每次把完整 `AppData` 推给 `PUT /api/data`（上限 8MB），多设备同时使用时后保存的静默覆盖先保存的。
3. **错题冗余整题副本**：`ErrorEntry.question` 存完整 `Question`，用户数据随错题膨胀；题目修正后错题本仍是旧内容。
4. **题库整包下发**：客户端一次下载约 20MB 的 `public/mobile-data/gkzhenti_questions.min.json`（5242 题），首屏慢且可被整体扒取；`/api/gkzhenti` 每次请求都同步读取并解析约 22MB 的 `data/gkzhenti_questions.json`。

有利条件：`lib/server/store.ts` 已将存储封装为 `createUser / verifyUser / createSession / getUserBySession / deleteSession / getUserData / saveUserData / recordUsage / getUsageSummary`，替换底层不影响 API 与前端；当前仅 2 个用户，数据迁移风险极低。

## 决策

- 数据库：**PostgreSQL**（生产使用国内云托管 RDS，与应用同地域，配合 ICP 备案）。
- 访问层：**Drizzle ORM**（类型安全、无额外引擎二进制、Docker 镜像小）。
- 方式：**分 4 个阶段**渐进迁移，每阶段可独立上线、独立回滚。

## 备选方案

| 方案 | 不选的原因 |
|---|---|
| 继续 JSON 文件 + 文件锁 | 既有决策已明确：多副本下文件锁无效，应换共享数据库而不是补锁 |
| SQLite | 单机文件库，同样无法多实例共享 |
| MySQL | 可行；但 PG 原生 JSONB 便于阶段 1 原样存放 `AppData`，并有 `pg_trgm` 支持题库中文模糊搜索 |
| Prisma | 可行；需要额外查询引擎、镜像更大、冷启动更慢 |
| Supabase / BaaS | 境外服务不利于国内合规与备案；托管 RDS 更可控 |

## 分阶段计划

### 阶段 1：换底层存储，接口不变
- 新增环境变量 `STORAGE_DRIVER=json|pg`（默认 `json`）、`DATABASE_URL`。
- `store.ts` 拆为存储接口 + JSON 实现（现有逻辑原样保留）+ PG 实现。
- 表：`users`、`sessions`、`usage_records`、`user_app_data(user_id, data JSONB, version, updated_at)`。
- 保存使用乐观锁 `WHERE version = ?`，版本冲突返回 409「数据已在其他设备更新」，不再静默覆盖。
- 迁移脚本 `scripts/migrate-json-to-pg.mjs`：幂等、可重复执行，完成后校验条数；**只读 `users.json`，不删除不修改**。
- `docker-compose.yml` 增加 postgres 服务；`npm test` 对两种驱动各跑一遍。
- 回滚：`STORAGE_DRIVER=json`，原文件始终保留。

### 阶段 2：拆分学习数据，增量保存（2026-11-23 调整为 2a / 2b / 2c 三步）
- **2a 多设备防覆盖**：`GET /api/data` 返回 `version`；`PUT` 带 `If-Match` 做乐观锁，冲突回 409 并附服务端最新数据；
  客户端把每次修改记成操作（op），冲突时以服务端数据为底重放本机未确认的操作再保存。JSON 驱动同样维护版本号。
- **2b 作答流水**：新增 `answer_records` 与 `POST /api/answers`，作答/复习时追加一条，先只写不读，为排名、估分、推荐积累数据。
- **2c 服务端统计 + 瘦身**：掌握度、错因分布、每日统计改为 SQL 聚合；拆 `error_entries` 只存 `question_id`（去掉整题副本）；
  `PUT /api/data` 降级为只存设置。**依赖阶段 3 题库入库**（服务端需要题目内容），因此与阶段 3 一起做。
- 调整原因：原计划一次拆完所有表，但错题去整题副本依赖题库入库；拆成三步后每步都小、可单独上线和回滚。

### 阶段 3：题库入库
- 表：`papers`、`questions`、`materials`；解析带来源与版本字段（配合题库版权清理与 AI 重写解析）。
- 新增 `GET /api/questions?module=&year=&paper=&cursor=` 游标分页；`pg_trgm` 中文模糊搜索。
- 下线 20MB 静态题库；App 离线改为按试卷下载离线包；解析等付费内容只经接口获取。

### 阶段 4：上线前加固
- 限流与 AI 每日额度（Redis 或先用 PG 表）。
- 每日自动备份 + 按时间点恢复（PITR）。
- App 端鉴权改为 Bearer Token（跨域下 HttpOnly Cookie 受限），网页端继续使用 Cookie。

## 阶段 1 改动范围

- `lib/server/store.ts`：拆分存储接口与两种实现
- 新增 `lib/server/db/schema.ts`、`drizzle.config.ts`、`scripts/migrate-json-to-pg.mjs`
- `scripts/verify-store.mjs`：双驱动回归
- `docker-compose.yml`、`.env.example`：postgres 服务与 `DATABASE_URL`
- 前端与 API 路由不改动

## 阶段 1 实施记录（2026-11-23）

- 实施时调整：阶段 1 **未引入 Drizzle**，改用 `pg` + 手写 SQL 迁移（`db/migrations/*.sql` + `scripts/db-migrate.mjs`）。
  原因：阶段 1 只有 4 张表、十来条 SQL，少一个依赖、少一层抽象；且现有回归测试靠 TypeScript 转译加载源码，纯 `pg` 更易测。
  阶段 2 表数量增加时再评估是否引入 Drizzle，届时另写记录。
- 文件：`lib/server/store-pg.ts`（只做 SQL）、`lib/server/store.ts`（按 `STORAGE_DRIVER` 分流，业务规则两驱动共用）、
  `scripts/migrate-json-to-pg.mjs`、`scripts/verify-store-pg.mjs`、`docker-compose.yml` 增加 postgres 服务。
- `PUT /api/data` 契约未变（整包无条件保存，与 JSON 驱动行为一致）；乐观锁已在存储层实现
  （`saveUserDataVersioned` / `getUserDataWithVersion`），阶段 2 接入前端并返回 409。
- 切换步骤：备份 `users.json` → `npm run db:migrate` → `npm run db:import-json` → 核对条数 → 设 `STORAGE_DRIVER=pg` 重启。
  回滚：改回 `STORAGE_DRIVER=json` 重启。

- 验证结果（2026-11-23）：`tsc` 通过；JSON 驱动 23/23 + 客户端 18/18；PG 驱动 19/19；`db:import-json --dry-run` 正确识别 2 用户 / 1 会话 / 2 学习数据 / 1 用量；`next build` 通过，无需为 `pg` 额外配置。
- 踩坑：本机 5432 已被其它 PostgreSQL 占用，compose 容器起不来，测试连到了别的库报「密码认证失败」。已把宿主机端口默认改为 5433（`POSTGRES_HOST_PORT` 可改）。防再犯：报 28P01 时先查端口是否连错了库。

- 切换记录（2026-11-23）：备份 `data/server/users.json.before-pg-20261123` → `npm run db:import-json` 核对 2 用户 / 2 学习数据 / 1 用量全部一致 → `.env.local` 追加 `STORAGE_DRIVER=pg`。
  接口冒烟 `node scripts/smoke-api.mjs` 10/10 通过（注册、会话、两次保存、读回、用量、登出后 401、重新登录后数据仍在）；PG 中测试账号 `user_app_data.version=2`；`users.json` 与备份 SHA-256 一致，确认切换后不再写入。
- 踩坑：Windows 下用 curl/PowerShell 发含中文的 JSON，请求体编码出错，注册返回 400「账号格式不合法」，看起来像校验 bug。防再犯：接口冒烟一律用 `scripts/smoke-api.mjs`（Node fetch，UTF-8），不要手写 curl。

## 阶段 2a 实施记录（2026-11-23）

- 接口契约（`app/api/data/route.ts`）：
  - `GET` → `{ data, version }`，无数据时 `version=0`。
  - `PUT` + `If-Match: <version>` → 一致则保存并返回 `{ ok, version }`；不一致 409 `{ error, data, version }`；格式错误 400。
  - `PUT` 不带 `If-Match` → 兼容旧客户端（已安装的 APK），无条件保存，但版本照样 +1，让其它设备在下次保存时感知并合并。
- 服务端：`lib/server/store.ts` 的 `saveUserDataVersioned` / `getUserDataWithVersion` 两种驱动都支持；JSON 驱动新增 `appDataVersion`，
  旧库已有数据视为版本 1（与 PG 导入口径一致）；`saveUserData` 返回新版本号。
- 客户端：`lib/store.ts` 内部修改统一走 `mutate(op)`；外部 `saveData`（百宝箱）按顶层字段差异记成「覆盖这些字段」的操作，冲突时不抹掉其它设备的进度。
  冲突最多重试 3 次；离线时操作留在队列（上限 500 条），恢复联网后一并保存；`hydrateData` 先等待待保存修改发出，再拉取并重放。
  冲突合并后发出 `gongkao:data-synced` 事件，`AuthGate` 弹提示「已同步其他设备的学习进度」。
- 已知限制：冲突合并后，已经打开的页面不会自动刷新显示（下次进入页面或刷新即可看到合并结果）；需要时页面可监听同一事件自行刷新。

## 阶段 2b 实施记录（2026-11-24）

- 表：`db/migrations/002_answer_records.sql` 新建 `answer_records`（id / user_id / question_id / module / sub_module /
  user_answer / is_correct / is_review / minutes_spent / answered_at / local_date），三个索引分别服务
  「最近作答」「按日聚合」「同题历史」。`user_id` 外键 `ON DELETE CASCADE`。
- 为什么冗余存 module / sub_module：阶段 3 题库入库前，统计不该回表题库；入库后可改为外键，届时另写记录。
- 接口：`POST /api/answers`（`app/api/answers/route.ts`），只写不读，`GET /api/data` 的整包口径不变，客户端可不改造先接入。
  校验：`questionId` 非空、`localDate` 必须 `YYYY-MM-DD`、`isCorrect` 必须布尔，否则 400；`userAnswer` 数组按逗号拼接。
- 失败语义：流水是旁路数据，写失败返回 **202 + stored:false** 而不是 5xx，避免把整道题判为失败。
- 两种驱动都实现：PG 走 `insertAnswerRecord` / `countAnswerRecords`；JSON 驱动写入 `users.json` 的 `answerRecords` 数组。
- 验证：JSON 驱动 35/35（新增 A1/A2/A4/A5）、PG 驱动 25/25（新增 A1–A6，含级联删除）、
  `scripts/smoke-answers.mjs` 端到端 8/8（401 / 注册 / 作答 / 数组答案 / 三种 400 / 最小字段）。
- CI：`ci.yml` 拆成 `test`（JSON + 客户端）与 `postgres`（services.postgres:16-alpine + healthcheck）两个 job，
  `TEST_DATABASE_URL` 指向库名含 `test` 的库（防误删保护）。
- 踩坑：`readDatabase()` 原先把解析结果逐字段挑出来重建对象，新增 `answerRecords` 后忘了在这里补字段，
  导致写入成功但读取恒为空。防再犯：`Database` 加字段时必须同时改 `readDatabase()` 的返回对象与结构校验，
  并且两种驱动各写一条读取断言——这次正是 PG 全绿、JSON 三条红才暴露出问题。

## 不变量与防再犯检查

- 沿用 F4 不变量：读取失败不得降级为空库再写回；PG 实现中查询错误一律抛出，不返回空数据。
- 迁移脚本不得删除或修改源 `users.json`；切换驱动前先完成备份。
- 任何新的保存路径必须带版本校验，禁止无条件整包覆盖；不带 `If-Match` 的旧路径只为兼容已发布客户端保留，并且必须让版本 +1。
- 客户端新增修改函数必须走 `mutate(op)`，op 只能读写传入的 `data` 参数（冲突时会在服务端数据上重放），不得捕获外部的 data 对象。
- 阶段 1 新增依赖仅 `pg`（及开发依赖 `@types/pg`）；新增其它依赖前在此记录。

## 排查记录：S1 假红（2026-11-23）

- 现象：`npm test` 中客户端 store 29/30，唯一失败项「S1 保存时带上服务端版本号」，断言期望 `If-Match` 为 `3,4`，实际是 `11,12`。
- 定位过程：插桩记录每次 PUT 的时刻与阶段，发现 `await store.hydrateData()` 内并发出现 **8 条不带 `If-Match` 的 PUT**，把假服务端版本从 3 推到 11。
  单独抽离 S1 用例运行（跳过前序用例块）时全部通过 → 判定为**用例间状态污染**，而非 `lib/store.ts` 缺陷。
- 根因：`verify-client-store.mjs` 中各用例块共用 `globalThis.fetch`，前序用例留下的 `saveQueue` 承诺链在下一个用例的 fetch 生效后才补发请求，
  被同一台假服务端记进 `puts`，污染了 S1/S2 的断言。
- 修法：`syncStore()` 前先让微任务跑完，`settle(run)` 包住用例主体并再次清空微任务；断言只统计带 `If-Match` 的 PUT；S2 拆成独立用例块并重置 `puts`。
- 防再犯：新增同步相关用例时，必须先用 `await settle(...)` 或前置微任务排空建立边界，禁止直接复用其他用例的 `server.state.puts`；
  断言里出现「PUT 次数」时，优先过滤 `ifMatch !== undefined` 再比较，避免把无版本号的兼容路径计入。
