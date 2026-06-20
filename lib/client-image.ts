"use client";

import { buildOpenAIImageGenerationsUrl } from "./ai-endpoints";
import { readSavedImageConfig } from "./default-ai-config";

const COMIC_SYSTEM_PROMPT =
  "生成一组用于公考题目讲解的多格漫画分镜，必须先阅读并理解下方输入的题干、材料、选项、正确答案和AI讲解，再把解题过程画出来。\n\n" +
  "硬性要求：1. 输入内容是唯一依据，不得自创题目、人物剧情、数字、选项或结论。2. 每一格都要对应真实解题步骤。3. 如果输入提到图形、表格、统计材料、选项文字，画面中必须用简化白板或卡片还原关键特征。4. 如果输入信息不足，画面应表现题目信息不足或需要补充截图。5. 画面文字只放短标题、关键词、公式、箭头和答案标记。\n\n" +
  "视觉风格：现代教育插画，干净明亮，学习软件感；重点放在白板、题干卡片、选项对比、表格、图形、推导箭头和最终答案。";

type ImageBody = Record<string, unknown>;

function isNativeRuntime() {
  if (typeof window === "undefined") return false;
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return Boolean(cap?.isNativePlatform?.());
}

function authHeaders(apiKey: string, authScheme: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authScheme === "x-api-key") headers["x-api-key"] = apiKey;
  else headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

function pickImage(data: unknown) {
  const root = data && typeof data === "object" ? data as Record<string, unknown> : {};
  const list = (Array.isArray(root.data) ? root.data : Array.isArray(root.images) ? root.images : Array.isArray(root.output) ? root.output : []) as Array<Record<string, unknown>>;
  const item = list[0] || root;
  const rawUrl = String(item.url || item.image_url || item.output_url || root.url || "");
  const rawBase64 = String(item.b64_json || item.base64 || item.image_base64 || "");

  return {
    imageUrl: /^https?:\/\//i.test(rawUrl) || rawUrl.startsWith("data:image/") ? rawUrl : "",
    b64Json: rawBase64,
    mimeType: String(item.mime_type || "image/png"),
  };
}

async function nativePostJson(url: string, headers: Record<string, string>, data: unknown) {
  const http = (window as unknown as {
    CapacitorHttp?: {
      post: (options: { url: string; headers?: Record<string, string>; data?: unknown; connectTimeout?: number; readTimeout?: number }) => Promise<{ status: number; data: unknown }>;
    };
  }).CapacitorHttp;

  if (http?.post) {
    const response = await http.post({ url, headers, data, connectTimeout: 180000, readTimeout: 180000 });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Image API error [${response.status}]: ${typeof response.data === "string" ? response.data : JSON.stringify(response.data)}`);
    }
    return response.data;
  }

  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(data) });
  if (!res.ok) {
    throw new Error(`Image API error [${res.status}]: ${await res.text().catch(() => res.statusText)}`);
  }
  return res.json();
}

export async function requestImage<T = Record<string, unknown>>(body: ImageBody): Promise<T> {
  const cfg = readSavedImageConfig();

  if (!isNativeRuntime()) {
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      const hasFrontendConfig = Boolean(cfg.apiKey && cfg.baseUrl);
      if (hasFrontendConfig) {
        headers["x-image-key"] = cfg.apiKey;
        headers["x-image-base"] = cfg.baseUrl;
        if (cfg.model) headers["x-image-model"] = cfg.model;
        if (cfg.authScheme) headers["x-image-auth"] = cfg.authScheme;
        if (cfg.size) headers["x-image-size"] = cfg.size;
      }

      const res = await fetch("/api/image", {
        method: "POST",
        headers,
        body: JSON.stringify({ ...body, size: body.size || cfg.size }),
      });
      if ((res.headers.get("content-type") || "").includes("application/json")) {
        return res.json();
      }
    } catch {
      // Static hosts such as GitHub Pages do not provide Next.js API routes.
    }
  }

  if (!cfg.apiKey || !cfg.baseUrl) {
    return {
      error: "生图接口未配置",
      detail: "请先在设置页填写生图 API Key 和 Base URL，或使用服务端环境变量配置。",
    } as T;
  }

  const endpoint = buildOpenAIImageGenerationsUrl(cfg.baseUrl);
  const prompt = `${COMIC_SYSTEM_PROMPT}\n\n${String(body.content || "")}`;
  let data: unknown;
  try {
    data = await nativePostJson(
      endpoint,
      authHeaders(cfg.apiKey, cfg.authScheme),
      { model: cfg.model || "gpt-image-1", prompt, size: String(body.size || cfg.size || "1024x1024"), n: 1 },
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      error: "生图接口调用失败",
      detail,
    } as T;
  }
  const image = pickImage(data);

  if (!image.imageUrl && !image.b64Json) {
    return {
      error: "生图接口未返回图片",
      detail: "响应中没有找到图片 URL 或 base64 字段。",
    } as T;
  }

  return {
    source: "image-api",
    model: cfg.model,
    ...image,
  } as T;
}
