#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DATA_PATH = path.join(ROOT, "data", "gkzhenti_questions.json");

const BIHANG_METHODS = {
  changshi: {
    title: "常识判断：巨星月优先法",
    route: [
      "先看设问对象和关键词，判断考的是政策、法律、人文科技还是生活常识。",
      "遇到时政和政治理论，优先抓“党、人民、国家、社会主义、中国式现代化”等高位表述。",
      "排除偷换主体、扩大范围、绝对化和时间节点错误的选项。",
    ],
    trap: "常识题不要只凭熟悉感选项，重点看表述是否稳、主体是否准、层级是否对。",
  },
  yanyu: {
    title: "言语理解：语境呼应法",
    route: [
      "先看文段结构，找转折、递进、因果、总结句和高频核心词。",
      "逻辑填空看搭配对象、感情色彩、轻重程度和前后照应。",
      "片段阅读先定主旨，再排除无中生有、以偏概全、偷换概念的选项。",
    ],
    trap: "言语题最怕被选项的漂亮表达带走，要回到文段主线和设问要求。",
  },
  panduan: {
    title: "判断推理：论点论据拆桥法",
    route: [
      "先识别题型：削弱加强看论点和论据，定义判断看关键词，类比看关系，图推看规律。",
      "论证题先找结论，再看选项是在搭桥、拆桥、补因、他因还是否定论据。",
      "形式逻辑题把条件翻译成推出关系，用逆否、包含、矛盾关系稳定推。",
    ],
    trap: "判断题不要凭生活经验硬推，选项必须直接作用于题干的逻辑链。",
  },
  ziliao: {
    title: "资料分析：截位直除法",
    route: [
      "先读时间、主体、单位和指标，防止把现期、基期、增长量、增长率看混。",
      "确定公式：增长率、增长量、比重、倍数、平均数或综合判断。",
      "根据选项差距选择截位、直除、估算或精算，优先用最省时间的路径。",
    ],
    trap: "资料题的坑多在时间、单位和问法，计算前先圈定比较对象。",
  },
  shuliang: {
    title: "数量关系：题型识别优先法",
    route: [
      "先判断是工程、行程、排列组合、经济利润、容斥、年龄还是数列题。",
      "能代入就代入，能设特值就设特值，能列方程就抓等量关系。",
      "排列组合优先分清是否有顺序、是否相邻/不相邻、是否至少/至多。",
    ],
    trap: "数量题不要一上来硬算，先找最快路径和选项可利用的信息。",
  },
  ggjc: {
    title: "公基：框架定位法",
    route: [
      "先定位知识板块：马哲中特、法律、公文、经济、管理、人文科技或时政。",
      "再看关键词对应的制度、原则、主体、程序和适用范围。",
      "排除张冠李戴、主体错位、绝对化和概念混搭的选项。",
    ],
    trap: "公基题要用框架记忆，不要把相近概念混在一起。",
  },
};

const SUBMODULE_METHODS = [
  {
    keys: ["削弱", "反驳", "质疑"],
    title: "削弱论证秒杀法",
    route: [
      "先找论点，弄清题干最终想证明什么。",
      "再找论据，判断论据到论点中间缺了哪座桥。",
      "优先选能断因果、举反例、指出他因或否定关键论据的选项。",
    ],
    trap: "只否定背景信息的选项力度通常不够，必须打到论证链上。",
  },
  {
    keys: ["加强", "支持"],
    title: "加强论证搭桥法",
    route: [
      "先提炼论点和论据，判断结论成立依赖哪个隐含条件。",
      "选项若能补上前提、排除他因或增加正向证据，优先考虑。",
      "比较力度时，直接建立论据与论点关系的选项更强。",
    ],
    trap: "只重复题干或只说结论可能正确，不如搭桥和排他因有力。",
  },
  {
    keys: ["前提", "假设"],
    title: "前提假设搭桥法",
    route: [
      "把题干拆成论据A和结论B。",
      "前提通常就是“A能够推出B”所缺少的必要条件。",
      "可用否定代入法检验：否定该选项后，论证是否立刻崩掉。",
    ],
    trap: "前提题要找必要条件，不是找看起来能加强的普通信息。",
  },
  {
    keys: ["定义"],
    title: "定义判断关键词法",
    route: [
      "圈出定义中的主体、对象、方式、目的、结果和限制条件。",
      "逐项比对，缺少任一核心要件的选项通常不能选。",
      "若定义有多个并列条件，要全部满足，而不是只满足其中一半。",
    ],
    trap: "定义判断不要扩大常识含义，以题干定义为唯一标准。",
  },
  {
    keys: ["类比"],
    title: "类比推理造句法",
    route: [
      "先判断词项关系：种属、组成、功能、工具、职业场所、因果或近反义。",
      "用一句话把题干关系说出来，再套到四个选项上。",
      "优先选择关系类型、前后顺序和语义色彩都一致的选项。",
    ],
    trap: "类比题相似词不一定对，关系一致才是核心。",
  },
  {
    keys: ["图形"],
    title: "图形推理五维排查法",
    route: [
      "按点、线、角、面、素和位置、样式、数量三个方向排查。",
      "先看整体变化，再看局部元素；先看明显规律，再看隐藏规律。",
      "若题组有分组或九宫格，重点看横纵对应和共同属性。",
    ],
    trap: "图推题不要盯着一个局部不放，规律必须能解释整组图形。",
  },
  {
    keys: ["资料", "增长", "比重", "平均", "倍数"],
    title: "资料分析公式定位法",
    route: [
      "先确定问的是现期、基期、增长量、增长率、比重还是倍数。",
      "再根据选项差距决定截位估算还是精算。",
      "综合判断题逐项回材料，先做明显对错项。",
    ],
    trap: "资料题常见坑是时间错、单位错、部分整体错。",
  },
  {
    keys: ["工程"],
    title: "工程问题效率法",
    route: [
      "把工作总量设成各时间的公倍数，方便效率整数化。",
      "合作就效率相加，单独做就总量除以单人效率。",
      "若有先后顺序，分段计算已完成量和剩余量。",
    ],
    trap: "工程题不要把时间相加当效率相加，效率才是核心。",
  },
  {
    keys: ["排列", "组合"],
    title: "排列组合捆绑插空法",
    route: [
      "先判断是否考虑顺序，考虑顺序用排列，不考虑顺序用组合。",
      "相邻用捆绑法，不相邻用插空法，至少问题常用反面计算。",
      "有特殊元素时先安排特殊对象，再安排普通对象。",
    ],
    trap: "排列组合最容易漏乘或重复计数，每一步都要说明对象是谁。",
  },
];

function parseArgs(argv) {
  const args = {
    dataPath: DATA_PATH,
    limit: Infinity,
    offset: 0,
    overwrite: false,
    dryRun: false,
    sourceOnly: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === "--data") args.dataPath = path.resolve(argv[++i]);
    else if (item === "--limit") args.limit = Number(argv[++i]);
    else if (item === "--offset") args.offset = Number(argv[++i]);
    else if (item === "--overwrite") args.overwrite = true;
    else if (item === "--dry-run") args.dryRun = true;
    else if (item === "--source-only") args.sourceOnly = true;
    else if (item === "--help" || item === "-h") {
      console.log(`Usage:
  node scripts/generate_bihang_explanations.js
  node scripts/generate_bihang_explanations.js --dry-run --limit 20

Options:
  --overwrite     Regenerate explanations even if they already look useful
  --dry-run       Print summary without writing
  --limit <n>     Process at most n questions
  --offset <n>    Skip n eligible questions
  --source-only   Only replace source-placeholder explanations`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${item}`);
    }
  }

  return args;
}

function decodeBasicEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function stripHtml(input = "") {
  return decodeBasicEntities(input)
    .replace(/<img\b[^>]*>/gi, "（见图）")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|table|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isSourcePlaceholder(explanation = "") {
  const text = stripHtml(explanation);
  return !text ||
    text === "无" ||
    /^来自\s*\d{4}年/.test(text) ||
    (text.startsWith("来自") && text.length < 80 && /(考试|真题|行测|申论)/.test(text));
}

function hasUsefulExplanation(explanation = "") {
  return !isSourcePlaceholder(explanation);
}

function normalizeAnswer(value) {
  if (Array.isArray(value)) return value.join("");
  if (typeof value === "boolean") return value ? "正确" : "错误";
  return String(value || "");
}

function getOptionText(question, key) {
  const option = (question.options || []).find((item) => String(item.key).toUpperCase() === String(key).toUpperCase());
  if (!option) return "";
  const text = stripHtml(option.text);
  return text && text.toUpperCase() !== String(key).toUpperCase() ? text : "";
}

function getCorrectOptionSummary(question) {
  const answer = normalizeAnswer(question.answer);
  if (Array.isArray(question.answer)) {
    return question.answer.map((key) => {
      const text = getOptionText(question, key);
      return text ? `${key}（${text}）` : key;
    }).join("、");
  }
  if (question.type === "true_false") return answer;
  const text = getOptionText(question, answer);
  return text ? `${answer}（${text}）` : answer;
}

function compactText(value, max = 180) {
  const text = stripHtml(value);
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function hasImageContent(value = "") {
  return /<img\b/i.test(String(value || ""));
}

function hasImageChoices(question) {
  return (question.options || []).some((option) => hasImageContent(option.text));
}

function isGraphicQuestion(question) {
  const text = `${question.module || ""} ${question.subModule || ""} ${question.question || ""}`;
  return question.moduleKey === "panduan" && (
    hasImageContent(question.question) ||
    hasImageContent(question.dataMaterial) ||
    hasImageChoices(question) ||
    /图形|图推|立体|展开图|折叠|正方体|六面体|截面|旋转|平移|翻转|相邻面|相对面|黑白块|一笔画/.test(text)
  );
}

function pickGraphicMethod(question) {
  const text = `${question.question || ""} ${question.dataMaterial || ""}`;
  const optionImages = hasImageChoices(question);

  if (/立体|展开图|折叠|正方体|六面体|相邻面|相对面|小方块|空间/.test(text)) {
    return {
      kind: "graphic",
      graphicType: "space",
      title: "图形推理：捏球法",
      route: [
        "先把展开图在脑中“捏成球”，不要直接凭视觉相似选。",
        "第一步找相对面：展开图中隔一个面、同行/同列错位的面通常不能相邻。",
        "第二步锁相邻面：用公共边、公共点和箭头/阴影方向判断折叠后的朝向。",
        "第三步排除不可能项：凡是把相对面放成相邻面，或公共边两侧方向错了，直接排除。",
      ],
      trap: "空间重构题最怕只看图案像不像；笔航捏球法看的是相对、相邻和方向关系。",
    };
  }

  if (/黑白|阴影|元素|样式|叠加|去同存异|去异存同/.test(text) || optionImages) {
    return {
      kind: "graphic",
      graphicType: "style",
      title: "图形推理：样式叠加法",
      route: [
        "先看每幅图的元素是否发生黑白、阴影、线条或图案样式变化。",
        "再比较相邻图或横纵行之间是否存在叠加、求同、求异、黑白运算。",
        "最后把同一套运算规则套到待选图，选能完整延续规则的一项。",
      ],
      trap: "样式题不要只数数量；如果形状位置变化不大，优先检查黑白和叠加规则。",
    };
  }

  if (/一笔画|奇点|端点|连通|路径/.test(text)) {
    return {
      kind: "graphic",
      graphicType: "stroke",
      title: "图形推理：一笔画奇点法",
      route: [
        "先判断图形是否连通，只有连通图才稳定讨论一笔画。",
        "再数奇点数量：0个或2个奇点通常可以一笔画，超过2个一般不能。",
        "若题组呈规律变化，就看奇点数、端点数或连通区域是否按序递增递减。",
      ],
      trap: "一笔画题不要按视觉复杂度判断，奇点数量才是硬标准。",
    };
  }

  return {
    kind: "graphic",
    graphicType: "plane",
    title: "图形推理：点线角面素排查法",
    route: [
      "先整体看图组，是数量、位置、样式还是属性规律。",
      "数量类按点、线、角、面、素依次排查；位置类看平移、旋转、翻转。",
      "九宫格优先横看、竖看、S形看；分组题优先找共同属性和相反属性。",
      "若选项都是图，先排除明显不符合主规律的，再比较局部细节。",
    ],
    trap: "平面图推不要死盯一个元素，规律必须能解释整组图。",
  };
}

function pickMethod(question) {
  if (isGraphicQuestion(question)) return pickGraphicMethod(question);
  const haystack = `${question.subModule || ""} ${question.module || ""} ${question.question || ""}`;
  const sub = SUBMODULE_METHODS.find((item) => item.keys.some((key) => haystack.includes(key)));
  if (sub) return sub;
  return BIHANG_METHODS[question.moduleKey] || BIHANG_METHODS.changshi;
}

function buildGraphicAnalysis(question, method, correctSummary) {
  const qText = compactText(question.question, 220);
  const answer = normalizeAnswer(question.answer);

  if (method.graphicType === "space") {
    return [
      "【逐步解析】",
      `1. 这题按笔航图推先判为空间重构题。题干核心是“${qText}”，正确做法不是凭眼睛硬想，而是用“捏球法”把展开图折成立体。`,
      "2. 先找相对面：展开图中处在相对关系的两个面，折成立方体后不能同时出现在相邻位置。选项只要把相对面画成相邻面，直接排除。",
      "3. 再找相邻面：保留能相邻的三个面，重点看公共边和公共点。若题面有箭头、阴影、字母或特殊符号，要沿公共边判断方向是否翻转。",
      `4. 最后对照选项，只有 ${correctSummary} 能同时满足相对面不相邻、相邻面位置正确、公共边方向一致，所以答案选 ${answer}。`,
      "5. 复盘时可以在草稿纸上标记“相对面一组、相邻面一圈、公共边方向”，比单纯脑补更稳。",
    ];
  }

  if (method.graphicType === "style") {
    return [
      "【逐步解析】",
      `1. 这题按笔航图推先看样式。题干核心是“${qText}”，图形之间如果外轮廓差别不大，就优先检查黑白、阴影、线条和图案叠加。`,
      "2. 观察每行或每列的对应位置，看是否存在去同存异、去异存同、黑白相加、黑白相减或样式轮换。",
      `3. 把同一规则套到空缺处，能保持整组样式运算一致的是 ${correctSummary}，因此答案选 ${answer}。`,
      "4. 若两个选项都像，要回到同一位置逐格比，不要只看整体视觉相似。",
    ];
  }

  if (method.graphicType === "stroke") {
    return [
      "【逐步解析】",
      `1. 这题按笔航图推看一笔画。题干核心是“${qText}”，先判断图形是否连通，再数奇点。`,
      "2. 一笔画的关键不是线多不多，而是奇点数：0个或2个奇点可以一笔画，超过2个通常不能一笔画。",
      `3. 按奇点数或连通性延续题组规律，符合要求的是 ${correctSummary}，所以答案选 ${answer}。`,
      "4. 复盘时把每个交点的线头数标出来，奇数线头就是奇点，速度会明显提升。",
    ];
  }

  return [
    "【逐步解析】",
    `1. 这题按笔航图推先走“点线角面素”排查。题干核心是“${qText}”。`,
    "2. 先看整体属性：对称、封闭开放、曲直、内外、连接方式；再看数量：点、线、角、面、元素个数；最后看位置：平移、旋转、翻转。",
    "3. 九宫格题按横向、纵向、S形三种读法试规则；分组题找两组内部共同点和组间差异。",
    `4. 把最稳定的规律套到选项，符合整组规律的是 ${correctSummary}，因此答案选 ${answer}。`,
    "5. 复盘时不要只记答案，要记“先属性、再数量、后位置”的排查顺序。",
  ];
}

function buildModuleAnalysis(question, method, correctSummary) {
  const moduleKey = question.moduleKey || "";
  const qText = compactText(question.question, 220);
  const material = compactText(question.dataMaterial || "", 160);
  const answer = normalizeAnswer(question.answer);

  if (moduleKey === "ziliao") {
    return [
      "【逐步解析】",
      `1. 先按笔航资料分析流程读题：时间、主体、单位、指标四件事先定住。本题题干核心是“${qText}”。${material ? `材料信息可先压缩为：${material}` : ""}`,
      "2. 再判断公式类型。若题干问增长、比重、倍数、平均数或综合判断，就先把对应公式写在草稿纸上，再看选项差距决定截位还是精算。",
      `3. 对照题库校验答案，本题正确答案为 ${correctSummary}。做题时应把选项 ${answer} 对应的判断放回材料，检查时间口径、单位口径和部分/整体关系是否一致。`,
      "4. 这类题不追求把每个数字都算到最后一位，笔航思路是先用估算排除明显错误，再在最接近的两个选项里精算。",
    ];
  }

  if (moduleKey === "shuliang") {
    return [
      "【逐步解析】",
      `1. 先识别题型。本题题干核心是“${qText}”，不要急着硬算，先看它更像工程、行程、利润、容斥、排列组合还是数列。`,
      "2. 笔航数量关系的优先级是：能代入就代入，能设特值就设特值，等量关系清楚再列方程；选项差距明显时优先估算。",
      `3. 对照正确答案，本题应选 ${correctSummary}。复盘时要把 ${answer} 代回题干条件，检查是否同时满足数量关系、范围限制和问法要求。`,
      "4. 如果计算量偏大，应先利用整除、奇偶、尾数、范围和选项差距缩小范围，再做最后一步计算。",
    ];
  }

  if (moduleKey === "yanyu") {
    return [
      "【逐步解析】",
      `1. 先看设问和文段主线。本题题干核心是“${qText}”。笔航言语题第一步不是看哪个选项顺眼，而是找文段中心和语境呼应点。`,
      "2. 如果是逻辑填空，重点看搭配对象、感情色彩、语义轻重和前后照应；如果是片段阅读，重点看转折后、总结句、首尾句和高频主题词。",
      `3. 本题正确答案为 ${correctSummary}。该项与题干主线或空缺处语境最贴合，能够承接文段表达重点；其他选项常见问题是语义偏离、范围过大/过小、无中生有或搭配不当。`,
      "4. 复盘时建议把正确项放回原文读一遍，看语气、对象、逻辑关系是否顺畅，这是言语题稳定提速的关键。",
    ];
  }

  if (moduleKey === "panduan") {
    if (method.kind === "graphic") return buildGraphicAnalysis(question, method, correctSummary);
    return [
      "【逐步解析】",
      `1. 先判题型。本题题干核心是“${qText}”。笔航判断推理要求先拆结构，再看选项，不要凭直觉选。`,
      "2. 若是论证题，先找论点和论据，再判断选项是在加强、削弱、搭桥、拆桥还是指出他因；若是定义题，圈主体、对象、方式、目的、结果；若是类比题，用一句话造句比较关系。",
      `3. 本题正确答案为 ${correctSummary}。它与题干要求的逻辑关系最一致，能够直接命中设问；其余选项通常是关系不一致、作用对象错位、只说背景不碰核心或不满足定义要件。`,
      "4. 复盘时要把“题干问什么”写在最前面，选项只要没有直接回答设问，即使看起来合理也不能选。",
    ];
  }

  if (moduleKey === "ggjc") {
    return [
      "【逐步解析】",
      `1. 先定位知识板块。本题题干核心是“${qText}”，属于公基中需要按框架记忆和概念辨析处理的题。`,
      "2. 笔航公基做法是先看主体、制度、程序、适用范围和关键词，再排除主体错位、概念混搭、绝对化表述。",
      `3. 本题正确答案为 ${correctSummary}。该项与题干所考概念或制度规则相匹配；其他选项容易在主体、范围、条件或表述层级上出错。`,
      "4. 复盘时建议把本题归入对应知识框架，而不是孤立背答案，这样遇到同类变形题也能识别。",
    ];
  }

  return [
    "【逐步解析】",
    `1. 先判断考点。本题题干核心是“${qText}”，属于常识判断，重点看政策表述、主体层级、事实常识和选项稳健程度。`,
    "2. 按笔航“巨星月”思路，政治理论和时政题优先看高位表达：党的领导、人民立场、国家战略、中国特色社会主义和中国式现代化等关键词。",
    `3. 本题正确答案为 ${correctSummary}。该项与题干要求一致，表述更稳、主体更准、层级更贴合；其他选项常见问题是说法绝对、主体不准、范围扩大或时间节点错误。`,
    "4. 常识题复盘不要只记一个答案，要把正确项背后的关键词和错误项的错法一起记住。",
  ];
}

function buildExplanation(question) {
  const method = pickMethod(question);
  const correctSummary = getCorrectOptionSummary(question);
  const route = method.route.map((item, index) => `${index + 1}. ${item}`).join("\n");
  const analysisLines = buildModuleAnalysis(question, method, correctSummary);
  const source = question.sourceTitle ? `\n【来源】${question.sourceTitle}` : "";

  return [
    `【题型判断】${question.module || "公考题"}${question.subModule ? ` - ${question.subModule}` : ""}`,
    `【笔航方法】${method.title}`,
    route,
    analysisLines.join("\n"),
    `【答案】${correctSummary}`,
    `【易错提醒】${method.trap}`,
    "【方法总结】先判题型，再抓关键词和逻辑结构；先排明显错误，再比较最接近选项。真正要记住的不是单题答案，而是这道题对应的识别步骤和排错口径。",
    source,
  ].join("\n");
}

function backupFile(filePath) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = filePath.replace(/\.json$/i, `.before-bihang-explanations-${stamp}.json`);
  fs.copyFileSync(filePath, backupPath);
  return backupPath;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const raw = fs.readFileSync(args.dataPath, "utf8");
  const data = JSON.parse(raw);
  const questions = Array.isArray(data) ? data : data.questions || [];
  if (!Array.isArray(questions)) throw new Error("Question bank must be an array or { questions: [] }");

  const eligible = questions.filter((question) => {
    if (args.overwrite) return true;
    if (args.sourceOnly) return isSourcePlaceholder(question.explanation);
    return !hasUsefulExplanation(question.explanation);
  });
  const selected = eligible.slice(args.offset, Number.isFinite(args.limit) ? args.offset + args.limit : undefined);

  let updated = 0;
  for (const question of selected) {
    const next = buildExplanation(question);
    if (next && next !== question.explanation) {
      question.explanation = next;
      updated += 1;
    }
  }

  let backupPath = null;
  if (!args.dryRun && updated > 0) {
    backupPath = backupFile(args.dataPath);
    if (!Array.isArray(data)) {
      data.meta = {
        ...(data.meta || {}),
        bihang_explanations_generated_at: new Date().toISOString(),
        bihang_explanations_summary: {
          eligible: eligible.length,
          updated,
          overwrite: args.overwrite,
          sourceOnly: args.sourceOnly,
        },
      };
    }
    fs.writeFileSync(args.dataPath, JSON.stringify(data, null, 2), "utf8");
  }

  console.log(JSON.stringify({
    total: questions.length,
    eligible: eligible.length,
    selected: selected.length,
    updated,
    dryRun: args.dryRun,
    backupPath,
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
