# Docker 部署指南（单实例服务端）

本目录新增 `Dockerfile` / `.dockerignore` / `docker-compose.yml`，把公考私教服务端
打成**单实例常驻容器**。这是 JSON 文件存储（`lib/server/store.ts`）在零改动下唯一可用的
宿主形态，理由见 `docs/decisions/2026-09-09-mobile-deployment.md`。

## 0. HTTPS：已内置 Caddy 反代

生产构建下（`NODE_ENV=production`）会话 Cookie 被标记为 `Secure`
（见 `app/api/auth/register/route.ts`、`app/api/auth/login/route.ts`）：

```ts
secure: process.env.NODE_ENV === "production",
```

浏览器**不会**通过明文 HTTP 回传 `Secure` Cookie。因此直接用
`http://<服务器IP>:3000` 访问，会出现「提示登录成功，但页面一直是未登录」的假象。

`docker-compose.yml` 里的 **`caddy` 服务**已经解决这一点：Caddy 独占 80/443，
自动申请 / 续期 TLS 证书并把请求反代到应用容器；应用端口只绑回环
（`127.0.0.1:3000`），对外不暴露。站点域名由 `GONGKAO_DOMAIN` 决定，**必填**
（未设置时 compose 直接报错退出）：

| 场景 | `GONGKAO_DOMAIN` | 证书来源 | 前置条件 |
|---|---|---|---|
| 生产 | 真实域名（如 `app.example.com`） | Let's Encrypt，自动 | 域名解析到本机，且公网 80/443 可达（80 用于 ACME 校验与 HTTPS 跳转） |
| 本地联调 | `localhost` | Caddy 内部 CA 自签 | 浏览器会告警，`curl` 需加 `-k` |

证书与 ACME 账户存放在具名卷 `gongkao-ai_caddy-data`：**重建容器不会重签**。
反代配置只有十几行，见仓库根目录 `Caddyfile`。

> 若确实需要内网明文 HTTP 访问（不挂 TLS）：删掉 `caddy` 服务，并把 `gongkao-ai`
> 的 `ports` 改回 `"3000:3000"`；此时还必须改 Cookie 策略（按 `X-Forwarded-Proto`
> 或 `GONGKAO_COOKIE_SECURE=0` 决定 `secure`）。这属于安全相关代码改动，
> **本次未做**，需要时单独立项。

## 1. 快速开始

### 方式一：docker compose（推荐，含 TLS）

```bash
cp .env.example .env                              # 填写 AI / 图片密钥（.env 已被 .gitignore 忽略）
echo 'GONGKAO_DOMAIN=app.example.com' >> .env     # 必填；本地联调写 localhost
docker compose up -d --build
docker compose logs -f
```

启动后访问 `https://<GONGKAO_DOMAIN>`（本地联调 `https://localhost`，自签证书需忽略告警）。

### 方式二：docker run（不含 TLS，仅内网 / 调试）

```bash
docker build -t gongkao-ai:latest .
docker run -d --name gongkao-ai \
  -p 3000:3000 \
  -v gongkao-data:/data \
  -e GONGKAO_DATA_DIR=/data \
  -e EMBED_PUBLIC_AI_KEYS=0 \
  --restart unless-stopped \
  gongkao-ai:latest
```

> ⚠️ 方式二没有 TLS。生产构建下登录态的 `Secure` Cookie 无法回传，浏览器会表现为
> 「登录成功却始终未登录」（第 0 节）。请勿用于公开环境。

## 2. 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `GONGKAO_DOMAIN` | **无默认，必填** | Caddy 站点域名；真实域名走 Let's Encrypt，`localhost` 走内部 CA 自签 |
| `GONGKAO_DATA_DIR` | `/data`（镜像内已设） | 用户数据库目录，必须指向挂载的持久卷 |
| `PORT` | `3000` | 监听端口 |
| `EMBED_PUBLIC_AI_KEYS` | `0` | **公开服务端务必保持 0**：为 1 会把密钥打进前端产物 |
| `AGNES_API_KEY` / `AI_TEXT_API_KEY` / `AI_TEXT_MODEL` | 空 / `agnes-2.0-flash` | 文本 AI |
| `IMAGE_BASE_URL` / `IMAGE_API_KEY` / `IMAGE_MODEL` / `IMAGE_AUTH_SCHEME` / `IMAGE_SIZE` | 见 `.env.example` | 图片生成 |
| `GONGKAO_ALLOW_ANON_AI` | 未设 | 过渡开关；设 `1` 才恢复 `/api/ai`、`/api/ai/health`、`/api/image` 的匿名访问（默认必须登录） |

密钥通过 `docker compose` 的同目录 `.env` 或 `-e` 注入，**不会**进入镜像层
（`.dockerignore` 已排除 `.env*`）。

## 3. 持久化与备份

用户数据库位于卷内 `/data/users.json`，并有一份写入前滚动备份 `/data/users.json.bak`。

- `docker compose down`（**不带** `-v`）：数据保留。
- `docker compose down -v`：**删除卷与全部用户数据** —— 不要随手加 `-v`。

**为什么 compose 默认用具名卷？** 具名卷首次创建时会从镜像继承 `/data` 的属主（`node`），
非 root 容器可直接写。若改用宿主机目录绑定，Linux 上需先改属主，否则 `permission denied`：

```bash
mkdir -p data/server && sudo chown -R 1000:1000 data/server
# 然后把 docker-compose.yml 的 volumes 换成：- ./data/server:/data
```

**备份 / 恢复**：

```bash
# 导出（备份）
docker run --rm -v gongkao-ai_gongkao-data:/data -v "$PWD":/backup busybox \
  tar czf /backup/gongkao-data-backup.tar.gz -C /data .

# 恢复
docker run --rm -v gongkao-ai_gongkao-data:/data -v "$PWD":/backup busybox \
  tar xzf /backup/gongkao-data-backup.tar.gz -C /data
```
**Caddy 证书卷**：证书与 ACME 账户在具名卷 `gongkao-ai_caddy-data`，可一并备份，
省去重建后重签：

```bash
docker run --rm -v gongkao-ai_caddy-data:/data -v "$PWD":/backup busybox \
  tar czf /backup/gongkao-caddy-backup.tar.gz -C /data .
```

> 证书目录内含**私钥**。若改用宿主机目录（`./data/caddy:/data`），务必置于版本控制之外
> —— `.gitignore` 已忽略 `/data/caddy/`。


数据库文件损坏时服务会 fail-closed（读取接口返回 500，而不是假装空库），
用 `users.json.bak` 覆盖回 `users.json` 即可恢复。原因与不变量见
`docs/decisions/2026-09-09-user-data-storage.md`。

## 4. 冒烟验收清单

数据持久化是这套部署的核心，务必跑完：

1. `docker compose ps` 健康状态为 `healthy`。
2. 打开站点 → 注册 → 登录。
3. 做几道题 / 产生学习记录。
4. **重建容器**（`docker compose down && docker compose up -d`，或
   `docker compose up -d --force-recreate`）。
5. 重新打开页面：**账号仍能登录、学习记录仍在**。

第 4–5 步是关键：只重启不重建、或只看进程没退，都证明不了数据落在卷上。

## 5. 移动端接线（方案A 收尾）

拿到本服务端的 HTTPS 域名后，让 Capacitor 壳加载远端服务端：

```bash
CAP_SERVER_URL=https://gongkao.example.com npm run build:mobile
npx cap sync android      # 或 ios
```

Windows PowerShell：

```powershell
$env:CAP_SERVER_URL="https://gongkao.example.com"; npm run build:mobile
npx cap sync android
```

`capacitor.config.ts` 未设该变量时保持现状（加载本地静态包），**默认行为不变**。

## 6. 常见问题

| 现象 | 原因 / 处理 |
|---|---|
| 登录提示成功但一直未登录 | 走了明文 HTTP，`Secure` Cookie 被浏览器丢弃 → 见第 0 节，挂 TLS |
| `permission denied` 写 `/data` | 用了宿主机目录绑定但没 `chown 1000:1000` → 见第 3 节 |
| 重启后账号/记录消失 | 没挂持久卷，或 `down -v` 删了卷 → 见第 3 节 |
| 题库页空白 | 检查 `public/mobile-data/gkzhenti_questions.min.json` 是否已打进镜像 |
| 构建卡在拉取镜像 | 见文末「网络注意」 |
| `required variable GONGKAO_DOMAIN is missing a value` | 没设站点域名 → 在 `.env` 里写 `GONGKAO_DOMAIN=...`（第 0/1 节） |
| 浏览器提示证书不受信任 | 用的是 `localhost` + Caddy 内部 CA，属预期；生产换真实域名即自动签发受信证书 |
| `caddy` 起不来，80/443 被占用 | 同一台机已有 Nginx/Apache 占用端口 → 停掉它，或改 `caddy` 的宿主端口映射 |

## 7. 镜像构成与取舍

- 多阶段构建：builder 装全量依赖并 `next build`；runner 只装生产依赖。
- **不启用** `output: 'standalone'`：那会修改共享的 `next.config.js`，牵连
  Vercel / GitHub Pages / 移动端构建。改用 prod-only 依赖达到等价瘦身。
- 构建缓存在 builder 内删除（`.next/cache` 约 95MB，运行时用不到）——
  若留到 runner 再删，文件仍在被 COPY 的层里，体积不会变小。
- 非 root 运行（`uid=1000(node)`）。
- 镜像内含：`.next`、`public/`（含题库静态资源）、`next.config.js`、
  `data/gkzhenti_questions.json`（供 `/api/gkzhenti` 兜底）。
- 实测镜像体积：**512MB**（aarch64 卷拉取的基础镜像另计）。

## 8. 网络注意（本机构建记录）

本机实测：**无法访问 Docker Hub 的 `auth.docker.io`**（`registry-1.docker.io` 可达），
直接 `docker build` 会在拉取 `docker/dockerfile:1` 前端镜像时超时。
因此本 Dockerfile **刻意不写 `# syntax=docker/dockerfile:1`**（本文件也没用到高级语法）。

若基础镜像拉不动，可经国内镜像源拉取后重新打标准 tag：

```bash
docker pull swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/library/node:20-bookworm-slim
docker tag  swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/library/node:20-bookworm-slim node:20-bookworm-slim
docker pull swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/library/caddy:2-alpine
docker tag  swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/library/caddy:2-alpine caddy:2-alpine
```

容器内 `npm ci` 走 `registry.npmjs.org`（实测可达，国内较慢）。
如需换源，构建时加 `--build-arg`（当前 Dockerfile 未开放该参数，需要时再加）。

## 9. 本次验证记录（如实）

在开发机上实跑（Docker 29.4.2 / Compose v5.1.3，Windows + Docker Desktop）：

**镜像与数据持久化**

- ✅ `docker build` 成功；`docker compose config` 合法
- ✅ 容器内 `id` = `uid=1000(node)`；卷内 `/data` 属主 `node:node`，非 root 可写
- ✅ 卷内 `users.json` + `users.json.bak` 权限 `0600`
- ✅ 12/12 无 TLS 接口冒烟：就绪、题库静态资源、`/api/gkzhenti` 兜底（total=5242）、
  未登录 `/api/data` = 401、注册、写入、读回、重新登录读回
- ✅ **销毁并重建容器（同卷）后**：旧会话仍读到原数据、账号仍可登录

**Caddy TLS（本轮新增）**

- ✅ `caddy validate`：`GONGKAO_DOMAIN=app.example.com` 与 `=localhost` 均为
  `Valid configuration`；域名留空被拒（fail-loud）
- ✅ `docker compose config`：未设 `GONGKAO_DOMAIN` 退出码 1 且报错明确；设置后通过
- ✅ 端口分配：`caddy` 占 80/443，`gongkao-ai` 仅 `127.0.0.1:3000`
- ✅ **10/10 HTTPS 端到端冒烟**（`GONGKAO_DOMAIN=localhost`，Caddy 内部 CA，`curl -k`）：
  1. `https://localhost/login` = 200
  2. `http://localhost/login` = 308 → `https://localhost/login`
  3. 注册 = 200
  4. 会话 Cookie 实际带 `Secure` + `HttpOnly`（读 cookie jar 核对）
  5. 带 Cookie 读 `/api/data` = 200
  6. 写 `/api/data` = 200
  7. 回读校验：写入的 marker 与 `displayName` 覆盖均正确（含中文名，UTF-8 全链路）
  8. **同一个 cookie jar 明文直连 `127.0.0.1:3000` = 401**（`Secure` Cookie 未被发送）
     —— 这是第 0 节「必须挂 TLS」结论的直接证据
  9. 未认证 `https://.../api/data` = 401
  10. 重新登录 = 200
- ✅ Caddy 访问日志确认 TLS 1.3（`version 772`）、`Alt-Svc: h3=":443"`
- ✅ `docker compose restart caddy` 后证书文件 mtime 不变 → 证书复用未重签；
  HTTPS 仍 200、HTTP→HTTPS 跳转仍 308

**未验证（如实）**

- ❌ 公网真实域名的 Let's Encrypt 签发（需要可解析域名 + 公网 80/443 可达）
- ❌ 真机 Android / iOS 安装包与 `CAP_SERVER_URL` 端到端流程
- ❌ 多副本 / Serverless 形态（JSON 文件存储不适用，须先换存储后端）

> 踩坑记录（写验证脚本时踩到）：PowerShell 5.1 读取**无 BOM 的 UTF-8** `.ps1` 时按系统
> ANSI 码页解码，中文注释可能吃掉行尾换行、把下一行代码并进注释 —— 表现为「curl 明明
> 执行了却没有输出」。含中文的 `.ps1` 请保存为 **UTF-8 with BOM**。
