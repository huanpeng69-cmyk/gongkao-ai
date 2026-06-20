export function normalizeEndpointBase(baseUrl: string) {
  return baseUrl.trim().replace(/\/+$/, "");
}

export function buildOpenAIChatCompletionsUrl(baseUrl: string) {
  const base = normalizeEndpointBase(baseUrl);
  if (/\/chat\/completions$/i.test(base)) return base;
  if (/\/v\d+$/i.test(base)) return `${base}/chat/completions`;
  return `${base}/v1/chat/completions`;
}

export function buildAnthropicMessagesUrl(baseUrl: string) {
  const base = normalizeEndpointBase(baseUrl);
  if (/\/v1\/messages$/i.test(base)) return base;
  if (/\/v1$/i.test(base)) return `${base}/messages`;
  return `${base}/v1/messages`;
}

export function buildOpenAIImageGenerationsUrl(baseUrl: string) {
  const base = normalizeEndpointBase(baseUrl);
  if (/\/images\/generations$/i.test(base)) return base;
  if (/\/v\d+$/i.test(base)) return `${base}/images/generations`;
  return `${base}/v1/images/generations`;
}
