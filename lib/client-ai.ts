"use client";

import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { AGNES_PROVIDER, AGNES_TEXT_MODEL, agnesAuthHeaders, buildAgnesChatUrl } from "./agnes-ai";
import { toDisplayList, toDisplayText } from "./ai-display";
import { readSavedAiConfig } from "./default-ai-config";
import { buildDirectAiPrompt } from "./ai-prompts";

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
    return { apiKey: "", baseUrl: "", model: AGNES_TEXT_MODEL, authScheme: "bearer", protocol: AGNES_PROVIDER };
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
  if (cfg.model) headers["x-ai-model"] = cfg.model;

  return headers;
}

function isNativeRuntime() {
  return Capacitor.isNativePlatform();
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

async function nativePostJson(url: string, headers: Record<string, string>, data: unknown) {
  if (isNativeRuntime()) {
    const response = await CapacitorHttp.post({ url, headers, data, connectTimeout: 120000, readTimeout: 120000 });
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
      analysis: "请先在系统设置中保存 Agnes API Key，并确认模型名正确。",
      keyPoints: ["打开系统设置", "填写 AI 接口配置", "保存后重新生成讲解"],
      suggestion: "配置完成后再点击生成讲解。",
    };
  }

  const prompt = buildDirectAiPrompt(body, imageInputs.length > 0);

  const execute = async (images: string[]) => {
    const content = images.length > 0
      ? [{ type: "text", text: buildDirectAiPrompt(body, true) }, ...images.map((src) => ({ type: "image_url", image_url: { url: src } }))]
      : prompt;
    const data = await nativePostJson(
      buildAgnesChatUrl(cfg.baseUrl),
      agnesAuthHeaders(cfg.apiKey),
      { model: cfg.model || AGNES_TEXT_MODEL, messages: [{ role: "user", content }], temperature: 0.25, max_tokens: 4096 },
    ) as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content || "";
  };

  try {
    return { ...normalizeRawText(await execute(imageInputs)), source: AGNES_PROVIDER };
  } catch (error) {
    if (imageInputs.length > 0 && isImageUnsupported(error)) {
      return { ...normalizeRawText(await execute([])), source: AGNES_PROVIDER, apiError: "当前模型不支持图片输入，已使用同一模型改为纯文本解析。" };
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
