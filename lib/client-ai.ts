import { buildAnthropicMessagesUrl, buildOpenAIChatCompletionsUrl } from "./ai-endpoints";
import { toDisplayList, toDisplayText } from "./ai-display";
import { readSavedAiConfig } from "./default-ai-config";

type AiBody = Record<string, unknown>;

type AiConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
  authScheme: string;
  protocol: string;
};

function getSavedAiConfig(): AiConfig {
  if (typeof window === "undefined") {
    return { apiKey: "", baseUrl: "", model: "", authScheme: "bearer", protocol: "openai" };
  }

  const cfg = readSavedAiConfig();
  return {
    apiKey: cfg.apiKey,
    baseUrl: cfg.baseUrl,
    model: cfg.model,
    authScheme: cfg.authScheme,
    protocol: cfg.protocol,
  };
}

export function getSavedAiHeaders() {
  const cfg = getSavedAiConfig();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (cfg.protocol) headers["x-ai-provider"] = cfg.protocol;
  if (cfg.apiKey) headers["x-ai-key"] = cfg.apiKey;
  if (cfg.baseUrl) headers["x-ai-base"] = cfg.baseUrl;
  if (cfg.model) headers["x-ai-model"] = cfg.model;
  if (cfg.authScheme) headers["x-ai-auth"] = cfg.authScheme;

  return headers;
}

function isNativeRuntime() {
  if (typeof window === "undefined") return false;
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return Boolean(cap?.isNativePlatform?.());
}

function extractBalancedJson(text: string) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```json\s*([\s\S]*?)```/i) || trimmed.match(/```\s*([\s\S]*?)```/);
  const candidate = (fenced?.[1] ?? trimmed).trim();

  try {
    return JSON.parse(candidate);
  } catch {
    // Continue to balanced-object scan.
  }

  const start = candidate.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < candidate.length; i += 1) {
    const ch = candidate[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(candidate.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }

  return null;
}

function normalizeAiResult(value: unknown) {
  const result: Record<string, unknown> = value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : { analysis: toDisplayText(value) };
  const analysis = toDisplayText(result.analysis || result.content || result.text || value);
  const derivedPoints = analysis
    .split(/[。；;\n]/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 6)
    .slice(0, 6);
  const keyPoints = toDisplayList(result.keyPoints);

  return {
    ...result,
    title: toDisplayText(result.title) || "AI错因讲解",
    analysis,
    keyPoints: keyPoints.length ? keyPoints : derivedPoints,
    method: toDisplayText(result.method),
    mnemonic: toDisplayText(result.mnemonic),
    example: toDisplayText(result.example),
    answerSummary: toDisplayText(result.answerSummary),
    suggestion: toDisplayText(result.suggestion),
    errorType: toDisplayText(result.errorType),
    bihangTip: toDisplayText(result.bihangTip),
  };
}

function normalizeRawText(rawText: string) {
  return normalizeAiResult(extractBalancedJson(rawText) || { title: "AI错因讲解", analysis: rawText });
}

function isImageUnsupported(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /image input|support image|vision|multi[-\s]?modal|modalit/i.test(message);
}

function buildPrompt(body: AiBody, hasImages: boolean) {
  const mode = String(body.mode || "");
  if (mode === "tutor") {
    return `你是公考私教。请根据用户问题或上传题目生成结构化讲解，严格返回 JSON。

用户问题：${toDisplayText(body.prompt) || "请根据上传图片或补充信息讲解题目"}
图片文件：${toDisplayText(body.imageName) || "无"}
补充信息：${toDisplayText(body.context) || "无"}
是否包含图片：${hasImages ? "是" : "否"}

返回格式：
{
  "title": "10字以内标题",
  "analysis": "120-220字讲解",
  "keyPoints": ["3-6条字符串要点"],
  "method": "可迁移的方法步骤",
  "mnemonic": "记忆口诀，没有则空字符串",
  "example": "同类例题或类比",
  "answerSummary": "一句话总结"
}`;
  }

  return `你是公考笔试私教。请分析以下错题，并严格返回 JSON。

题目：${toDisplayText(body.question)}
用户答案：${toDisplayText(body.userAnswer) || "未作答"}
正确答案：${toDisplayText(body.correctAnswer) || "未知"}
模块：${toDisplayText(body.module) || "未分类"}
原始解析：${toDisplayText(body.explanation) || "无"}
补充材料：${toDisplayText(body.context || body.material) || "无"}
是否包含题图/选项图：${hasImages ? "是" : "否"}

返回格式：
{
  "title": "10字以内标题",
  "errorType": "知识盲区/概念混淆/审题失误/计算推理错误/思路偏差/时间压力/题图信息缺失",
  "analysis": "120-220字总述：先定位题型和错因，再讲正确切入点",
  "keyPoints": ["3-5条字符串要点"],
  "method": "可迁移的解题步骤",
  "mnemonic": "记忆口诀，没有则空字符串",
  "example": "同类题识别例子或类比",
  "suggestion": "针对性复习建议",
  "bihangTip": "如果适合秒杀技巧，给出技巧名称和口诀"
}`;
}

async function nativePostJson(url: string, headers: Record<string, string>, data: unknown) {
  const http = (window as unknown as {
    CapacitorHttp?: {
      post: (options: { url: string; headers?: Record<string, string>; data?: unknown; connectTimeout?: number; readTimeout?: number }) => Promise<{ status: number; data: unknown }>;
    };
  }).CapacitorHttp;

  if (http?.post) {
    const response = await http.post({ url, headers, data, connectTimeout: 120000, readTimeout: 120000 });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`AI API error [${response.status}]: ${typeof response.data === "string" ? response.data : JSON.stringify(response.data)}`);
    }
    return response.data;
  }

  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(data) });
  if (!res.ok) {
    throw new Error(`AI API error [${res.status}]: ${await res.text().catch(() => res.statusText)}`);
  }
  return res.json();
}

async function callDirectAi(body: AiBody, imageInputs: string[]) {
  const cfg = getSavedAiConfig();
  if (!cfg.apiKey || !cfg.baseUrl) {
    return {
      source: "local",
      title: "AI未配置",
      errorType: "接口未配置",
      analysis: "请先在系统设置中保存 AI Key、Base URL 和模型名。",
      keyPoints: ["打开系统设置", "填写 AI 接口配置", "保存后重新生成讲解"],
      suggestion: "配置完成后再点击生成讲解。",
    };
  }

  const protocol = cfg.protocol.toLowerCase();
  const prompt = buildPrompt(body, imageInputs.length > 0);

  const execute = async (images: string[]) => {
    if (protocol === "anthropic") {
      const content = [
        { type: "text", text: buildPrompt(body, images.length > 0) },
        ...images
          .filter((src) => src.startsWith("data:image/"))
          .map((src) => {
            const match = src.match(/^data:(image\/[a-z]+);base64,(.+)$/i);
            return match ? { type: "image", source: { type: "base64", media_type: match[1], data: match[2] } } : null;
          })
          .filter(Boolean),
      ];
      const data = await nativePostJson(
        buildAnthropicMessagesUrl(cfg.baseUrl),
        { "Content-Type": "application/json", "x-api-key": cfg.apiKey, "anthropic-version": "2023-06-01" },
        { model: cfg.model || "claude-sonnet-4-20250514", max_tokens: 4096, messages: [{ role: "user", content }] },
      ) as { content?: Array<{ text?: string }> };
      return data.content?.[0]?.text || "";
    }

    const content = images.length > 0
      ? [{ type: "text", text: buildPrompt(body, true) }, ...images.map((src) => ({ type: "image_url", image_url: { url: src } }))]
      : prompt;
    const headers: Record<string, string> = cfg.authScheme === "x-api-key"
      ? { "Content-Type": "application/json", "x-api-key": cfg.apiKey }
      : { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` };
    const data = await nativePostJson(
      buildOpenAIChatCompletionsUrl(cfg.baseUrl),
      headers,
      { model: cfg.model || "deepseek-chat", messages: [{ role: "user", content }], temperature: 0.7, max_tokens: 4096 },
    ) as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content || "";
  };

  try {
    return { ...normalizeRawText(await execute(imageInputs)), source: protocol };
  } catch (error) {
    if (imageInputs.length > 0 && isImageUnsupported(error)) {
      return { ...normalizeRawText(await execute([])), source: protocol, apiError: "当前模型不支持图片输入，已使用同一模型改为纯文本解析。" };
    }
    throw error;
  }
}

export async function requestAi(body: AiBody) {
  const imageInputs = [body.images, body.imageDataUrl, body.imageDataUrls, body.imageUrls]
    .flat()
    .map((item) => String(item || "").trim())
    .filter((item) => item.startsWith("data:image/") || /^https?:\/\//i.test(item));

  if (!isNativeRuntime()) {
    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: getSavedAiHeaders(),
        body: JSON.stringify(body),
      });
      if ((res.headers.get("content-type") || "").includes("application/json")) {
        return res.json();
      }
    } catch {
      // Static hosts such as GitHub Pages do not provide Next.js API routes.
    }
  }

  return callDirectAi(body, Array.from(new Set(imageInputs)));
}
