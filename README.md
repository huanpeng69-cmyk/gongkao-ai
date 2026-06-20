# 公考 AI 学习桌

公考刷题、模考、错题复习、百宝箱工具和 AI 讲解一体化学习应用。项目基于 Next.js，移动端可通过 Capacitor 打包为 Android APK。

## 功能

- 真题题库：支持搜索、考试/年份/试卷筛选、材料题组练习。
- 真题模考：按整套试卷计时训练。
- 错题复习：按复习计划回看错题，并可生成错因讲解。
- 备考百宝箱：资料分析、空间重构、截面图、三视图、记忆卡片等工具。
- AI 设置：文本讲解和生图接口均从系统设置或运行环境读取，不在仓库中内置 API Key。

## 本地运行

```bash
npm install
copy .env.example .env
npm run dev
```

打开 `http://localhost:3000`。

## AI 配置

推荐在应用内「我的 / 系统设置」填写模型配置。发布到 GitHub 前不要提交真实 Key。

服务端环境变量可参考 `.env.example`：

- `AI_BASE_URL`
- `AI_API_KEY`
- `AI_MODEL`
- `AI_AUTH_SCHEME`
- `IMAGE_BASE_URL`
- `IMAGE_API_KEY`
- `IMAGE_MODEL`

默认应把真实 Key 放在服务端环境变量中，由 `/api/ai` 和 `/api/image` 代理调用。`NEXT_PUBLIC_*` 变量会进入前端构建产物，只能放公开默认值，不要放真实密钥。

`EMBED_PUBLIC_AI_KEYS=1` 会把 Key 注入静态前端包，仅适合完全私有的 APK/内部分发场景；公开网站和 GitHub Pages 不要开启。

## Web 构建

```bash
npm run build
```

移动端静态导出：

```bash
npm run build:mobile
```

## Android APK

准备 Android SDK 和 JDK 21 后执行：

```bash
npm run build:mobile
npx cap sync android
cd android
gradlew assembleDebug
```

生成文件：

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

## GitHub / Vercel 部署

1. 将代码推送到 GitHub。
2. 在 Vercel 导入该 GitHub 仓库。
3. 构建命令使用 `npm run build`。
4. 如果需要服务端 AI 兜底配置，在 Vercel Project Settings 里添加环境变量。
5. 不要把 `.env`、APK、构建目录或日志提交到仓库。

## GitHub Pages 自定义域名

本仓库也可以发布为静态站点，并绑定自定义域名，例如 `lhp.enener.com`。静态站点没有 Next.js 服务端 API，浏览器会在 `/api` 不可用时尝试直连设置页保存的 AI 接口；这要求模型接口允许浏览器跨域请求。需要隐藏 Key 并稳定使用文本/生图接口时，必须使用 Vercel、Node 服务器或其他支持服务端函数的部署方式。

DNS 需要添加：

```text
类型: CNAME
名称: lhp
值: huanpeng69-cmyk.github.io
```

## 安全说明

- 仓库只保留 `.env.example`，真实 `.env` 已被忽略。
- APK、`out/`、`.next/`、Android build 输出、日志和浏览器检查缓存均已加入 `.gitignore`。
- 如果某个 API Key 曾经被提交到公开仓库，应立即到模型服务商后台撤销并重新生成。
