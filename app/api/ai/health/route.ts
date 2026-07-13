import { NextResponse } from "next/server";
import {
  AGNES_BASE_URL,
  AGNES_IMAGE_MODEL,
  AGNES_PROVIDER,
  AGNES_TEXT_MODEL,
  agnesAuthHeaders,
  buildAgnesModelsUrl,
  type AgnesModality,
} from "@/lib/agnes-ai";

function classifyStatus(status: number) {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 404 || status === 405) return "unsupported";
  return "unreachable";
}

function response(payload: Record<string, unknown>, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(req: Request) {
  // Static GitHub Pages builds have no server route. Return an empty non-JSON
  // response so the settings page intentionally falls back to direct Agnes BYOK.
  if (process.env.MOBILE_EXPORT === '1') {
    return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  }

  const url = new URL(req.url);
  const modality: AgnesModality = url.searchParams.get("modality") === "image" ? "image" : "text";
  const headerKey = modality === "image"
    ? req.headers.get("x-image-key") || req.headers.get("x-ai-key") || ""
    : req.headers.get("x-ai-key") || "";
  const apiKey = headerKey || process.env.AGNES_API_KEY ||
    (modality === "image" ? process.env.AI_IMAGE_API_KEY : process.env.AI_TEXT_API_KEY) || "";
  const model = modality === "image"
    ? req.headers.get("x-image-model") || process.env.AI_IMAGE_MODEL || AGNES_IMAGE_MODEL
    : req.headers.get("x-ai-model") || process.env.AI_TEXT_MODEL || AGNES_TEXT_MODEL;
  const endpoint = buildAgnesModelsUrl(AGNES_BASE_URL);
  const diagnostics = {
    modality,
    provider: AGNES_PROVIDER,
    target: endpoint,
    model,
    hasApiKey: Boolean(apiKey),
    test: "models-list",
  };

  if (!apiKey) {
    return response({
      status: "misconfigured",
      diagnostics: { ...diagnostics, suggestion: "请填写 Agnes API Key，或在服务端配置 AGNES_API_KEY。" },
    });
  }

  try {
    const startedAt = Date.now();
    const upstream = await fetch(endpoint, {
      method: "GET",
      headers: agnesAuthHeaders(apiKey),
      signal: AbortSignal.timeout(15000),
      cache: "no-store",
    });
    const elapsedMs = Date.now() - startedAt;

    if (!upstream.ok) {
      const detail = (await upstream.text().catch(() => "")).slice(0, 240);
      const status = classifyStatus(upstream.status);
      const suggestion = status === "unauthorized"
        ? "Agnes API Key 无效、已过期或无权访问，请在 Agnes 控制台检查。"
        : status === "unsupported"
          ? "Agnes 当前未开放模型列表端点；配置已保存，但无法执行非计费检测。"
          : "Agnes 服务暂时不可达，请稍后重试。";
      return response({
        status,
        diagnostics: { ...diagnostics, elapsedMs, httpStatus: upstream.status, detail, suggestion },
      });
    }

    const data = await upstream.json().catch(() => ({})) as { data?: Array<{ id?: string }> };
    const availableModels = Array.isArray(data.data)
      ? data.data.map((item) => String(item.id || "")).filter(Boolean)
      : [];
    return response({
      status: "ok",
      diagnostics: {
        ...diagnostics,
        elapsedMs,
        httpStatus: upstream.status,
        modelListed: availableModels.length ? availableModels.includes(model) : undefined,
        suggestion: availableModels.length && !availableModels.includes(model)
          ? "连接成功，但当前模型未出现在模型列表中；请确认模型名是否正确。"
          : "Agnes 非计费连通性检测通过。",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const timeout = /timeout|aborted/i.test(message);
    return response({
      status: "unreachable",
      diagnostics: {
        ...diagnostics,
        detail: timeout ? "连接 Agnes 超时（15 秒）。" : message.slice(0, 240),
        suggestion: timeout ? "请检查网络后重试。" : "请检查网络、系统时间和 Agnes 服务状态。",
      },
    });
  }
}
