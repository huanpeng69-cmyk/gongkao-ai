import { NextResponse } from "next/server";
import { buildOpenAIImageGenerationsUrl } from "@/lib/ai-endpoints";

export const runtime = "nodejs";
export const maxDuration = 60;

const COMIC_STORYBOARD_PROMPT =
  "生成一组用于公考题目讲解的多格漫画分镜，必须先阅读并理解下方输入的题干、材料、选项、正确答案和AI讲解，再把解题过程画出来。\n\n**硬性要求**：\n1. 输入内容是唯一依据，不得自创题目、人物剧情、数字、选项或结论。\n2. 每一格都要对应真实解题步骤：读题定位→提取条件→排除/计算/推理→锁定答案→方法总结。\n3. 如果输入提到图形、表格、统计材料、选项文字，画面中必须用简化白板/卡片还原关键特征，不能只画泛泛课堂场景。\n4. 如果输入信息不足以确定题目内容，画面应表现“题目信息不足/需要补充截图”，不能乱生成看似完整的题。\n5. 画面文字只放短标题、关键词、公式、箭头和答案标记，保持清晰可读。\n\n**视觉风格**：现代教育插画，干净明亮，学习软件感；老师和学生作为辅助角色，重点放在白板、题干卡片、选项对比、表格/图形、推导箭头和最终答案。\n\n**分镜结构**：建议4-6格，逻辑递进，不做无关铺垫。";

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

function buildFinalPrompt(content: string) {
  return `${COMIC_STORYBOARD_PROMPT}

---

**输入题目与讲解内容**（以下内容是生成分镜的唯一依据）：

${content}

---

**重要提醒**：
- 分镜场景必须完全基于上述题目内容，不得添加无关情节
- 如果题目包含图形、表格、数据，分镜中必须画出该图形/表格的简化版本
- 如果输入中出现"视觉题保护"、"题图缺失"、"不能生成可靠漫画讲解"，必须画成信息缺失提示卡，不得生成具体答案或解题规律
- 解题步骤要与讲解内容的逻辑顺序一致
- 画面中的文字使用短标题、关键词、公式和箭头标注，确保清晰可读`;
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
  const model = req.headers.get("x-image-model") || process.env.IMAGE_MODEL || "gpt-image-1";
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
        prompt: buildFinalPrompt(content),
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
