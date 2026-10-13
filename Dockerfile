#
# 公考私教（gongkao-ai）单实例服务端镜像。
#
# 说明：本文件刻意不写 `# syntax=docker/dockerfile:1`。
# 该指令会让 BuildKit 先去 Docker Hub 拉取 dockerfile 前端镜像；在只放行
# registry-1.docker.io、不放行 auth.docker.io 的网络下会直接构建失败。
# 本文件未用到任何高级语法，用内置前端即可。
#
# 定位：常驻 Node 进程 + 可写持久卷 —— 这是 JSON 文件存储（lib/server/store.ts）
#       零改动可用的唯一宿主形态。参见 docs/decisions/2026-09-09-mobile-deployment.md。
#
# 设计要点：
#   1. 多阶段：builder 装全量依赖并构建；runner 只装生产依赖，镜像更瘦。
#   2. 不启用 next 的 output:'standalone' —— 那会改动共享的 next.config.js，
#      牵连 Vercel / GitHub Pages / 移动端构建。此处用「prod-only node_modules」
#      达到等价的瘦身效果，且对现有构建零影响。
#   3. 非 root 运行（node:20 自带的 node 用户 uid 1000）。
#   4. 用户数据库只经卷 /data 注入，绝不烘进镜像层。

########## 阶段 1：构建 ##########
FROM node:20-bookworm-slim AS builder
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

# 先只拷依赖清单，最大化利用层缓存（源码变了不必重装依赖）。
COPY package.json package-lock.json ./
RUN npm ci

# 再拷源码。注意：.dockerignore 已排除 .env*，因此构建期不会读入任何密钥；
# 且不设 MOBILE_EXPORT / GITHUB_PAGES，走标准 Next 服务端构建（非静态导出）。
COPY . .

RUN npm run build
# 构建缓存（webpack）运行时用不到。必须在 builder 内删：若留到 runner 再删，
# 文件已经存在于被 COPY 的层里，镜像体积不会变小。
RUN rm -rf /app/.next/cache

########## 阶段 2：运行 ##########
FROM node:20-bookworm-slim AS runner
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

# 只装生产依赖（不含 typescript / tailwind / capacitor 等 devDependencies）。
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    GONGKAO_DATA_DIR=/data

# 构建产物 + 运行期资源。
# next start 会在运行时读取 next.config.js，故必须拷贝。
# data/gkzhenti_questions.json 仅供 /api/gkzhenti 兜底读取（题库主路径是 public 静态资源）。
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.js ./next.config.js
COPY --from=builder /app/data/gkzhenti_questions.json ./data/gkzhenti_questions.json

# 持久化目录：先建好并交给 node 用户。
# 具名卷首次创建时会从镜像继承该目录的属主，因此非 root 也能直接写。
RUN mkdir -p /data && chown -R node:node /data
VOLUME ["/data"]

USER node
EXPOSE 3000

# 健康检查用 /login（公开页面，200）；/api/auth/session 未登录返回 401，不能当探针。
# 用 node 内置 fetch，避免为 curl 额外装包。
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# 直接 exec node 进程（不经 npm/npx），保证 PID 1 能正确接收 SIGTERM 优雅退出。
CMD ["./node_modules/.bin/next", "start"]
