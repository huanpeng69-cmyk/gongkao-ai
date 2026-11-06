import type { CapacitorConfig } from "@capacitor/cli";

// 移动端要加载的服务端地址（方案A）。
//  - 留空（默认）：维持现状，WebView 加载本地 out/ 静态包（当前行为，登录/数据仍走静态断裂态）。
//  - 填入 Vercel/服务端域名后：移动端改加载远端服务端，App 内所有相对路径
//    fetch（/api/auth、/api/data、/api/ai、静态资源）自动解析到该域名，lib/ 无需改动。
//  拿到域名后：替换下方空字符串默认值，或在构建环境设置 CAP_SERVER_URL，然后重新 cap sync。
const SERVER_URL: string = process.env.CAP_SERVER_URL || "";

const config: CapacitorConfig = {
  appId: "com.gongkao.ai",
  appName: "公考私教",
  webDir: "out",
  server: {
    androidScheme: "https",
    ...(SERVER_URL ? { url: SERVER_URL } : {}),
  },
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
  },
};

export default config;
