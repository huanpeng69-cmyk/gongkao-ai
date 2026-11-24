# 公考私教

公考刷题、模考、错题复习、百宝箱工具和 AI 讲解一体化学习应用。基于 Next.js（App Router）+ TypeScript + Tailwind，账号与学习数据由 Node 服务端持久化，移动端可通过 Capacitor 打包为 Android / iOS 应用。

## 界面预览

![公考私教学习主页](docs/images/home-dashboard.png)
学习主页：集中查看刷题数据、今日计划和 AI 私教讲解入口。

![真题题库解析页](docs/images/question-bank-explanation.png)
真题题库：展示作答结果、正确答案和粉笔解析内容。

![AI 漫画讲解](docs/images/ai-comic-explanation.jpg)
漫画讲解：把题目思路拆成分镜，便于复盘关键步骤。

![备考百宝箱三视图训练](docs/images/toolbox-three-views.jpg)
备考百宝箱：提供空间重构、截面图和三视图等训练工具。

## 功能

- **学习主页**：今日计划、累计题量与正确率、今日学习时长、AI 私教入口。
- **真题题库**（`/quiz`）：搜索、考试 / 年份 / 试卷筛选、材料题组练习；「练习范围」分段（全部 / 未做 / 错题 / 薄弱专项）；`/quiz?ids=` 载入精确题集用于定向重练（上限 120 题）；单题计时并计入当日学习时长；AI 讲错因按需触发，不预跑模型。
- **真题模考**（`/mock`）：按整套试卷出题（不剔除旧作答）、整卷计时、答题卡、交卷评分，并给出整卷与分模块报告；交卷时按实际用时一次性结算当日学习时长。
- **错题复习**（`/review`）：按复习计划回看错题、按错因筛选、AI 错因讲解与分类、「按此重练」把题号回填到题库页、导出 Markdown 笔记。
- **学习统计**（`/stats`）：日 / 周题量与正确率、今日学习时长。
- **Token 用量看板**（`/usage`）：按日汇总 AI 调用与输入 / 输出 Token。
- **备考百宝箱**（`/toolbox`）：资料分析、空间重构、截面图、三视图、记忆卡片等工具。
- **账号体系**（`/login`）：注册 / 登录，会话使用 HttpOnly Cookie，用户数据由服务端保存。
- **AI 设置**：文本讲解与生图接口均从系统设置或运行环境读取，仓库中不内置 API Key。

## 技术栈与目录

Next.js 14 App Router、React 18、TypeScript、Tailwind CSS、Three.js、Capacitor 8；测试为零依赖的 Node 脚本。

```text
app/           页面路由与 /api（ai、image、usage、auth、data、gkzhenti）
components/    共享组件（侧栏、底部导航、AuthGate 等）
lib/           客户端 store、类型定义、AI 客户端、题库解析
lib/server/    服务端 JSON 存储与鉴权
scripts/       题库导入 / 审计、移动端资源准备、回归测试
docs/          部署文档、决策记录、界面截图
data/          题库与运行数据（data/server/ 已被忽略）
```

## 本地运行

```bash
npm install
copy .env.example .env
npm run dev
```

打开 `http://localhost:3000`。

## 测试与 CI
```bash
npm test              # 服务端 store 31 条 + 客户端 store 30 条断言
npx tsc --noEmit      # 类型检查
```

PostgreSQL 驱动另有独立回归（需一个库名含 `test` 的空库，测试会清空其中的表）：

```bash
set TEST_DATABASE_URL=postgres://gongkao:change-me@localhost:5433/gongkao_test
npm run test:pg       # 25 条：建表、注册、会话、版本冲突、用量、作答流水
```

- `scripts/verify-store.mjs`：服务端 JSON 存储的并发写入、会话、用量记录与复习队列。
- `scripts/verify-client-store.mjs`：客户端 store 的首刷幂等、按题计时、学习时长入账、错题队列不截断、多设备冲突重放。
- `scripts/verify-store-pg.mjs`：PostgreSQL 驱动的同一批契约，外加乐观锁、用户隔离与作答流水级联删除。
- `scripts/smoke-api.mjs`：真实 HTTP 冒烟，覆盖注册 / 会话 / 保存 / 版本冲突 / 用量。
- `scripts/smoke-answers.mjs`：`POST /api/answers` 冒烟，覆盖 401、四种合法与非法入参与数组答案。

`.github/workflows/ci.yml` 在 push 到 `main` 和所有 Pull Request 上执行类型检查与上述测试（含 PostgreSQL 服务）；`deploy-pages.yml` 负责静态站发布，`site-health.yml` 每 30 分钟检查线上站点与 DNS。

## 用户数据存储

账号、密码校验信息、答题记录、错题本和学习统计由 Node 服务端保存，登录状态使用 HttpOnly Cookie；浏览器 `localStorage` 仅保留界面偏好和非敏感的展示信息。

存储后端由 `STORAGE_DRIVER` 决定，业务规则与接口在两种驱动下完全一致：

| 驱动 | 取值 | 适用场景 |
|---|---|---|
| JSON 文件 | `json`（默认） | 单机自用、本地开发；`data/server/users.json` 全量读写，仅在单进程内串行 |
| PostgreSQL | `pg` | 多实例部署、多设备共享数据；需要 `DATABASE_URL` |

JSON 驱动的默认目录是 `data/server/users.json`（已加入 `.gitignore`），部署时必须把 `GONGKAO_DATA_DIR` 指向持久化磁盘或挂载卷。JSON 文件存储只在单实例常驻进程下成立，多副本部署请切到 PostgreSQL。

### 切换到 PostgreSQL

```bash
# 1. 备份现有数据（脚本只读 users.json，不删不改）
cp data/server/users.json data/server/users.json.before-pg

# 2. 起库并建表
docker compose up -d postgres
npm run db:migrate

# 3. 幂等导入（可重复执行，完成后自动核对条数）
npm run db:import-json            # 加 -- --dry-run 只预览不写入

# 4. 在 .env.local 设置并重启
STORAGE_DRIVER=pg
DATABASE_URL=postgres://gongkao:change-me@localhost:5433/gongkao
```

回滚：把 `STORAGE_DRIVER` 改回 `json` 后重启，原 `users.json` 始终保留、未被修改。

Windows 下也可以用仓库根的 `切换到PostgreSQL.bat`（备份 → 起库 → 导入 → 写 `.env.local`，任一步失败即停）和 `验证数据库迁移.bat`（串起类型检查、两种驱动的测试、导入预览与构建）。

> 宿主机端口默认 `5433`：本机常已占用 5432，容器直接绑 5432 会冲突或连到别的库。若报 `28P01 密码认证失败`，先确认连的是不是 `gongkao-postgres` 容器。

多设备同时保存时，接口用版本号 + `If-Match` 做乐观锁：冲突返回 409 并附服务端最新数据，客户端以服务端数据为底重放本机未确认的操作，不再静默覆盖。

GitHub Pages 等纯静态托管没有服务端 API 和持久化数据库，不适合承载登录及用户数据；需要使用 `npm run dev` / `npm start` 的 Node 服务，或接入正式数据库后再对外部署。

## Agnes AI 配置

文字讲解和漫画生图已统一使用 Agnes AI：

- 网关：`https://apihub.agnes-ai.com/v1`
- 文字：`POST /v1/chat/completions`
- 图片：`POST /v1/images/generations`
- 鉴权：`Authorization: Bearer <AGNES_API_KEY>`

托管网页推荐只在服务端配置：

- `AGNES_API_KEY`
- `AI_TEXT_MODEL`（默认 `agnes-2.0-flash`）
- `AI_IMAGE_MODEL`（默认 `agnes-image-2.1-flash`）
- `AI_IMAGE_SIZE`（默认 `1K`）
- `AI_IMAGE_RATIO`（默认 `1:1`）

应用内「我的 / Agnes AI 接口」可为静态站点或 Capacitor 客户端保存设备 Key。留空保存会保留已有 Key；旧供应商 Key 不会迁移或发送到 Agnes 域名。浏览器设备存储不是加密保险箱，公开网站应使用 `/api/ai` 与 `/api/image` 服务端代理。

`EMBED_PUBLIC_AI_KEYS=1` 只适合完全私有的移动构建，它会把 `AGNES_API_KEY` 注入客户端包。公开网站、GitHub Pages 和公开分发 APK 不要开启。

## Web 构建

```bash
npm run build
```

移动端静态导出：

```bash
npm run build:mobile
```

## Android / iOS 打包

Android 需准备 Android SDK 和 JDK 21：

```bash
npm run build:mobile
npx cap sync android
cd android
gradlew assembleDebug
```

生成文件：`android/app/build/outputs/apk/debug/app-debug.apk`。iOS 侧使用 `npm run ios:sync` 同步后用 Xcode 运行。

`capacitor.config.ts` 读取 `CAP_SERVER_URL`：留空时 WebView 加载本地 `out/` 静态包；填入服务端域名后，App 内的 `/api/*` 请求自动指向该域名，登录与数据持久化才会生效。

## Docker 自托管（含 HTTPS）

JSON 文件存储只在单实例常驻进程下成立，推荐用仓库自带的 compose + Caddy 部署：

```bash
cp .env.example .env                          # 填写 AI / 图片密钥
echo 'GONGKAO_DOMAIN=app.example.com' >> .env # 必填；本地联调写 localhost
docker compose up -d --build
docker compose logs -f
```

访问 `https://<GONGKAO_DOMAIN>`。Caddy 独占 80/443 并自动申请 / 续期 TLS 证书，应用端口只绑 `127.0.0.1:3000` 不对外暴露。生产环境 Cookie 带 `Secure`，因此必须通过 HTTPS 访问，否则会出现「登录成功但页面仍显示未登录」。证书与 ACME 账号存放在具名卷 `gongkao-ai_caddy-data`，重建容器不会重签。完整说明见 [`docs/deploy-docker.md`](docs/deploy-docker.md)。

## GitHub / Vercel 部署

1. 将代码推送到 GitHub。
2. 在 Vercel 导入该 GitHub 仓库。
3. 构建命令使用 `npm run build`。
4. 如果需要服务端 Agnes AI 配置，在 Vercel Project Settings 里添加环境变量。
5. 不要把 `.env`、APK、构建目录或日志提交到仓库。

## GitHub Pages 自定义域名

本仓库也可以发布为静态站点，并绑定自定义域名，例如 `lhp.enener.com`。静态站点没有 Next.js 服务端 API，浏览器会在 `/api` 不可用时尝试直连设置页保存的 AI 接口；这要求模型接口允许浏览器跨域请求。需要隐藏 Key 并稳定使用文本/生图接口时，必须使用 Vercel、Node 服务器或其他支持服务端函数的部署方式。

DNS 需要添加：

```text
类型: CNAME
名称: lhp
值: huanpeng69-cmyk.github.io
代理: DNS only / 关闭代理
```

域名异常时可本地执行：

```bash
npm run check:site
```

如果提示 `DNS record is missing`，说明 Cloudflare 里的 `lhp` 解析记录不存在或未生效，需要按上面的 CNAME 重新添加。

## 架构决策记录

关键取舍写在 `docs/decisions/`：

- `2026-09-09-user-data-storage.md`：为什么把用户数据从 localStorage 迁到服务端 JSON 存储。
- `2026-09-09-mobile-deployment.md`：移动端的部署形态与单实例约束。
- `2026-11-06-practice-loop-and-time-spent.md`：首刷口径、按题计时与复习队列的取舍。

## 感谢和参考

[https://linux.do/](https://linux.do/) 感谢佬友

## 安全说明

- 仓库只保留 `.env.example`，真实 `.env` 已被忽略。
- APK、`out/`、`.next/`、Android build 输出、日志和浏览器检查缓存均已加入 `.gitignore`。
- 如果某个 API Key 曾经被提交到公开仓库，应立即到模型服务商后台撤销并重新生成。
