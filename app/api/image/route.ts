import { NextResponse } from "next/server";
import { buildOpenAIImageGenerationsUrl } from "@/lib/ai-endpoints";
import { buildComicPrompt } from "@/lib/comic-prompt";

export const runtime = "nodejs";
export const maxDuration = 60;

type ImageRequestBody = {
  content?: string;
  prompt?: string;
  size?: string;
};

type ImageItem = {
  url?: string;
  image_url?: string;
  b64_json?: string;
  b64?: string;
  base64?: string;
  image_base64?: string;
  mime_type?: string;
  revised_prompt?: string;
};

type ImageResponse = {
  data?: ImageItem[];
  images?: ImageItem[];
  output?: Array<ImageItem | { result?: string; url?: string; b64_json?: string }>;
  result?: string;
  url?: string;
  b64_json?: string;
};

function getAuthHeaders(apiKey: string, authScheme: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authScheme === "x-api-key") {
    headers["x-api-key"] = apiKey;
  } else {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }
  return headers;
}

function pickImage(data: ImageResponse) {
  const item = data.data?.[0] || data.images?.[0] || data.output?.[0] || data;
  if (!item) return null;

  const rawResult = ("result" in item ? item.result : "") || "";
  const rawImage =
    item.url ||
    ("image_url" in item ? item.image_url : "") ||
    rawResult ||
    "";
  const imageUrl = /^https?:\/\//i.test(rawImage) || rawImage.startsWith("data:image/") ? rawImage : "";
  const b64Json =
    item.b64_json ||
    ("b64" in item ? item.b64 : "") ||
    ("base64" in item ? item.base64 : "") ||
    ("image_base64" in item ? item.image_base64 : "") ||
    (!imageUrl ? rawResult : "") ||
    "";

  return {
    imageUrl,
    b64Json,
    mimeType: ("mime_type" in item ? item.mime_type : "") || "image/png",
    revisedPrompt: ("revised_prompt" in item ? item.revised_prompt : "") || "",
  };
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as ImageRequestBody;
  const content = String(body.content || body.prompt || "").trim();
  const size = String(body.size || req.headers.get("x-image-size") || process.env.IMAGE_SIZE || "1024x1024");

  const apiKey =
    req.headers.get("x-image-key") ||
    req.headers.get("x-ai-key") ||
    process.env.IMAGE_API_KEY ||
    process.env.AI_API_KEY ||
    "";
  const baseUrl =
    req.headers.get("x-image-base") ||
    req.headers.get("x-ai-base") ||
    process.env.IMAGE_BASE_URL ||
    process.env.AI_BASE_URL ||
    "";
  const model = req.headers.get("x-image-model") || process.env.IMAGE_MODEL || "gpt-image-2";
  const authScheme =
    req.headers.get("x-image-auth") ||
    req.headers.get("x-ai-auth") ||
    process.env.IMAGE_AUTH_SCHEME ||
    process.env.AI_AUTH_SCHEME ||
    "bearer";

  if (!content) {
    return NextResponse.json({ error: "缺少讲解内容，无法生成漫画分镜。" }, { status: 400 });
  }

  if (/【视觉题保护】题图缺失|不能生成可靠漫画讲解/.test(content)) {
    return NextResponse.json(
      {
        error: "图形题缺少题图",
        detail: "这道题需要先看到题干图和选项图。请刷新题库页或上传清晰截图并先生成AI错因讲解，再生成漫画讲解。",
      },
      { status: 400 },
    );
  }

  if (!apiKey || !baseUrl) {
    return NextResponse.json(
      { error: "生图接口未配置", detail: "请在设置页填写生图 API Key 和 Base URL，或复用文字 AI 接口配置。" },
      { status: 400 },
    );
  }

  const endpoint = buildOpenAIImageGenerationsUrl(baseUrl);

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: getAuthHeaders(apiKey, authScheme),
      body: JSON.stringify({
        model,
        prompt: buildComicPrompt(content),
        n: 1,
        size,
      }),
      signal: AbortSignal.timeout(180000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return NextResponse.json(
        {
          error: "生图接口调用失败",
          detail: `HTTP ${res.status} · ${errText.slice(0, 500)}`,
          endpoint,
        },
        { status: res.status },
      );
    }

    const data = (await res.json()) as ImageResponse;
    const image = pickImage(data);

    if (!image || (!image.imageUrl && !image.b64Json)) {
      return NextResponse.json(
        { error: "生图接口未返回图片", detail: "响应中没有找到 data[0].url 或 data[0].b64_json。", raw: data },
        { status: 502 },
      );
    }

    return NextResponse.json({
      source: "ai",
      model,
      endpoint,
      ...image,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const detail = message.includes("timeout") || message.includes("aborted") ? "生图耗时较长，请稍后重试或在设置页选择更快的图片模型。" : message;
    return NextResponse.json({ error: "生图请求异常", detail, endpoint }, { status: 500 });
  }
}
