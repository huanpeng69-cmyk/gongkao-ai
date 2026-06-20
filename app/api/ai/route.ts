import { NextResponse } from "next/server";
import { buildAnthropicMessagesUrl, buildOpenAIChatCompletionsUrl } from "@/lib/ai-endpoints";
import { toDisplayList, toDisplayText } from "@/lib/ai-display";

type BihangMethod = {
  name: string;
  standard: string;
  logic: string;
  tip: string;
};

const BIHANG_METHODS: Record<string, BihangMethod> = {
  削弱论证: {
    name: "削弱论证秒杀法",
    standard: '题干含"削弱""反驳""质疑""最能削弱"等关键词',
    logic: "1.找论点 2.看论据 3.按力度排序选最强削弱项",
    tip: "问它因、断因果、否论据、质样本",
  },
  加强论证: {
    name: "一招制胜加强论证",
    standard: '题干含"加强""支持""最能支持"等关键词',
    logic: "1.提取论点 2.找论证缺口 3.选补缺项",
    tip: "补缺陷、搭桥梁、排他因",
  },
  前提假设: {
    name: "搭桥法秒杀前提题",
    standard: '题干含"前提""隐含假设""必须为真"等关键词',
    logic: "1.找论据和结论的逻辑跳跃 2.建立跳跃概念的联系",
    tip: "找到论据A到结论B，前提就是A到B的桥",
  },
  工程问题: {
    name: "正反比较秒杀工程问题",
    standard: "三要素(工作量、效率、时间)中有一个相等",
    logic: "1.找相同要素 2.用正反比关系 3.结合公约数",
    tip: "看到合作就想效率相加，看到单独就想总量不变",
  },
  排列组合: {
    name: "捆绑插板法",
    standard: "出现相邻/相离/至少的排列组合",
    logic: "相邻用捆绑法，相离用插板法，含至少先考虑抽屉法",
    tip: "先捆绑后排，先插板后分",
  },
  资料分析: {
    name: "截位直除秒杀资料分析",
    standard: "出现大量除法运算",
    logic: "1.看选项差距 2.截位 3.直除得答案",
    tip: "选项差距>10%截2位，<10%截3位",
  },
};

const GONGKAO_MASTER_PROMPT = `你是一位资深公考笔试私教，精通行测、申论、公基。讲解必须优先使用以下内置方法论：
1. 角色：像靠谱培训老师，先讲方法，再讲题目，给完整解题思路，不只报答案。
2. 行测总纲：五星据月 + 六略思维。常识用正经人思维、选项矛盾、生活逻辑；时政用"巨星圈"：党/中央 > 中国特色社会主义/社会主义 > 人民 > 国家，遇到核心、根本、首要优先看党的领导；绝对化、时间节点、顿号并列容易设坑。
3. 言语：逻辑填空找语境呼应和词语辨析；片段阅读抓主题句、转折后、总结句、首尾句；细节题逐项对比原文，警惕偷换、以偏概全、无中生有。
4. 判断：翻译推理看充分/必要条件，真假推理找矛盾关系；加强削弱先找论点和论据，再用搭桥、拆桥、补论据、否论据；图推按点线角面素、位置、样式排查。
5. 数量：优先赋值法、方程法、十字交叉、容斥、捆绑插空；先识别题型，再选最快路径。
6. 资料分析：先读时间、主体、单位、指标；公式包括增长率=增长量/基期量，比重=部分/整体，间隔增长率=r1+r2+r1*r2；速算用截位直除、特征数字、错位加减，先看选项差距。
7. 申论：点线面整体化。审身份、范围、任务、要求；找五要素：含义/问题/原因/影响/对策；利用转折、递进、并列、因果、条件、标点和高频词找点。
8. 公基：马哲、公文、中特、经济、管理要先给框架再落细节。
输出风格：像"公考智学"学习卡片。先给一段120-220字的深度解析总述，语气像老师当面讲清楚；再提炼3-6条"要点归纳"；最后给"记忆口诀"和"经典例题/类比"。不要空泛鼓励，不要堆概念。
格式纪律：严格返回JSON；所有可展示字段都必须是字符串或字符串数组，数组项绝不能是对象；没有内容就返回空字符串或空数组。`;

function withMasterPrompt(task: string) {
  return `${GONGKAO_MASTER_PROMPT}

${task}`;
}

function localAnalysis(question: string, userAnswer: string, correctAnswer: string, module?: string) {
  const isCorrect = userAnswer === correctAnswer;
  const errorTypes = ["知识盲区", "概念混淆", "审题失误", "计算/推理错误", "思路偏差", "时间压力"];
  const errorType = isCorrect ? null : errorTypes[Math.floor(Math.random() * errorTypes.length)];
  const bihangMethod = module && BIHANG_METHODS[module] ? BIHANG_METHODS[module] : null;

  return {
    isCorrect,
    errorType,
    bihangMethod,
    source: "local",
    analysis: isCorrect
      ? `这道题你答对了。题目：${question}`
      : `这道题未答对。题目：${question}`,
    suggestion: isCorrect
      ? "回答正确，继续保持。"
      : `错误原因：${errorType}。建议围绕相关知识点补练，并强化同类题型训练。`,
  };
}

function clipText(value: unknown, maxLength = 180) {
  const text = toDisplayText(value).replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

function localReviewKnowledge(input: {
  question: string;
  correctAnswer?: string;
  explanation?: string;
  module?: string;
  knowledgePoints?: unknown;
  context?: string;
}) {
  const moduleName = toDisplayText(input.module) || "综合题型";
  const points = toDisplayList(input.knowledgePoints, 4);
  const explanation = clipText(input.explanation, 220);
  const correctAnswer = clipText(input.correctAnswer, 80);
  const question = clipText(input.question, 160);
  const corePoint = points[0] || moduleName;

  return {
    source: "local_fallback",
    title: `${moduleName}复盘`,
    analysis: explanation
      ? `这道错题先按「${moduleName}」来复盘。核心不是只记答案，而是把题干条件、问法和选项差异重新对齐：正确答案是${correctAnswer || "题库标注答案"}。原解析提示为：${explanation}。下次遇到同类题，先定位考点，再用选项对照验证，避免凭第一感觉选择。`
      : `这道错题先按「${moduleName}」来复盘。题目关键信息是：${question}。正确答案是${correctAnswer || "题库标注答案"}。复习时不要只背答案，要重新说清题干问什么、正确选项凭什么成立、错选项错在哪里，这样下次遇到同类题才能迁移。`,
    keyPoints: [
      `先定位题型：${moduleName}`,
      `抓核心考点：${corePoint}`,
      correctAnswer ? `记住正确答案依据：${correctAnswer}` : "把正确选项的成立条件说清楚",
      "逐项比较错选项和正确选项",
      "复盘时用自己的话重讲一遍解题路径",
    ],
    method: "1. 圈出问法；2. 提取题干关键词和限制条件；3. 对照选项排除干扰；4. 用正确答案反推自己错选的原因。",
    mnemonic: "先问法，后条件；先排错，再定选。",
    example: `同类题看到「${moduleName}」或「${corePoint}」相关问法时，先套上面的四步，不急着凭印象选。`,
  };
}

function isVisualQuestionText(value: string, module?: string) {
  return /图形|图推|问号处|题图|选项图|下列图|左边给定|右边.*选项|呈现.*规律|见题图|见选项图/i.test(`${module || ""}\n${value}`);
}

function buildAnalysisPrompt(input: {
  question: string;
  userAnswer: string;
  correctAnswer: string;
  explanation?: string;
  context?: string;
  module?: string;
  hasImages?: boolean;
}) {
  const visualQuestion = isVisualQuestionText(input.question, input.module);
  return withMasterPrompt(`请分析以下答题情况，并严格返回 JSON。

题目：${input.question}
用户答案：${input.userAnswer}
正确答案：${input.correctAnswer}
模块：${input.module || "未分类"}
原始解析：${input.explanation || "无"}
补充材料：${input.context || "无"}
是否包含题图/选项图：${input.hasImages ? "是，必须读取图片后再分析" : "否或未取到图片"}

${visualQuestion ? `图形题硬性规则：
1. 如果图片不可见、选项图不可见、或题干只有"问号处/见题图/见选项图"这类占位信息，必须明确说"题图/选项图缺失，无法可靠判断具体规律"，不能编造图形规律、不能编造答案依据。
2. 只有在你确实读取到题图，或原始解析已经给出明确图形特征时，才允许说明具体规律和答案。
3. 如果无法判断，只分析用户错因可能是"题图信息缺失/未按图形特征分析"，并建议重新加载题图或上传清晰截图。` : ""}

返回格式：
{
  "title": "10字以内标题",
  "errorType": "知识盲区/概念混淆/审题失误/计算推理错误/思路偏差/时间压力",
  "analysis": "120-220字总述：先定位题型和错因，再讲正确切入点",
  "keyPoints": ["3-5条字符串要点，不能返回对象"],
  "method": "可迁移的解题步骤",
  "mnemonic": "记忆口诀；没有则空字符串",
  "example": "同类题识别例子或类比；没有则空字符串",
  "suggestion": "针对性复习建议",
  "bihangTip": "如果适合秒杀技巧，给出技巧名称和口诀"
}`);
}

function buildFenbiQuestionPrompt(input: {
  question: string;
  userAnswer?: string;
  correctAnswer?: string;
  analysis?: string;
  material?: string;
  sourceTitle?: string;
}) {
  return withMasterPrompt(`请基于粉笔题库数据给出清晰、结构化的讲解。

题目来源：${input.sourceTitle || "粉笔行测"}
题目：${input.question}
用户答案：${input.userAnswer || "未作答"}
正确答案：${input.correctAnswer || "未知"}
材料：${input.material || "无"}
粉笔解析：${input.analysis || "无"}

**输出要求**：
1. analysis只写一段总述，像截图里的"AI学习路径深度解析"，先定位题型，再讲核心路径
2. keyPoints必须是3-6个短字符串，用于页面的"要点归纳"列表
3. mnemonic写成可背的口令，example写成短例题/类比，answerSummary一锤定音
4. 禁止在keyPoints、followUpQuestions里返回对象，禁止出现[object Object]

严格返回 JSON：
{
  "title": "10字以内概括",
  "analysis": "120-220字总述，说明题型定位、核心思路和为什么这样做",
  "keyPoints": ["3-6个核心要点，数组项必须是字符串"],
  "mnemonic": "记忆口诀（如有）；无则留空",
  "example": "1个贴近考点的例子或类比",
  "followUpQuestions": ["2-3个可继续追问的问题，数组项必须是字符串"],
  "answerSummary": "一句话总结正确答案和判断理由"
}`);
}

function buildReviewKnowledgePrompt(input: {
  question: string;
  correctAnswer?: string;
  explanation?: string;
  module?: string;
  knowledgePoints?: string[];
  context?: string;
}) {
  return withMasterPrompt(`请围绕错题做"知识讲解 + 解题方法复盘"，重点帮助用户下次识别同类题。

模块：${input.module || "未分类"}
知识点：${input.knowledgePoints?.join("、") || "无"}
材料：${input.context || "无"}
题目：${input.question}
正确答案：${input.correctAnswer || "未知"}
原解析：${input.explanation || "无"}

**输出要求**：
1. analysis只写一段总述：先讲核心概念，再讲这道题怎么迁移
2. keyPoints必须是3-6个短字符串，用于"要点归纳"列表
3. method写成简短步骤，mnemonic写成可背口诀，example给一个同类题识别例子
4. 禁止在keyPoints里返回对象，禁止出现[object Object]

严格返回 JSON：
{
  "title": "10字以内讲解标题",
  "analysis": "120-220字总述，说明核心概念、解题路径和易错处",
  "keyPoints": ["3-6个必须记住的点，数组项必须是字符串"],
  "method": "可迁移到同类题的方法步骤，写成简短框架",
  "mnemonic": "记忆口诀（如适合）；不适合则留空",
  "example": "1个同类题识别例子或简短类比"
}`);
}

function buildHomeTutorPrompt(input: { prompt?: string; context?: string; imageName?: string }) {
  return withMasterPrompt(`你是公考私教，用户上传了题目或提出学习问题，请给出清晰、结构化的讲解。

用户问题：${input.prompt || "请根据上传图片讲解题目"}
图片文件：${input.imageName || "无"}
补充信息：${input.context || "无"}

**输出要求**：
1. 如果有图片，必须先识别图片里的题干、选项、图表或材料，再讲解；看不清就明确说看不清哪一部分，不能编题
2. analysis只写一段总述，先说题型/知识点定位，再说解题路径和核心原理
3. keyPoints必须是3-6个短字符串，用于"要点归纳"列表
4. mnemonic写成可背口诀，example给一个经典例题/类比，answerSummary一句话收束
5. 禁止在keyPoints里返回对象，禁止出现[object Object]

严格返回 JSON：
{
  "title": "10字以内标题",
  "analysis": "120-220字总述，说明题目/知识点定位、核心思路和落地方法",
  "keyPoints": ["3-6个核心要点，数组项必须是字符串"],
  "method": "可迁移的方法论，写成简短的步骤或框架",
  "mnemonic": "记忆口诀（如果适合）；不适合则留空字符串",
  "example": "1个同类题识别例子或类比说明",
  "answerSummary": "一句话总结答案和判断依据"
}`);
}

function extractBalancedJson(text: string) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```json\s*([\s\S]*?)```/i) || trimmed.match(/```\s*([\s\S]*?)```/);
  const candidate = (fenced?.[1] ?? trimmed).trim();

  const tryParse = (value: string) => {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  };

  const direct = tryParse(candidate);
  if (direct !== null) return direct;

  const scan = (openChar: "{" | "[", closeChar: "}" | "]") => {
    const start = candidate.indexOf(openChar);
    if (start < 0) return null;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < candidate.length; i += 1) {
      const ch = candidate[i];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === "\\") {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }

      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === openChar) depth += 1;
      if (ch === closeChar) {
        depth -= 1;
        if (depth === 0) {
          return candidate.slice(start, i + 1);
        }
      }
    }
    return null;
  };

  const objectJson = scan("{", "}");
  if (objectJson) {
    const parsed = tryParse(objectJson);
    if (parsed !== null) return parsed;
  }

  const arrayJson = scan("[", "]");
  if (arrayJson) {
    const parsed = tryParse(arrayJson);
    if (parsed !== null) return parsed;
  }

  return null;
}

function uniqueImageInputs(inputs: unknown[]) {
  const seen = new Set<string>();
  const images: string[] = [];

  inputs.flat().forEach((input) => {
    const value = String(input || "").trim();
    if (!value || seen.has(value)) return;
    if (!value.startsWith("data:image/") && !/^https?:\/\//i.test(value)) return;
    seen.add(value);
    images.push(value);
  });

  return images.slice(0, 12);
}

function normalizeMode(mode: unknown) {
  const value = String(mode || "").trim();
  if (value === "home_tutor") return "tutor";
  if (value === "review_knowledge") return "review";
  return value;
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
    title: toDisplayText(result.title) || "AI学习解析",
    analysis,
    keyPoints: keyPoints.length ? keyPoints : derivedPoints,
    method: toDisplayText(result.method),
    mnemonic: toDisplayText(result.mnemonic),
    example: toDisplayText(result.example),
    answerSummary: toDisplayText(result.answerSummary),
    suggestion: toDisplayText(result.suggestion),
    errorType: toDisplayText(result.errorType),
    bihangTip: toDisplayText(result.bihangTip),
    followUpQuestions: toDisplayList(result.followUpQuestions, 3),
  };
}

function normalizeRawAiText(rawText: string) {
  const parsed = extractBalancedJson(rawText);
  if (parsed) return normalizeAiResult(parsed);

  return normalizeAiResult({
    title: "AI学习解析",
    analysis: rawText,
  });
}

function getMimeTypeFromUrl(url: string) {
  const cleanUrl = url.split("?")[0].toLowerCase();
  if (cleanUrl.endsWith(".jpg") || cleanUrl.endsWith(".jpeg")) return "image/jpeg";
  if (cleanUrl.endsWith(".webp")) return "image/webp";
  if (cleanUrl.endsWith(".gif")) return "image/gif";
  return "image/png";
}

async function resolveImageDataUrl(input: string) {
  if (input.startsWith("data:image/")) return input;

  const res = await fetch(input, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`Image fetch failed [${res.status}]`);

  const contentType = res.headers.get("content-type")?.split(";")[0] || getMimeTypeFromUrl(input);
  const buffer = Buffer.from(await res.arrayBuffer());
  return `data:${contentType};base64,${buffer.toString("base64")}`;
}

async function callOpenAICompatible(
  prompt: string,
  images: string[],
  config?: { apiKey?: string; model?: string; baseUrl?: string; authScheme?: string; maxTokens?: number; temperature?: number }
) {
  const apiKey = config ? (config.apiKey || "") : (process.env.AI_API_KEY || "");
  const model = config ? (config.model || "deepseek-chat") : (process.env.AI_MODEL || "deepseek-chat");
  const baseUrl = config ? (config.baseUrl || "") : (process.env.AI_BASE_URL || "");
  const authScheme = config ? (config.authScheme || "bearer") : (process.env.AI_AUTH_SCHEME || "bearer");

  if (!apiKey) throw new Error("API Key not configured");
  if (!baseUrl) throw new Error("API Base URL not configured");

  const url = buildOpenAIChatCompletionsUrl(baseUrl);
  const body: Record<string, unknown> = {
    model,
    messages: [
      {
        role: "user",
        content:
          images.length > 0
            ? [{ type: "text", text: prompt }, ...images.map((src) => ({ type: "image_url", image_url: { url: src } }))]
            : prompt,
      },
    ],
    temperature: config?.temperature ?? 0.7,
    max_tokens: config?.maxTokens || 4096,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(authScheme === "x-api-key" ? { "x-api-key": apiKey } : { Authorization: `Bearer ${apiKey}` }),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`AI API error [${res.status}]: ${text || res.statusText}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

function isImageInputUnsupportedError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /image input|support image|vision|multi[-\s]?modal|modalit/i.test(message);
}

function buildImageUnsupportedResult(input: {
  provider: string;
  error: unknown;
  isCorrect?: boolean;
  hasTextFallback?: boolean;
}) {
  const detail = clipText(input.error instanceof Error ? input.error.message : String(input.error), 220);
  return {
    title: "模型不支持题图",
    errorType: "题图无法识别",
    analysis: input.hasTextFallback
      ? "当前系统设置里的模型不支持图片输入，已尝试改用题干文字、原始解析和补充材料生成解析。若这道题的关键规律只在题图或选项图里，纯文本模型无法可靠判断具体规律。"
      : "当前系统设置里的模型不支持图片输入，而这道题包含题图或选项图。缺少视觉能力时，AI 无法可靠读取图形元素、位置、数量、样式等关键信息，所以不能直接生成具体规律解析。",
    keyPoints: [
      "小米文本模型已被调用，但它不支持图片输入",
      "图形题需要支持视觉的模型才能读取题图和选项图",
      "若题库有原始解析，可基于文字解析继续复盘",
      "否则请换支持图片输入的模型，或上传/补充文字版图形特征",
    ],
    suggestion: "在系统设置中换用支持视觉输入的模型，或为本题补充可读的文字解析后再生成讲解。",
    isCorrect: input.isCorrect,
    source: "guard",
    apiError: `${input.provider} 模型不支持图片输入：${detail}`,
  };
}

function parseDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:(image\/[a-z]+);base64,(.+)$/i);
  if (!match) throw new Error("Invalid data URL");
  return { mediaType: match[1], data: match[2] };
}

async function callAnthropic(
  prompt: string,
  images: string[],
  config?: { apiKey?: string; model?: string; baseUrl?: string; maxTokens?: number }
) {
  const apiKey = config ? (config.apiKey || "") : (process.env.ANTHROPIC_API_KEY || "");
  const model = config ? (config.model || "claude-3-5-sonnet-20241022") : (process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-20241022");
  const baseUrl = config ? (config.baseUrl || "") : (process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com");

  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");
  if (!baseUrl) throw new Error("ANTHROPIC_BASE_URL not configured");

  const url = buildAnthropicMessagesUrl(baseUrl);
  const content: Array<{ type: string; text?: string; source?: { type: string; media_type: string; data: string } }> = [
    { type: "text", text: prompt },
  ];

  for (const src of images) {
    const dataUrl = src.startsWith("data:") ? src : await resolveImageDataUrl(src);
    const { mediaType, data } = parseDataUrl(dataUrl);
    content.push({ type: "image", source: { type: "base64", media_type: mediaType, data } });
  }

  const body = {
    model,
    max_tokens: config?.maxTokens || 4096,
    messages: [{ role: "user", content }],
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Anthropic API error [${res.status}]: ${text || res.statusText}`);
  }

  const data = await res.json();
  return data.content?.[0]?.text || "";
}

function getEffectiveAiProvider(frontendConfig: { apiKey?: string; baseUrl?: string; protocol?: string }, preferFrontend = false) {
  if (preferFrontend || (frontendConfig.apiKey && frontendConfig.baseUrl)) {
    return (frontendConfig.protocol || "openai").toLowerCase();
  }
  return (process.env.AI_PROVIDER || "openai").toLowerCase();
}

function getEffectiveAiConfig(frontendConfig: {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  authScheme?: string;
  protocol?: string;
}, preferFrontend = false) {
  if (preferFrontend || (frontendConfig.apiKey && frontendConfig.baseUrl)) {
    return frontendConfig;
  }
  return {
    apiKey: process.env.AI_API_KEY || "",
    baseUrl: process.env.AI_BASE_URL || "",
    model: process.env.AI_MODEL || "",
    authScheme: process.env.AI_AUTH_SCHEME || "bearer",
    protocol: process.env.AI_PROVIDER || "openai",
  };
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      mode,
      question,
      userAnswer,
      correctAnswer,
      explanation,
      module,
      knowledgePoints,
      context,
      material,
      sourceTitle,
      prompt,
      images,
      imageDataUrl,
      imageDataUrls,
      imageUrls,
      imageName,
    } = body;

    // 从请求头读取前端配置
    const headers = request.headers;
    const hasFrontendConfigHeaders =
      headers.has("x-ai-key") ||
      headers.has("x-ai-base") ||
      headers.has("x-ai-model") ||
      headers.has("x-ai-provider") ||
      headers.has("x-ai-auth");
    const frontendConfig = {
      apiKey: headers.get("x-ai-key") || "",
      baseUrl: headers.get("x-ai-base") || "",
      model: headers.get("x-ai-model") || "",
      authScheme: headers.get("x-ai-auth") || "bearer",
      protocol: headers.get("x-ai-provider") || "openai",
    };

    const effectiveConfig = getEffectiveAiConfig(frontendConfig, hasFrontendConfigHeaders);
    const provider = getEffectiveAiProvider(effectiveConfig, true);
    const requestMode = normalizeMode(mode);
    const imageInputs = uniqueImageInputs([images, imageDataUrl, imageDataUrls, imageUrls].flat());
    const hasUsableAiConfig = Boolean(effectiveConfig.apiKey && effectiveConfig.baseUrl);

    if (requestMode === "analyze") {
      if (!question || !userAnswer || !correctAnswer) {
        return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
      }

      const visualQuestion = isVisualQuestionText(question, module);
      const hasUsefulTextExplanation = Boolean(toDisplayText(explanation || context || material));
      if (visualQuestion && imageInputs.length === 0 && !hasUsefulTextExplanation) {
        return NextResponse.json({
          title: "题图缺失",
          errorType: "题图信息缺失",
          analysis: "这道题属于图形/选图类题目，但当前请求没有拿到题图或选项图，也没有可用的原始解析。没有图形细节时无法可靠判断规律和答案，继续生成会变成猜题。",
          keyPoints: [
            "请先确认题干图和选项图已正常加载",
            "图形题必须看元素、位置、数量、样式或对称等具体特征",
            "没有题图时不能编造规律或答案依据",
          ],
          suggestion: "刷新题库页或上传清晰题目截图后再生成错因讲解。",
          isCorrect: userAnswer === correctAnswer,
          source: "guard",
        });
      }

      const useFallback = !hasUsableAiConfig;
      if (useFallback) {
        const result = localAnalysis(question, userAnswer, correctAnswer, module);
        return NextResponse.json(result);
      }

      const promptText = buildAnalysisPrompt({
        question,
        userAnswer,
        correctAnswer,
        explanation,
        context,
        module,
        hasImages: imageInputs.length > 0,
      });
      let rawText = "";

      try {
        if (provider === "anthropic") {
          rawText = await callAnthropic(promptText, imageInputs, effectiveConfig);
        } else {
          rawText = await callOpenAICompatible(promptText, imageInputs, effectiveConfig);
        }
      } catch (error) {
        if (imageInputs.length > 0 && isImageInputUnsupportedError(error)) {
          const textOnlyPrompt = buildAnalysisPrompt({
            question,
            userAnswer,
            correctAnswer,
            explanation,
            context,
            module,
            hasImages: false,
          });

          try {
            if (provider === "anthropic") {
              rawText = await callAnthropic(textOnlyPrompt, [], effectiveConfig);
            } else {
              rawText = await callOpenAICompatible(textOnlyPrompt, [], effectiveConfig);
            }
          } catch {
            return NextResponse.json(buildImageUnsupportedResult({
              provider,
              error,
              isCorrect: userAnswer === correctAnswer,
              hasTextFallback: false,
            }));
          }
        } else {
          throw error;
        }
      }

      return NextResponse.json({
        ...normalizeRawAiText(rawText),
        isCorrect: userAnswer === correctAnswer,
        source: provider,
      });
    }

    if (requestMode === "fenbi") {
      if (!question) {
        return NextResponse.json({ error: "Missing question" }, { status: 400 });
      }

      const promptText = buildFenbiQuestionPrompt({
        question,
        userAnswer,
        correctAnswer,
        analysis: explanation,
        material,
        sourceTitle,
      });

      let rawText = "";
      if (provider === "anthropic") {
        rawText = await callAnthropic(promptText, imageInputs, effectiveConfig);
      } else {
        rawText = await callOpenAICompatible(promptText, imageInputs, effectiveConfig);
      }

      return NextResponse.json({ ...normalizeRawAiText(rawText), source: provider });
    }

    if (requestMode === "review") {
      if (!question) {
        return NextResponse.json({ error: "Missing question" }, { status: 400 });
      }

      if (!hasUsableAiConfig) {
        return NextResponse.json(localReviewKnowledge({
          question,
          correctAnswer,
          explanation,
          module,
          knowledgePoints,
          context,
        }));
      }

      const promptText = buildReviewKnowledgePrompt({
        question,
        correctAnswer,
        explanation,
        module,
        knowledgePoints,
        context,
      });

      try {
        let rawText = "";
        if (provider === "anthropic") {
          rawText = await callAnthropic(promptText, imageInputs, effectiveConfig);
        } else {
          rawText = await callOpenAICompatible(promptText, imageInputs, effectiveConfig);
        }

        return NextResponse.json({ ...normalizeRawAiText(rawText), source: provider });
      } catch (error) {
        console.error("Review knowledge AI fallback:", error);
        return NextResponse.json({
          ...localReviewKnowledge({
            question,
            correctAnswer,
            explanation,
            module,
            knowledgePoints,
            context,
          }),
          apiError: `外部 AI 暂不可用，已使用本地讲解：${clipText(error instanceof Error ? error.message : String(error), 220)}`,
        });
      }
    }

    if (requestMode === "tutor") {
      const promptText = buildHomeTutorPrompt({ prompt, context, imageName });

      let rawText = "";
      if (provider === "anthropic") {
        rawText = await callAnthropic(promptText, imageInputs, effectiveConfig);
      } else {
        rawText = await callOpenAICompatible(promptText, imageInputs, effectiveConfig);
      }

      return NextResponse.json({ ...normalizeRawAiText(rawText), source: provider });
    }

    return NextResponse.json({ error: "Invalid mode" }, { status: 400 });
  } catch (error) {
    console.error("AI API Error:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unknown error",
        details: error instanceof Error ? error.stack : undefined,
      },
      { status: 500 },
    );
  }
}
