"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  createHistoryKey,
  getAiConfigFingerprint,
  getImageConfigFingerprint,
  isCacheableAiResult,
  isCacheableImageResult,
  readHistory,
  withHistoryHit,
  writeHistory,
} from "@/lib/ai-history";
import { toDisplayList, toDisplayText } from "@/lib/ai-display";
import { MODULES, type ModuleKey, type Question } from "@/lib/types";
import { MOCK_QUESTIONS } from "@/lib/mock-data";
import { loadData, recordAnswer } from "@/lib/store";
import { preloadImages } from "@/lib/image-optimizer";
import { loadQuestionBank } from "@/lib/question-bank-client";
import { requestAi } from "@/lib/client-ai";
import { requestImage } from "@/lib/client-image";
import {
  answerToText,
  buildQuestionPromptText,
  getAnswerContent,
  getCorrectAnswerContent,
  getCorrectText,
  getDisplayExplanation,
  getOptionDisplayHtml,
  getOptionDisplayText,
  getQuestionImageSources,
  getQuestionMaterialHtml,
  getQuestionText,
  stripHtml,
  type AnswerValue,
} from "@/lib/question-utils";

type PracticeQuestion = Question & {
  num?: number;
  sourceTitle?: string;
};

type AiResult = Record<string, unknown>;

type ComicResult = {
  source?: string;
  imageUrl?: string;
  b64Json?: string;
  mimeType?: string;
  model?: string;
  error?: string;
  detail?: string;
  historyHit?: boolean;
};

type PracticeItem =
  | { type: "single"; key: string; question: PracticeQuestion }
  | { type: "group"; key: string; group: MaterialGroup };

type MaterialGroup = {
  key: string;
  title: string;
  sourceTitle: string;
  materialHtml: string;
  questions: PracticeQuestion[];
};

const MODULE_FILTERS = MODULES.filter((item) => item.key !== "smart");

function parseYear(title = "") {
  const match = title.match(/(20\d{2})/);
  return match ? Number(match[1]) : undefined;
}

function getExamType(title = "") {
  if (title.includes("广州")) return "guangzhou";
  if (title.includes("深圳")) return "shenzhen";
  if (title.includes("广东")) return "guangdong";
  if (title.includes("国家") || title.includes("国考")) return "guokao";
  return "other";
}

function getSharedMaterial(html = "") {
  if (!html.trim()) return "";
  const marker = '<div style="margin-top:8px;">';
  const markerIndex = html.indexOf(marker);
  return (markerIndex >= 0 ? html.slice(0, markerIndex) : html).trim();
}

function getMaterialLabel(html = "") {
  return html.match(/【阅读材料\s*([^】]+)】/)?.[1]?.trim() || "";
}

function getMaterialKey(question: PracticeQuestion) {
  const material = getSharedMaterial(question.dataMaterial || "");
  if (!material) return "";

  const label = getMaterialLabel(material);
  if (label) return `${question.sourceTitle || question.source}|${label}`;

  const compact = material.replace(/\s+/g, "");
  if (compact.length < 80) return "";
  return `${question.sourceTitle || question.source}|${compact.slice(0, 140)}`;
}

function getMaterialTitle(question: PracticeQuestion) {
  const label = getMaterialLabel(getSharedMaterial(question.dataMaterial || ""));
  return label ? `阅读材料 ${label}` : `${question.module}材料题组`;
}

function buildPracticeItems(questions: PracticeQuestion[]) {
  const groupMap = new Map<string, MaterialGroup>();

  questions.forEach((question) => {
    const key = getMaterialKey(question);
    if (!key) return;

    const materialHtml = getSharedMaterial(question.dataMaterial || "");
    const existing = groupMap.get(key);
    if (existing) {
      existing.questions.push(question);
      return;
    }

    groupMap.set(key, {
      key,
      title: getMaterialTitle(question),
      sourceTitle: question.sourceTitle || question.source || "题库",
      materialHtml,
      questions: [question],
    });
  });

  const emitted = new Set<string>();
  const items: PracticeItem[] = [];

  questions.forEach((question) => {
    const key = getMaterialKey(question);
    const group = key ? groupMap.get(key) : undefined;
    if (group && group.questions.length > 1) {
      if (!emitted.has(key)) {
        items.push({ type: "group", key, group });
        emitted.add(key);
      }
      return;
    }

    items.push({ type: "single", key: question.id, question });
  });

  return items;
}

function getPracticeItemQuestionIds(item?: PracticeItem) {
  if (!item) return [];
  return item.type === "group" ? item.group.questions.map((question) => question.id) : [item.question.id];
}

function isCorrectAnswer(question: PracticeQuestion, value?: AnswerValue) {
  if (value === undefined) return false;
  if (question.type === "multi_choice") {
    const expected = question.answer as string[];
    const selected = String(value).split("").sort();
    return expected.length === selected.length && expected.every((key) => selected.includes(key));
  }
  if (question.type === "true_false") {
    return value === question.answer;
  }
  return value === question.answer;
}

function mergeMultiAnswer(current: AnswerValue | undefined, key: string) {
  const set = new Set(String(current || "").split("").filter(Boolean));
  if (set.has(key)) set.delete(key);
  else set.add(key);
  return Array.from(set).sort().join("");
}

function buildComicContent(question: PracticeQuestion, answer?: AnswerValue, aiResult?: AiResult) {
  const questionPrompt = buildQuestionPromptText(question);
  const material = stripHtml(getQuestionMaterialHtml(question));
  const aiAnalysis = aiResult?.analysis ? String(aiResult.analysis) : "";
  const aiSuggestion = aiResult?.suggestion ? String(aiResult.suggestion) : "";
  const imageSources = getClientImageSources(question);
  const visualQuestion = isVisualQuestion(question);
  const explanation = getDisplayExplanation(question);

  return [
    `题目来源：${question.sourceTitle || question.source || "题库"}`,
    `模块：${question.module} / ${question.subModule}`,
    visualQuestion ? "【视觉题保护】本题疑似图形/选图题。漫画必须基于题图、选项图、原始解析或AI讲解中的明确图形特征生成；缺少这些信息时禁止编造规律和答案。" : "",
    visualQuestion && imageSources.length === 0 && !explanation && !aiAnalysis ? "【视觉题保护】题图缺失：当前没有可用题图、原始解析或AI图形特征讲解，不能生成可靠漫画讲解。" : "",
    imageSources.length ? `题图/选项图数量：${imageSources.length}。图片地址：${imageSources.join("；")}` : "",
    material ? `题干材料：${material}` : "",
    questionPrompt,
    `用户答案：${answerToText(answer) || "未作答"}`,
    `用户答案内容：${getAnswerContent(question, answer) || "未作答"}`,
    `正确答案：${getCorrectText(question)}`,
    `正确答案内容：${getCorrectAnswerContent(question)}`,
    `原始解析：${explanation}`,
    aiAnalysis ? `AI讲解：${aiAnalysis}` : "",
    aiSuggestion ? `复习建议：${aiSuggestion}` : "",
    question.knowledgePoints?.length ? `知识点：${question.knowledgePoints.join("、")}` : "",
  ].filter(Boolean).join("\n\n");
}

function getComicImageSrc(result?: ComicResult) {
  if (!result) return "";
  if (result.imageUrl) return result.imageUrl;
  if (result.b64Json?.startsWith("data:image/")) return result.b64Json;
  if (/^https?:\/\//i.test(result.b64Json || "")) return result.b64Json || "";
  if (result.b64Json) return `data:${result.mimeType || "image/png"};base64,${result.b64Json}`;
  return "";
}

function getClientImageSources(question: PracticeQuestion) {
  if (typeof window === "undefined") return getQuestionImageSources(question);
  return getQuestionImageSources(question).map((src) => {
    if (!src || src.startsWith("data:image/") || /^https?:\/\//i.test(src)) return src;
    try {
      return new URL(src, window.location.origin).toString();
    } catch {
      return src;
    }
  });
}

function isVisualQuestion(question: PracticeQuestion) {
  return /图形|图推|问号处|题图|选项图|下列图|左边给定|右边.*选项|呈现.*规律|见题图|见选项图/i.test(
    [
      question.module,
      question.subModule,
      getQuestionText(question),
      question.options?.map((option) => getOptionDisplayText(option) || "见题图或选项图").join(" "),
    ].filter(Boolean).join(" "),
  );
}

function hasUsefulAiResult(result?: AiResult | null) {
  if (!result) return false;
  return Boolean(
    toDisplayText(result.analysis || result.answerSummary || result.suggestion || result.method || result.error || result.apiError || result.detail) ||
      toDisplayList(result.keyPoints).length,
  );
}

function withAiCacheVersion(body: Record<string, unknown>) {
  return { ...body, requestVersion: "ai-card-v3-detailed" };
}

export default function QuestionBankPage() {
  const [questions, setQuestions] = useState<PracticeQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [moduleFilter, setModuleFilter] = useState<ModuleKey | "all">("all");
  const [examFilter, setExamFilter] = useState<"all" | "guokao" | "guangdong" | "shenzhen" | "guangzhou">("all");
  const [yearFilter, setYearFilter] = useState("all");
  const [paperFilter, setPaperFilter] = useState("all");
  const [keyword, setKeyword] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [answeredIds, setAnsweredIds] = useState<string[]>([]);
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
  const [submitted, setSubmitted] = useState<Record<string, boolean>>({});
  const [aiResults, setAiResults] = useState<Record<string, AiResult>>({});
  const [aiLoading, setAiLoading] = useState<Record<string, boolean>>({});
  const [comicResults, setComicResults] = useState<Record<string, ComicResult>>({});
  const [comicLoading, setComicLoading] = useState<Record<string, boolean>>({});
  const [directoryCollapsed, setDirectoryCollapsed] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function loadBank() {
      setLoading(true);
      setLoadError("");
      try {
        const data = await loadQuestionBank<PracticeQuestion>(10000);
        const nextQuestions = data.questions && data.questions.length > 0
          ? data.questions
          : (MOCK_QUESTIONS as PracticeQuestion[]);
        if (!mounted) return;
        setQuestions(nextQuestions);
        setAnsweredIds(loadData().answeredIds || []);
        if (data.error) setLoadError(data.error);
      } catch {
        if (!mounted) return;
        setQuestions(MOCK_QUESTIONS as PracticeQuestion[]);
        setAnsweredIds(loadData().answeredIds || []);
        setLoadError("真题库读取失败，当前显示本地示例题。");
      } finally {
        if (mounted) setLoading(false);
      }
    }

    loadBank();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    setDirectoryCollapsed(localStorage.getItem("gongkao-directory-collapsed") === "1");
  }, []);

  const papers = useMemo(() => {
    return Array.from(new Set(questions.map((q) => q.sourceTitle).filter(Boolean) as string[]));
  }, [questions]);

  const years = useMemo(() => {
    return Array.from(new Set(questions.map((q) => parseYear(q.sourceTitle)).filter(Boolean) as number[]))
      .sort((a, b) => b - a);
  }, [questions]);

  const filteredQuestions = useMemo(() => {
    const key = keyword.trim().toLowerCase();
    const answeredSet = new Set(answeredIds);
    return questions.filter((question) => {
      if (answeredSet.has(question.id)) return false;
      if (moduleFilter !== "all" && question.moduleKey !== moduleFilter) return false;
      if (examFilter !== "all" && getExamType(question.sourceTitle) !== examFilter) return false;
      if (yearFilter !== "all" && parseYear(question.sourceTitle) !== Number(yearFilter)) return false;
      if (paperFilter !== "all" && question.sourceTitle !== paperFilter) return false;
      if (!key) return true;

      const text = [
        getQuestionText(question),
        question.module,
        question.subModule,
        question.sourceTitle,
        question.knowledgePoints?.join(" "),
      ].join(" ").toLowerCase();
      return text.includes(key);
    });
  }, [questions, answeredIds, moduleFilter, examFilter, yearFilter, paperFilter, keyword]);

  const practiceItems = useMemo(() => buildPracticeItems(filteredQuestions), [filteredQuestions]);
  const selectedItem = practiceItems[selectedIndex] || practiceItems[0];
  const materialGroupCount = practiceItems.filter((item) => item.type === "group").length;

  useEffect(() => {
    setSelectedIndex(0);
  }, [moduleFilter, examFilter, yearFilter, paperFilter, keyword]);

  useEffect(() => {
    if (practiceItems.length === 0) {
      setSelectedIndex(0);
      return;
    }
    setSelectedIndex((value) => Math.min(value, practiceItems.length - 1));
  }, [practiceItems.length]);

  // 预加载当前题目的图片
  useEffect(() => {
    if (!selectedItem) return;

    const imageSources: string[] = [];
    if (selectedItem.type === "single") {
      imageSources.push(...getQuestionImageSources(selectedItem.question));
    } else {
      selectedItem.group.questions.forEach((q) => {
        imageSources.push(...getQuestionImageSources(q));
      });
    }

    if (imageSources.length > 0) {
      preloadImages(imageSources).catch(() => {
        // 预加载失败静默处理，不影响用户体验
      });
    }
  }, [selectedItem]);

  const selectAnswer = (question: PracticeQuestion, value: AnswerValue) => {
    if (submitted[question.id]) return;
    setAnswers((prev) => ({ ...prev, [question.id]: value }));
  };

  const submitAnswer = (question: PracticeQuestion) => {
    const value = answers[question.id];
    if (value === undefined || value === "") return;
    const correct = isCorrectAnswer(question, value);

    setSubmitted((prev) => ({ ...prev, [question.id]: true }));
    recordAnswer(question, value, correct);

    if (!correct) {
      requestAiAnalysis(question, value);
    }
  };

  const resetAnswer = (question: PracticeQuestion) => {
    setAnswers((prev) => {
      const next = { ...prev };
      delete next[question.id];
      return next;
    });
    setSubmitted((prev) => {
      const next = { ...prev };
      delete next[question.id];
      return next;
    });
    setAiResults((prev) => {
      const next = { ...prev };
      delete next[question.id];
      return next;
    });
    setComicResults((prev) => {
      const next = { ...prev };
      delete next[question.id];
      return next;
    });
  };

  const requestAiAnalysis = async (question: PracticeQuestion, value: AnswerValue) => {
    const body = {
      mode: "analyze",
      question: buildQuestionPromptText(question),
      userAnswer: getAnswerContent(question, value) || answerToText(value),
      correctAnswer: getCorrectAnswerContent(question) || getCorrectText(question),
      explanation: getDisplayExplanation(question),
      module: question.subModule,
      knowledgePoints: question.knowledgePoints,
      context: stripHtml(getQuestionMaterialHtml(question)),
      images: getClientImageSources(question),
    };
    const historyKey = createHistoryKey("ai", {
      scope: "quiz_analysis",
      questionId: question.id,
      config: getAiConfigFingerprint(),
      body: withAiCacheVersion(body),
    });
    const cached = await readHistory<AiResult>(historyKey);
    if (hasUsefulAiResult(cached)) {
      setAiResults((prev) => ({ ...prev, [question.id]: withHistoryHit(cached as AiResult) }));
      return;
    }

    setAiLoading((prev) => ({ ...prev, [question.id]: true }));
    try {
      const data = await requestAi(body);
      setAiResults((prev) => ({ ...prev, [question.id]: data }));
      if (isCacheableAiResult(data)) {
        await writeHistory("ai", historyKey, data, `${question.subModule}错因讲解`);
      }
    } catch (err) {
      setAiResults((prev) => ({
        ...prev,
        [question.id]: {
          source: "local_fallback",
          errorType: "网络错误",
          analysis: `AI 接口调用失败：${String(err)}`,
          suggestion: "请检查网络连接和 AI 配置。",
        },
      }));
    } finally {
      setAiLoading((prev) => ({ ...prev, [question.id]: false }));
    }
  };

  const requestComicImage = async (question: PracticeQuestion) => {
    const answer = answers[question.id];

    const content = buildComicContent(question, answer, aiResults[question.id]);
    const body = {
      content,
      size: localStorage.getItem("gongkao-image-size") || "1024x1024",
    };
    const historyKey = createHistoryKey("image", {
      scope: "quiz_comic",
      questionId: question.id,
      config: getImageConfigFingerprint(),
      body,
    });

    setComicLoading((prev) => ({ ...prev, [question.id]: true }));
    setComicResults((prev) => {
      const next = { ...prev };
      delete next[question.id];
      return next;
    });

    try {
      const cached = await readHistory<ComicResult>(historyKey);
      if (cached) {
        setComicResults((prev) => ({ ...prev, [question.id]: withHistoryHit(cached) }));
        return;
      }

      const data = await requestImage<ComicResult>(body);
      setComicResults((prev) => ({ ...prev, [question.id]: data }));
      if (isCacheableImageResult(data)) {
        await writeHistory("image", historyKey, data, `${question.subModule}漫画讲解`);
      }
    } catch (err) {
      setComicResults((prev) => ({
        ...prev,
        [question.id]: {
          error: "生图请求失败",
          detail: err instanceof Error ? err.message : String(err),
        },
      }));
    } finally {
      setComicLoading((prev) => ({ ...prev, [question.id]: false }));
    }
  };

  const goNext = () => {
    const latestAnsweredIds = loadData().answeredIds || [];
    const currentIds = getPracticeItemQuestionIds(selectedItem);
    const currentItemWillHide = currentIds.some((id) => latestAnsweredIds.includes(id));
    setAnsweredIds(latestAnsweredIds);
    setSelectedIndex((index) => Math.min(index + (currentItemWillHide ? 0 : 1), Math.max(practiceItems.length - 1, 0)));
  };

  const toggleDirectory = () => {
    setDirectoryCollapsed((value) => {
      const next = !value;
      localStorage.setItem("gongkao-directory-collapsed", next ? "1" : "0");
      return next;
    });
  };

  return (
    <div className="animate-in study-page quiz-page">
      <div className="topbar sticky top-0 z-40 flex items-center px-8 h-14">
        <span className="text-sm font-bold" style={{ color: "var(--ink)" }}>真题题库</span>
        <span className="text-xs ml-2" style={{ color: "var(--steel)" }}>国考/广东/深圳/广州 · 材料题组 · AI错因讲解</span>
        <button
          onClick={toggleDirectory}
          className="ghost-button ml-auto px-3 py-1.5 text-xs font-medium rounded-lg"
        >
          {directoryCollapsed ? "展开目录" : "收起目录"}
        </button>
      </div>

      <div className="p-6 max-w-[1500px]">
        <section className="bank-toolbar p-4 mb-4" style={{ background: "rgba(253,255,251,0.92)", border: "1px solid var(--hairline)" }}>
          <div className="grid grid-cols-4 gap-3 mb-4">
            <StatCard label="题库题量" value={loading ? "..." : questions.length} />
            <StatCard label="未做筛选" value={filteredQuestions.length} />
            <StatCard label="材料题组" value={materialGroupCount} />
            <StatCard label="试卷套数" value={papers.length || "-"} />
          </div>

          <div className="grid grid-cols-[1fr_160px_160px_220px] gap-3">
            <input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="搜索题干、知识点、试卷名称"
              className="quiet-input px-3 py-2 text-sm rounded-xl"
            />
            <select
              value={examFilter}
              onChange={(event) => setExamFilter(event.target.value as "all" | "guokao" | "guangdong" | "shenzhen" | "guangzhou")}
              className="quiet-input px-3 py-2 text-sm rounded-xl"
            >
              <option value="all">全部考试</option>
              <option value="guokao">国考</option>
              <option value="guangdong">广东省考</option>
              <option value="shenzhen">深圳市考</option>
              <option value="guangzhou">广州市考</option>
            </select>
            <select
              value={yearFilter}
              onChange={(event) => setYearFilter(event.target.value)}
              className="quiet-input px-3 py-2 text-sm rounded-xl"
            >
              <option value="all">全部年份</option>
              {years.map((year) => (
                <option key={year} value={year}>{year} 年</option>
              ))}
            </select>
            <select
              value={paperFilter}
              onChange={(event) => setPaperFilter(event.target.value)}
              className="quiet-input px-3 py-2 text-sm rounded-xl"
            >
              <option value="all">全部试卷</option>
              {papers.map((paper) => (
                <option key={paper} value={paper}>{paper}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap gap-2 mt-3">
            <FilterButton active={moduleFilter === "all"} onClick={() => setModuleFilter("all")}>全部模块</FilterButton>
            {MODULE_FILTERS.map((module) => (
              <FilterButton key={module.key} active={moduleFilter === module.key} onClick={() => setModuleFilter(module.key)}>
                {module.icon} {module.name}
              </FilterButton>
            ))}
          </div>

          {loadError && (
            <div className="mt-3 text-xs rounded-md px-3 py-2" style={{ background: "var(--tint-peach)", color: "var(--brand-orange)" }}>
              {loadError}
            </div>
          )}
        </section>

        <div className={directoryCollapsed ? "grid grid-cols-1 gap-4" : "grid grid-cols-[320px_1fr] gap-4"}>
          {!directoryCollapsed && <aside className="bank-sidebar rounded-[18px] overflow-hidden" style={{ background: "rgba(253,255,251,0.92)", border: "1px solid var(--hairline)" }}>
            <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--hairline)" }}>
              <div className="flex items-center gap-2">
                <div>
                  <div className="text-sm font-semibold" style={{ color: "var(--ink)" }}>题库目录</div>
                  <div className="text-xs mt-0.5" style={{ color: "var(--steel)" }}>{practiceItems.length} 个练习项，材料题按题组折叠</div>
                </div>
                <button
                  onClick={toggleDirectory}
                  className="ghost-button ml-auto px-2 py-1 text-xs rounded-lg"
                >
                  收起
                </button>
              </div>
            </div>
            <div className="max-h-[calc(100vh-280px)] overflow-y-auto p-2">
              {practiceItems.length === 0 && (
                <div className="px-3 py-10 text-center text-sm" style={{ color: "var(--steel)" }}>
                  没有匹配的题目
                </div>
              )}
              {practiceItems.map((item, index) => (
                <button
                  key={item.key}
                  onClick={() => setSelectedIndex(index)}
                  className="w-full text-left rounded-md px-3 py-3 mb-1 transition-colors"
                  style={{
                    background: selectedIndex === index ? "var(--surface)" : "transparent",
                    border: selectedIndex === index ? "1px solid var(--hairline)" : "1px solid transparent",
                  }}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="px-1.5 py-0.5 rounded text-[11px] font-semibold" style={{ background: item.type === "group" ? "var(--tint-sky)" : "var(--tint-lavender)", color: item.type === "group" ? "var(--link-blue)" : "var(--brand-navy)" }}>
                      {item.type === "group" ? `${item.group.questions.length}题组` : "单题"}
                    </span>
                    <span className="text-[11px]" style={{ color: "var(--steel)" }}>
                      {item.type === "group" ? item.group.questions[0]?.module : item.question.module}
                    </span>
                  </div>
                  <div className="text-sm line-clamp-2" style={{ color: "var(--charcoal)" }}>
                    {item.type === "group" ? item.group.title : getQuestionText(item.question)}
                  </div>
                  <div className="text-[11px] mt-1 truncate" style={{ color: "var(--stone)" }}>
                    {item.type === "group" ? item.group.sourceTitle : item.question.sourceTitle || item.question.source}
                  </div>
                </button>
              ))}
            </div>
          </aside>}

          <main className="min-w-0">
            {loading && (
              <div className="rounded-lg p-10 text-center" style={{ background: "var(--canvas)", border: "1px solid var(--hairline)", color: "var(--steel)" }}>
                题库加载中...
              </div>
            )}

            {!loading && selectedItem?.type === "group" && (
              <MaterialGroupPractice
                group={selectedItem.group}
                answers={answers}
                submitted={submitted}
                aiResults={aiResults}
                aiLoading={aiLoading}
                comicResults={comicResults}
                comicLoading={comicLoading}
                onSelectAnswer={selectAnswer}
                onSubmit={submitAnswer}
                onReset={resetAnswer}
                onToggleMulti={(question, key) => selectAnswer(question, mergeMultiAnswer(answers[question.id], key))}
                onGenerateComic={requestComicImage}
                onNext={goNext}
              />
            )}

            {!loading && selectedItem?.type === "single" && (
              <SingleQuestionPractice
                question={selectedItem.question}
                answer={answers[selectedItem.question.id]}
                submitted={!!submitted[selectedItem.question.id]}
                aiResult={aiResults[selectedItem.question.id]}
                aiLoading={!!aiLoading[selectedItem.question.id]}
                comicResult={comicResults[selectedItem.question.id]}
                comicLoading={!!comicLoading[selectedItem.question.id]}
                onSelectAnswer={(value) => selectAnswer(selectedItem.question, value)}
                onToggleMulti={(key) => selectAnswer(selectedItem.question, mergeMultiAnswer(answers[selectedItem.question.id], key))}
                onSubmit={() => submitAnswer(selectedItem.question)}
                onReset={() => resetAnswer(selectedItem.question)}
                onGenerateComic={() => requestComicImage(selectedItem.question)}
                onNext={goNext}
              />
            )}
          </main>
        </div>
      </div>
    </div>
  );
}

function MaterialGroupPractice({
  group,
  answers,
  submitted,
  aiResults,
  aiLoading,
  comicResults,
  comicLoading,
  onSelectAnswer,
  onToggleMulti,
  onSubmit,
  onReset,
  onGenerateComic,
  onNext,
}: {
  group: MaterialGroup;
  answers: Record<string, AnswerValue>;
  submitted: Record<string, boolean>;
  aiResults: Record<string, AiResult>;
  aiLoading: Record<string, boolean>;
  comicResults: Record<string, ComicResult>;
  comicLoading: Record<string, boolean>;
  onSelectAnswer: (question: PracticeQuestion, value: AnswerValue) => void;
  onToggleMulti: (question: PracticeQuestion, key: string) => void;
  onSubmit: (question: PracticeQuestion) => void;
  onReset: (question: PracticeQuestion) => void;
  onGenerateComic: (question: PracticeQuestion) => void;
  onNext: () => void;
}) {
  const answeredCount = group.questions.filter((question) => submitted[question.id]).length;

  return (
    <div className="question-panel overflow-hidden" style={{ background: "var(--canvas)", border: "1px solid var(--hairline)" }}>
      <div className="px-5 py-3 flex items-center gap-3" style={{ borderBottom: "1px solid var(--hairline)" }}>
        <div>
          <div className="text-sm font-semibold" style={{ color: "var(--ink)" }}>{group.title}</div>
          <div className="text-xs mt-0.5" style={{ color: "var(--steel)" }}>{group.sourceTitle}</div>
        </div>
        <div className="ml-auto text-xs font-semibold px-2.5 py-1 rounded-full" style={{ background: "var(--tint-mint)", color: "var(--brand-green)" }}>
          {answeredCount}/{group.questions.length} 已提交
        </div>
      </div>

      <div className="grid grid-cols-[minmax(360px,0.95fr)_minmax(420px,1.05fr)]" style={{ background: "var(--surface)" }}>
        <section className="m-3 rounded-2xl overflow-hidden" style={{ background: "var(--canvas)", border: "1px solid var(--hairline-soft)" }}>
          <div className="px-5 py-3" style={{ borderBottom: "1px solid var(--hairline)" }}>
            <span className="text-xs font-semibold px-3 py-1 rounded" style={{ color: "var(--primary)", background: "rgba(63,143,120,0.1)" }}>材料</span>
          </div>
          <div
            className="question-material h-[calc(100vh-270px)] overflow-y-auto p-6"
            dangerouslySetInnerHTML={{ __html: group.materialHtml }}
          />
        </section>

        <section className="m-3 ml-0 rounded-2xl overflow-hidden" style={{ background: "var(--canvas)", border: "1px solid var(--hairline-soft)" }}>
          <div className="px-5 py-4 flex items-center gap-5" style={{ borderBottom: "1px solid var(--hairline)" }}>
            {group.questions.map((question, index) => (
              <button
                key={question.id}
                onClick={() => document.getElementById(`q-${question.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" })}
                className="text-sm font-semibold pb-1"
                style={{
                  color: submitted[question.id] ? "var(--primary)" : "var(--steel)",
                  borderBottom: submitted[question.id] ? "3px solid var(--primary)" : "3px solid transparent",
                }}
              >
                {index + 1}题
              </button>
            ))}
          </div>
          <div className="h-[calc(100vh-270px)] overflow-y-auto p-5">
            {group.questions.map((question, index) => (
              <QuestionBlock
                key={question.id}
                question={question}
                indexLabel={`${index + 1}.`}
                answer={answers[question.id]}
                submitted={!!submitted[question.id]}
                aiResult={aiResults[question.id]}
                aiLoading={!!aiLoading[question.id]}
                comicResult={comicResults[question.id]}
                comicLoading={!!comicLoading[question.id]}
                showMaterial={false}
                onSelectAnswer={(value) => onSelectAnswer(question, value)}
                onToggleMulti={(key) => onToggleMulti(question, key)}
                onSubmit={() => onSubmit(question)}
                onReset={() => onReset(question)}
                onGenerateComic={() => onGenerateComic(question)}
              />
            ))}
            <button
              onClick={onNext}
              className="primary-button mt-2 px-4 py-2 text-sm font-medium rounded-lg"
            >
              下一组
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

function SingleQuestionPractice({
  question,
  answer,
  submitted,
  aiResult,
  aiLoading,
  comicResult,
  comicLoading,
  onSelectAnswer,
  onToggleMulti,
  onSubmit,
  onReset,
  onGenerateComic,
  onNext,
}: {
  question: PracticeQuestion;
  answer?: AnswerValue;
  submitted: boolean;
  aiResult?: AiResult;
  aiLoading: boolean;
  comicResult?: ComicResult;
  comicLoading: boolean;
  onSelectAnswer: (value: AnswerValue) => void;
  onToggleMulti: (key: string) => void;
  onSubmit: () => void;
  onReset: () => void;
  onGenerateComic: () => void;
  onNext: () => void;
}) {
  return (
    <div className="question-panel p-6" style={{ background: "var(--canvas)", border: "1px solid var(--hairline)" }}>
      <QuestionBlock
        question={question}
        answer={answer}
        submitted={submitted}
        aiResult={aiResult}
        aiLoading={aiLoading}
        comicResult={comicResult}
        comicLoading={comicLoading}
        showMaterial
        onSelectAnswer={onSelectAnswer}
        onToggleMulti={onToggleMulti}
        onSubmit={onSubmit}
        onReset={onReset}
        onGenerateComic={onGenerateComic}
      />
      <button
        onClick={onNext}
        className="primary-button mt-2 px-4 py-2 text-sm font-medium rounded-lg"
      >
        下一题
      </button>
    </div>
  );
}

function QuestionBlock({
  question,
  answer,
  submitted,
  aiResult,
  aiLoading,
  comicResult,
  comicLoading,
  indexLabel,
  showMaterial,
  onSelectAnswer,
  onToggleMulti,
  onSubmit,
  onReset,
  onGenerateComic,
}: {
  question: PracticeQuestion;
  answer?: AnswerValue;
  submitted: boolean;
  aiResult?: AiResult;
  aiLoading: boolean;
  comicResult?: ComicResult;
  comicLoading: boolean;
  indexLabel?: string;
  showMaterial: boolean;
  onSelectAnswer: (value: AnswerValue) => void;
  onToggleMulti: (key: string) => void;
  onSubmit: () => void;
  onReset: () => void;
  onGenerateComic: () => void;
}) {
  const correct = submitted && isCorrectAnswer(question, answer);
  const comicImageSrc = getComicImageSrc(comicResult);
  const aiSource = toDisplayText(aiResult?.source);
  const aiErrorType = toDisplayText(aiResult?.errorType);
  const aiAnalysis = toDisplayText(aiResult?.analysis || aiResult?.answerSummary);
  const aiSuggestion = toDisplayText(aiResult?.suggestion);
  const aiMethod = toDisplayText(aiResult?.method);
  const aiMnemonic = toDisplayText(aiResult?.mnemonic);
  const aiExample = toDisplayText(aiResult?.example);
  const aiError = toDisplayText(aiResult?.error || aiResult?.apiError || aiResult?.detail);
  const aiKeyPoints = toDisplayList(aiResult?.keyPoints);
  const isAiSource = Boolean(aiSource && aiSource !== "local" && aiSource !== "local_fallback");
  const materialHtml = getQuestionMaterialHtml(question);
  const questionText = getQuestionText(question);
  const userAnswerText = answerToText(answer);
  const userAnswerContent = getAnswerContent(question, answer);
  const correctAnswerText = getCorrectText(question);
  const correctAnswerContent = getCorrectAnswerContent(question);
  const explanation = getDisplayExplanation(question);

  return (
    <article id={`q-${question.id}`} className="pb-6 mb-6" style={{ borderBottom: "1px solid var(--hairline-soft)" }}>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {indexLabel && <span className="text-base font-semibold mr-1" style={{ color: "var(--ink)" }}>{indexLabel}</span>}
        <Tag label={question.type === "multi_choice" ? "多选题" : question.type === "true_false" ? "判断题" : "单选题"} bg="var(--tint-sky)" color="var(--link-blue)" />
        <Tag label={question.module} bg="var(--tint-lavender)" color="var(--brand-navy)" />
        <Tag label={question.subModule} bg="var(--tint-peach)" color="var(--brand-orange)" />
      </div>

      {showMaterial && materialHtml && (
        <div
          className="question-material rounded-lg p-4 mb-4 overflow-x-auto"
          style={{ background: "var(--surface)", border: "1px solid var(--hairline)" }}
          dangerouslySetInnerHTML={{ __html: materialHtml }}
        />
      )}

      <div className="text-base leading-relaxed mb-5 whitespace-pre-line" style={{ color: "var(--ink)" }}>{questionText}</div>

      <AnswerOptions
        question={question}
        answer={answer}
        submitted={submitted}
        onSelectAnswer={onSelectAnswer}
        onToggleMulti={onToggleMulti}
      />

      <div className="flex flex-wrap items-center gap-3 mt-4">
        {!submitted ? (
          <button
            onClick={onSubmit}
            disabled={answer === undefined || answer === ""}
            className="px-4 py-2 text-sm font-medium rounded-md text-white disabled:opacity-50"
            style={{ background: "var(--primary)" }}
          >
            提交答案
          </button>
        ) : (
          <>
            <span className="text-sm font-semibold" style={{ color: correct ? "var(--brand-green)" : "var(--error)" }}>
              {correct ? "回答正确" : `答错了：你的答案 ${userAnswerText}，正确答案 ${correctAnswerText}`}
            </span>
          </>
        )}
      </div>

      {submitted && (
        <div className="mt-4 rounded-lg p-4" style={{ background: "var(--surface)" }}>
          <div className="grid gap-2 mb-4">
            <div className="rounded-md px-3 py-2 text-sm" style={{ background: "var(--canvas)", border: "1px solid var(--hairline)" }}>
              <span className="text-xs font-semibold mr-2" style={{ color: "var(--steel)" }}>你的答案</span>
              <span style={{ color: correct ? "var(--brand-green)" : "var(--error)" }}>{userAnswerText}</span>
              {userAnswerContent && userAnswerContent !== userAnswerText && <span className="ml-2" style={{ color: "var(--charcoal)" }}>{userAnswerContent}</span>}
            </div>
            <div className="rounded-md px-3 py-2 text-sm" style={{ background: "var(--canvas)", border: "1px solid var(--hairline)" }}>
              <span className="text-xs font-semibold mr-2" style={{ color: "var(--steel)" }}>正确答案</span>
              <span style={{ color: "var(--brand-green)" }}>{correctAnswerText}</span>
              {correctAnswerContent && correctAnswerContent !== correctAnswerText && <span className="ml-2" style={{ color: "var(--charcoal)" }}>{correctAnswerContent}</span>}
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5 mt-3">
            {question.knowledgePoints?.map((point) => (
              <span key={point} className="px-2 py-0.5 rounded text-xs font-semibold" style={{ background: "var(--tint-lavender)", color: "var(--brand-navy)" }}>{point}</span>
            ))}
          </div>
          <button
            onClick={onGenerateComic}
            disabled={comicLoading}
            className="ghost-button mt-4 px-3 py-1.5 text-xs font-medium rounded-lg disabled:opacity-50"
            style={{ color: "var(--primary)" }}
          >
            {comicLoading ? "漫画生成中..." : "生成漫画讲解"}
          </button>
        </div>
      )}

      {comicResult?.error && (
        <div className="mt-3 rounded-lg p-3 text-sm leading-relaxed" style={{ background: "var(--tint-peach)", color: "var(--brand-orange)" }}>
          {comicResult.error}{comicResult.detail ? `：${comicResult.detail}` : ""}
        </div>
      )}

      {comicImageSrc && (
        <div className="mt-3 rounded-lg p-3" style={{ background: "var(--surface)", border: "1px solid var(--hairline)" }}>
          {comicResult?.historyHit && <div className="text-xs font-semibold mb-2" style={{ color: "var(--primary)" }}>已调用历史图片</div>}
          <img src={comicImageSrc} alt="漫画讲解" className="w-full max-h-[720px] object-contain rounded-md" />
        </div>
      )}

      {aiLoading && (
        <div className="mt-3 rounded-lg p-3 text-sm" style={{ background: "var(--tint-sky)", color: "var(--link-blue)" }}>
          AI 正在分析错因...
        </div>
      )}

      {aiResult && !correct && (
        <div className="mt-3 rounded-lg p-4" style={{ background: "var(--tint-peach)" }}>
          <div className="text-xs font-semibold mb-2" style={{ color: "var(--brand-orange)" }}>
            {isAiSource ? "AI错因讲解" : "错因提示"}
            {Boolean(aiResult.historyHit) && <span className="ml-2 px-2 py-0.5 rounded-full" style={{ background: "var(--tint-mint)", color: "var(--primary)" }}>历史记录</span>}
          </div>
          {aiErrorType && <div className="text-xs font-semibold mb-2" style={{ color: "var(--brand-orange)" }}>错因：{aiErrorType}</div>}
          {aiAnalysis && <div className="text-sm leading-relaxed mb-3 whitespace-pre-wrap" style={{ color: "var(--charcoal)" }}>{aiAnalysis}</div>}
          {aiKeyPoints.length > 0 && (
            <div className="mb-3">
              <div className="text-xs font-semibold mb-1.5" style={{ color: "var(--brand-orange)" }}>要点归纳</div>
              <ul className="space-y-1.5">
                {aiKeyPoints.map((point) => (
                  <li key={point} className="flex gap-2 text-xs leading-relaxed" style={{ color: "var(--charcoal)" }}>
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: "var(--brand-orange)" }} />
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {aiMethod && <div className="text-xs leading-relaxed mb-2" style={{ color: "var(--slate)" }}>方法：{aiMethod}</div>}
          {aiMnemonic && <div className="text-xs leading-relaxed mb-2" style={{ color: "var(--brand-orange)" }}>口诀：{aiMnemonic}</div>}
          {aiExample && <div className="text-xs leading-relaxed mb-2" style={{ color: "var(--steel)" }}>例题：{aiExample}</div>}
          {aiSuggestion && <div className="text-xs leading-relaxed" style={{ color: "var(--steel)" }}>{aiSuggestion}</div>}
          {aiError && <div className="text-xs leading-relaxed" style={{ color: "var(--error)" }}>{aiError}</div>}
        </div>
      )}
    </article>
  );
}

function AnswerOptions({
  question,
  answer,
  submitted,
  onSelectAnswer,
  onToggleMulti,
}: {
  question: PracticeQuestion;
  answer?: AnswerValue;
  submitted: boolean;
  onSelectAnswer: (value: AnswerValue) => void;
  onToggleMulti: (key: string) => void;
}) {
  if (question.type === "true_false") {
    return (
      <div className="grid grid-cols-2 gap-3">
        {[
          { key: true, label: "正确" },
          { key: false, label: "错误" },
        ].map((option) => {
          const selected = answer === option.key;
          const correct = submitted && question.answer === option.key;
          return (
            <button
              key={String(option.key)}
              onClick={() => onSelectAnswer(option.key)}
              className="py-4 rounded-lg border text-sm font-semibold"
              style={{
                borderColor: correct ? "var(--brand-green)" : selected ? "var(--primary)" : "var(--hairline)",
                background: correct ? "rgba(47,148,98,0.09)" : selected ? "rgba(63,143,120,0.1)" : "var(--canvas)",
                color: correct ? "var(--brand-green)" : "var(--charcoal)",
              }}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    );
  }

  if (!question.options) return null;

  return (
    <div className="flex flex-col gap-2.5">
      {question.options.map((option) => {
        const displayText = getOptionDisplayText(option);
        const displayHtml = getOptionDisplayHtml(option);
        const selected = question.type === "multi_choice"
          ? String(answer || "").includes(option.key)
          : answer === option.key;
        const correct = question.type === "multi_choice"
          ? submitted && (question.answer as string[]).includes(option.key)
          : submitted && option.key === question.answer;
        const wrong = submitted && selected && !correct;

        return (
          <button
            key={option.key}
            onClick={() => question.type === "multi_choice" ? onToggleMulti(option.key) : onSelectAnswer(option.key)}
            className="answer-choice flex items-start gap-3 px-4 py-3 rounded-lg border text-left text-sm transition-all"
            style={{
              borderColor: correct ? "var(--brand-green)" : wrong ? "var(--error)" : selected ? "var(--primary)" : "var(--hairline)",
              background: correct ? "rgba(47,148,98,0.09)" : wrong ? "rgba(217,82,69,0.08)" : selected ? "rgba(63,143,120,0.1)" : "var(--canvas)",
              cursor: submitted ? "default" : "pointer",
            }}
          >
            <span
              className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold shrink-0"
              style={{
                background: correct ? "var(--brand-green)" : wrong ? "var(--error)" : selected ? "var(--primary)" : "var(--surface)",
                color: correct || wrong || selected ? "white" : "var(--slate)",
              }}
            >
              {option.key}
            </span>
            {displayText ? (
              <span className="leading-relaxed" style={{ color: "var(--charcoal)" }}>{displayText}</span>
            ) : displayHtml ? (
              <span
                className="question-material flex-1"
                dangerouslySetInnerHTML={{ __html: displayHtml }}
              />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function FilterButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="px-3 py-1.5 text-xs font-medium rounded-lg border"
      style={{
        background: active ? "var(--primary)" : "rgba(253,255,251,0.82)",
        color: active ? "white" : "var(--slate)",
        borderColor: active ? "var(--primary)" : "var(--hairline)",
      }}
    >
      {children}
    </button>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="stat-card rounded-2xl p-4" style={{ background: "var(--surface)" }}>
      <div className="text-xl font-semibold" style={{ color: "var(--ink)" }}>{value}</div>
      <div className="text-xs mt-0.5" style={{ color: "var(--steel)" }}>{label}</div>
    </div>
  );
}

function Tag({ label, bg, color }: { label: string; bg: string; color: string }) {
  return <span className="px-2 py-0.5 rounded text-xs font-semibold" style={{ background: bg, color }}>{label}</span>;
}
