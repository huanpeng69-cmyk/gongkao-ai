import { NextResponse } from "next/server";
import { buildAnthropicMessagesUrl, buildOpenAIChatCompletionsUrl } from "@/lib/ai-endpoints";

type HealthTest = {
  name: string;
  status: "pass" | "fail" | "skip";
  detail: string;
  ms?: number;
};

type Diagnostics = {
  timestamp: string;
  config: {
    provider: string;
    baseUrl: string;
    model: string;
    hasApiKey: boolean;
    authScheme: string;
  };
  serverEnv: {
    hasEnvKey: boolean;
    hasEnvBase: boolean;
    hasEnvModel: boolean;
    nodeEnv: string;
  };
  tests: HealthTest[];
  suggestion?: string;
};

/**
 * GET /api/ai/health
 * 诊断AI接口连通性，返回详细的诊断信息
 * 前端可在设置页调用此接口检测AI配置是否正确
 */
export async function GET(req: Request) {
  if (process.env.MOBILE_EXPORT === "1") {
    return NextResponse.json({
      status: "static-mobile",
      diagnostics: {
        timestamp: new Date().toISOString(),
        suggestion: "Mobile APK builds use the saved AI settings directly from the app.",
        tests: [{ name: "移动端静态导出", status: "skip", detail: "APK 内不使用 Next.js 服务端健康检查接口" }],
      },
    });
  }

  const url = new URL(req.url);
  // 支持从 query params 或 headers 读取配置
  const aiProvider = url.searchParams.get("provider") || req.headers.get("x-ai-provider") || process.env.AI_PROVIDER || "openai";
  const aiKey = url.searchParams.get("key") || req.headers.get("x-ai-key") || process.env.AI_API_KEY || "";
  const aiBase = url.searchParams.get("base") || req.headers.get("x-ai-base") || process.env.AI_BASE_URL || "";
  const aiModel = url.searchParams.get("model") || req.headers.get("x-ai-model") || process.env.AI_MODEL || "";
  const aiAuth = url.searchParams.get("auth") || req.headers.get("x-ai-auth") || process.env.AI_AUTH_SCHEME || "bearer";

  const diagnostics: Diagnostics = {
    timestamp: new Date().toISOString(),
    config: {
      provider: aiProvider || "(未配置)",
      baseUrl: aiBase || "(未配置)",
      model: aiModel || "(未配置)",
      hasApiKey: !!aiKey,
      authScheme: aiAuth,
    },
    serverEnv: {
      hasEnvKey: !!process.env.AI_API_KEY,
      hasEnvBase: !!process.env.AI_BASE_URL,
      hasEnvModel: !!process.env.AI_MODEL,
      nodeEnv: process.env.NODE_ENV || "unknown",
    },
    tests: [],
  };

  // Step 1: 检查配置是否完整
  if (!aiKey || !aiBase) {
    diagnostics.tests.push({
      name: "配置检查",
      status: "skip",
      detail: aiKey ? "缺少 Base URL" : aiBase ? "缺少 API Key" : "API Key 和 Base URL 均未配置",
    });
    return NextResponse.json({ status: "unconfigured", diagnostics });
  }

  diagnostics.tests.push({ name: "配置检查", status: "pass", detail: "API Key 和 Base URL 已配置" });

  // Step 2: 构建测试请求 URL
  let testUrl = "";
  let testHeaders: Record<string, string> = { "Content-Type": "application/json" };
  let testBody: string;

  if (aiProvider === "anthropic") {
    testUrl = buildAnthropicMessagesUrl(aiBase);
    testHeaders["x-api-key"] = aiKey;
    testHeaders["anthropic-version"] = "2023-06-01";
    testBody = JSON.stringify({
      model: aiModel || "claude-sonnet-4-20250514",
      max_tokens: 10,
      messages: [{ role: "user", content: "Say 'ok'" }],
    });
  } else {
    testUrl = buildOpenAIChatCompletionsUrl(aiBase);
    if (aiAuth === "x-api-key") {
      testHeaders["x-api-key"] = aiKey;
    } else {
      testHeaders["Authorization"] = `Bearer ${aiKey}`;
    }
    testBody = JSON.stringify({
      model: aiModel || "gpt-4o-mini",
      messages: [{ role: "user", content: "Say 'ok'" }],
      max_tokens: 256,
    });
  }

  diagnostics.tests.push({ name: "URL构建", status: "pass", detail: testUrl });

  // Step 3: DNS 解析检查
  try {
    const startTime = Date.now();
    const res = await fetch(testUrl, {
      method: "POST",
      headers: testHeaders,
      body: testBody,
      signal: AbortSignal.timeout(15000),
    });
    const elapsed = Date.now() - startTime;

    if (res.ok) {
      const data = await res.json();
      const content = aiProvider === "anthropic"
        ? data.content?.[0]?.text || ""
        : data.choices?.[0]?.message?.content || data.choices?.[0]?.message?.reasoning_content || "";
      diagnostics.tests.push({
        name: "API连通性",
        status: "pass",
        detail: `HTTP ${res.status} · 模型回复: "${content.slice(0, 50)}"`,
        ms: elapsed,
      });
      return NextResponse.json({ status: "ok", diagnostics });
    } else {
      const errText = await res.text().catch(() => "");
      diagnostics.tests.push({
        name: "API连通性",
        status: "fail",
        detail: `HTTP ${res.status} · ${errText.slice(0, 200)}`,
        ms: elapsed,
      });

      // 提供更详细的错误解读
      if (res.status === 401) {
        diagnostics.suggestion = "API Key 无效或已过期，请检查配置";
      } else if (res.status === 403) {
        diagnostics.suggestion = "API Key 没有访问此模型的权限，或账户余额不足";
      } else if (res.status === 404) {
        diagnostics.suggestion = "API 地址或模型名称不正确，请确认 Base URL 和 Model 设置";
      } else if (res.status === 429) {
        diagnostics.suggestion = "请求频率过高，请稍后再试";
      } else if (res.status >= 500) {
        diagnostics.suggestion = "AI服务商服务器错误，请稍后再试";
      }
      return NextResponse.json({ status: "error", diagnostics });
    }
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    let detail = errMsg;
    let suggestion = "";

    if (errMsg.includes("timeout") || errMsg.includes("AbortError")) {
      detail = "请求超时(15秒)";
      suggestion = "网络连接超时，可能是：1) 网络不通 2) AI服务商在当前网络下不可访问(如GFW限制) 3) Base URL不正确";
    } else if (errMsg.includes("ENOTFOUND") || errMsg.includes("getaddrinfo")) {
      detail = "DNS解析失败";
      suggestion = "域名无法解析，请检查 Base URL 是否正确";
    } else if (errMsg.includes("ECONNREFUSED")) {
      detail = "连接被拒绝";
      suggestion = "目标服务器拒绝连接，请检查端口和协议(http/https)";
    } else if (errMsg.includes("fetch failed") || errMsg.includes("ECONNRESET")) {
      detail = "网络连接失败";
      suggestion = "无法连接到AI服务商。如果在中国大陆，部分AI服务(如OpenAI、Anthropic)需要代理才能访问。建议使用DeepSeek、通义千问等国内可直接访问的服务。";
    } else if (errMsg.includes("SELF_SIGNED_CERT") || errMsg.includes("certificate")) {
      detail = "SSL证书错误";
      suggestion = "SSL证书验证失败，请检查网络环境是否安全";
    }

    diagnostics.tests.push({ name: "API连通性", status: "fail", detail });
    if (suggestion) diagnostics.suggestion = suggestion;

    return NextResponse.json({ status: "error", diagnostics });
  }
}
