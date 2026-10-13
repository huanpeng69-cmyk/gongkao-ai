# 移动端 / 服务端部署决策（方案A）

## 背景

项目此前有两条并行形态：

- **Web**：Next.js 应用，登录 / 数据 / AI / 图片走同源 `/api/*`（`app/api/...`）。
- **GitHub Pages 静态站**（`MOBILE_EXPORT=1` + `GITHUB_PAGES=1`）：`next export` 出静态文件，**没有任何 API**。消融 E/H 已证实：静态态下 `saveData` 的 `PUT /api/data` 返回 404、`checkSession()` 恒为 false —— 学习数据只存内存、重启即丢，用户被卡在登录页。
- **Capacitor 壳**（`android/`、`ios/`）：WebView 加载本地 `out/` 静态包，因此继承了静态态的全部断裂（E/H）。

## 方案A：移动端改为加载远端服务端

让 Capacitor WebView 通过 `server.url` 加载一个**真正跑 Next.js 服务端**的地址，App 内所有相对路径 `/api/auth`、`/api/data`、`/api/ai`、静态资源自动解析到该域名，`lib/` 无需改动。

代码侧已就绪：`capacitor.config.ts` 支持 `CAP_SERVER_URL` 环境变量，留空即维持现状（加载本地包），填入域名后即切到远端。**默认行为不变**，可安全合入。

## 关键前提（本轮核实，结论先行）

**方案A 在 Vercel 原生 Serverless 部署上不成立。** 依据：

1. `lib/server/store.ts` 用 JSON 文件存储，路径 `GONGKAO_DATA_DIR`（默认 `./data/server`，见 `.env.example`）。
2. 它要求该目录**可写**，且**在服务实例之间共享**（F1 的 read-modify-write 依赖「跨实例可见同一文件」）。
3. Vercel 的 Serverless Functions：部署目录**只读**；唯一可写的 `/tmp` 是**每实例独立、且重启即失**，不共享。

后果：在 Vercel 的原生函数上，`saveUserData` / 注册 / 登录要么写失败，要么写进各自 `/tmp`，实例一换就看不到 —— 用户会「注册成功但下次登录找不到账号」「学习记录随机消失」。这与消融 E/H 的病灶同源，只是换了个宿主。

`vercel.json` 目前只有 `{ "framework": "nextjs", "buildCommand": "npm run build" }`，未声明任何持久化配置 —— 即默认按无状态函数部署，必然触发上述问题。

## 备选与取舍

| 部署目标 | 文件存储能否持久 | 结论 |
|---|---|---|
| Vercel 原生 Serverless | ❌ 只读 + 每实例独立 /tmp | **不可直接用**；须换存储后端 |
| 单实例常驻进程（VPS / Fly.io 单机 / Render Web Service / Docker） | ✅ 进程常驻，可写盘 | **当前代码零改动即可用** |
| 带持久卷的 PaaS（Fly.io Volume / Render Disk） | ✅ 挂载卷被单实例独占 | 可用；注意卷默认单实例挂载 |
| 多副本 / Serverless（含 Vercel + 外部数据库） | ✅ 需外部共享存储 | 须把 `lib/server/store.ts` 换成 SQLite(共享卷)/Postgres/MySQL 适配器 |

决策文档 `2026-09-09-user-data-storage.md` 已写明：`store.ts` 与前端接口分离，可替换为 SQLite/MySQL/PostgreSQL 适配器而不改前端。这正是为此刻预留的口子。

## 决策

1. **默认（不改代码）**：方案A 的服务端部署到**单实例常驻进程**（VPS / Docker / Render Web Service / Fly.io 单机），数据目录指向持久盘。这是当前 JSON 文件存储在零改动下的唯一正确宿主。
2. **若确要上 Vercel / 多副本**：先换存储后端（SQLite 用共享卷、或 Postgres/MySQL 等真正共享的库），**不要**用 Vercel `/tmp` 硬撑。
3. **移动端**：拿到服务端域名后，构建时设 `CAP_SERVER_URL=<域名>`（或写进 `capacitor.config.ts` 默认值），再 `npx cap sync`。在此之前移动端保持现状（加载本地包），不阻断发布。

## 收口清单（方案A 落地步骤）

1. 选部署目标：单实例常驻进程（推荐，零改动）。
2. 配置持久化数据目录：
   - `GONGKAO_DATA_DIR=<持久盘绝对路径>`；确保运行用户对该目录可写。
   - 备份策略：已有 `users.json.bak` 滚动备份；生产建议再加盘级快照。
3. 配置 AI / 图片密钥等环境变量（见 `.env.example`）；公开站点务必 `EMBED_PUBLIC_AI_KEYS=0`。
4. 部署并冒烟：注册 → 登录 → 写一条学习数据 → 重启服务 → 数据仍在（这一条是 JSON 文件存储的验收核心）。
5. 移动端：构建时 `CAP_SERVER_URL=<域名>` → `npx cap sync android` / `ios`。
6. 验证移动端：App 内能注册/登录、能写学习数据、杀进程重开数据仍在。

## 待用户提供 / 待办

- 服务端部署目标的**实际域名**（用于 `CAP_SERVER_URL`）。
- 该目标是否具备**持久可写**的数据目录（决定是否必须换数据库）。

在此两项确定前，方案A 无法端到端收口；本轮已完成的是「代码就绪 + 前提核实 + 路径定型」，**未做实机部署**。

## 落地记录：Docker 单实例镜像

按上述「默认」路径，已新增 `Dockerfile` / `.dockerignore` / `docker-compose.yml`，
使用说明见 `docs/deploy-docker.md`。关键取舍：

- **单实例常驻容器 + 持久卷**，数据目录 `/data`（`GONGKAO_DATA_DIR`）。这正是
  JSON 文件存储零改动可用的宿主形态；没有引入任何新存储机制。
- **不启用 `output:'standalone'`**：那会改动共享的 `next.config.js`，牵连
  Vercel / GitHub Pages / 移动端构建。改用「runner 只装生产依赖」达到等价瘦身。
- 非 root 运行（`uid=1000`）；compose 默认用具名卷，使其首次创建即从镜像继承
  `/data` 属主，避免 chown 摩擦。
- 镜像内不含任何密钥与用户数据（`.dockerignore` 排除 `.env*` 与 `data/server`）。

**新发现的部署硬前提（与容器化无关，但必然撞上）**：生产构建下会话 Cookie 带
`secure: NODE_ENV === "production"`，浏览器不会在明文 HTTP 下回传 —— 直接在
`http://IP:3000` 访问会表现为「登录成功却始终未登录」。服务端**必须置于 TLS 反代之后**。
若需内网明文访问，须改为按 `X-Forwarded-Proto` 或环境变量决定 `secure`（安全相关代码
改动，尚未实施）。

**仍未解决**：方案A 的移动端接线需要真实 HTTPS 域名（`CAP_SERVER_URL`），
本轮未实现端到端部署。

## 落地记录：Caddy TLS 反代（并入同一 compose 编排）

上文「必须走 TLS」的硬前提，本轮已用 Caddy 落地：

- `Caddyfile` + `docker-compose.yml` 的 `caddy` 服务：Caddy 独占 80/443，自动申请 /
  续期证书并反代到 `gongkao-ai:3000`；**应用端口改为只绑 `127.0.0.1`**，对外仅一个入口。
- 站点地址取自 `GONGKAO_DOMAIN`，用 compose 的 `${VAR:?msg}` 强制必填 —— 宁可在启动时
  明确报错，也不接受「容器起来了但证书签给了错误域名」这类静默错误。
- 证书与 ACME 账户落在具名卷 `caddy-data`：重建容器不重签（已实测证书 mtime 不变）。
- 生产用真实域名走 Let's Encrypt；本地联调 `GONGKAO_DOMAIN=localhost` 走内部 CA 自签。
- 不写全局 `email {}`：空值会让 Caddy 直接失败，而 ACME 账户邮箱本属可选。需要时在
  `Caddyfile` 顶部加 `{ email you@example.com }`。

**为什么是 Caddy 而不是 Nginx + certbot**：Caddy 在现成编排里零额外进程、自动 HTTPS
与续期，配置十几行；Nginx 方案要再加一个 certbot 容器 + 定时任务 + 重载钩子。
代价是镜像多约 49MB。

**证据**：`GONGKAO_DOMAIN=localhost` 下 10/10 HTTPS 端到端冒烟通过，其中
「同一个 cookie jar：HTTPS 读 = 200 / 明文直连 3000 读 = 401」这一对照，直接证实了
`Secure` Cookie 就是必须挂 TLS 的原因。明细见 `docs/deploy-docker.md` 第 9 节。
