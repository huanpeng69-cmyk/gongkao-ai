export const AGNES_PROVIDER = "agnes" as const;
export const AGNES_NAME = "Agnes AI";
export const AGNES_BASE_URL = "https://apihub.agnes-ai.com/v1";
export const AGNES_ORIGIN = "https://apihub.agnes-ai.com";
export const AGNES_TEXT_MODEL = "agnes-2.0-flash";
export const AGNES_IMAGE_MODEL = "agnes-image-2.1-flash";
export const AGNES_IMAGE_SIZE = "1K";
export const AGNES_IMAGE_RATIO = "1:1";

export type AgnesModality = "text" | "image";

export function normalizeAgnesBaseUrl(value?: string | null) {
  const candidate = String(value || "").trim().replace(/\/+$/, "");
  if (!candidate) return AGNES_BASE_URL;

  try {
    const url = new URL(candidate);
    if (url.origin !== AGNES_ORIGIN) return AGNES_BASE_URL;
    if (/\/v\d+$/i.test(url.pathname)) return `${url.origin}${url.pathname}`;
  } catch {
    return AGNES_BASE_URL;
  }

  return AGNES_BASE_URL;
}

export function isAgnesUrl(value?: string | null) {
  try {
    return new URL(String(value || "")).origin === AGNES_ORIGIN;
  } catch {
    return false;
  }
}

export function buildAgnesChatUrl(baseUrl = AGNES_BASE_URL) {
  return `${normalizeAgnesBaseUrl(baseUrl)}/chat/completions`;
}

export function buildAgnesImageUrl(baseUrl = AGNES_BASE_URL) {
  return `${normalizeAgnesBaseUrl(baseUrl)}/images/generations`;
}

export function buildAgnesModelsUrl(baseUrl = AGNES_BASE_URL) {
  return `${normalizeAgnesBaseUrl(baseUrl)}/models`;
}

export function agnesAuthHeaders(apiKey: string) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
}

export function buildAgnesImagePayload(input: { prompt: string; model?: string; size?: string; ratio?: string }) {
  return {
    model: input.model || AGNES_IMAGE_MODEL,
    prompt: input.prompt,
    size: input.size || AGNES_IMAGE_SIZE,
    ratio: input.ratio || AGNES_IMAGE_RATIO,
    extra_body: { response_format: "url" },
  };
}
