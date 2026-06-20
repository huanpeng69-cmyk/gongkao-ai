"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  createHistoryKey,
  getAiConfigFingerprint,
  isCacheableAiResult,
  readHistory,
  withHistoryHit,
  writeHistory,
} from "@/lib/ai-history";
import { toDisplayList, toDisplayText } from "@/lib/ai-display";
import { getReviewPlan, recordReview } from "@/lib/store";
import type { ErrorEntry, Option, ReviewRating } from "@/lib/types";
import { requestAi } from "@/lib/client-ai";
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
} from "@/lib/question-utils";

type KnowledgeResult = {
  source?: string;
  title?: string;
  errorType?: string;
  analysis?: string;
  answerSummary?: string;
  keyPoints?: unknown[];
  method?: string;
  mnemonic?: string;
  example?: string;
  suggestion?: string;
  bihangTip?: string;
  detail?: string;
  error?: string;
  apiError?: string;
  historyHit?: boolean;
};

function hasUsefulKnowledgeResult(result?: KnowledgeResult | null) {
  if (!result) return false;
  return Boolean(
    toDisplayText(result.analysis || result.answerSummary || result.suggestion || result.method || result.mnemonic || result.example || result.apiError || result.error || result.detail) ||
      toDisplayList(result.keyPoints).length,
  );
}

function hasKnowledgeContent(result?: KnowledgeResult | null) {
  if (!result) return false;
  return Boolean(
    toDisplayText(result.analysis || result.answerSummary || result.suggestion || result.method || result.mnemonic || result.example) ||
      toDisplayList(result.keyPoints).length,
  );
}

function toKnowledgeErrorResult(error: unknown, status?: number): KnowledgeResult {
  const message = toDisplayText(error) || (status ? `请求失败（${status}）` : "讲解生成失败");
  return {
    source: "api_error",
    title: "讲解生成失败",
    analysis: `生成讲解时遇到问题：${message}`,
    keyPoints: [
      "检查设置里的 AI Key、Base URL 和模型名",
      "确认设置页的接口测试可以通过",
      "配置完成后可以重新点击生成讲解",
    ],
    apiError: message,
  };
}

function getClientImageSources(question: Parameters<typeof getQuestionImageSources>[0]) {
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

export default function ReviewPage() {
  const [plan, setPlan] = useState<ReturnType<typeof getReviewPlan> | null>(null);
  const [reviewMode, setReviewMode] = useState(false);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [userAnswer, setUserAnswer] = useState<string | null>(null);
  const [knowledgeLoading, setKnowledgeLoading] = useState(false);
  const [knowledgeResult, setKnowledgeResult] = useState<KnowledgeResult | null>(null);

  useEffect(() => {
    setPlan(getReviewPlan());
  }, []);

  if (!plan) return <div className="p-8 text-sm" style={{ color: "var(--steel)" }}>加载中...</div>;

  const queue = plan.reviewQueue;
  const current: ErrorEntry | undefined = queue[currentIdx];

  const handleReview = (rating: ReviewRating) => {
    if (!current) return;
    recordReview(current.questionId, rating);
    setPlan(getReviewPlan());
    setShowAnswer(false);
    setUserAnswer(null);
    setKnowledgeResult(null);
    if (currentIdx < queue.length - 1) {
      setCurrentIdx(currentIdx + 1);
    } else {
      setReviewMode(false);
      setCurrentIdx(0);
    }
  };

  const requestKnowledge = async () => {
    if (!current) return;
    const q = current.question;
    setKnowledgeLoading(true);
    setKnowledgeResult(null);

    try {
      const reviewAnswer = userAnswer ?? current.userAnswer;
      const body = {
        mode: "analyze",
        question: buildQuestionPromptText(q),
        userAnswer: getAnswerContent(q, reviewAnswer) || answerToText(reviewAnswer),
        correctAnswer: getCorrectAnswerContent(q) || getCorrectText(q),
        explanation: getDisplayExplanation(q),
        module: q.subModule || q.module,
        knowledgePoints: q.knowledgePoints,
        context: stripHtml(getQuestionMaterialHtml(q)),
        images: getClientImageSources(q),
      };
      const historyKey = createHistoryKey("ai", {
        scope: "review_analysis",
        questionId: current.questionId,
        config: getAiConfigFingerprint(),
        body: { ...body, requestVersion: "ai-card-v3-detailed" },
      });
      const cached = await readHistory<KnowledgeResult>(historyKey);
      if (hasUsefulKnowledgeResult(cached)) {
        setKnowledgeResult(withHistoryHit(cached as KnowledgeResult));
        return;
      }

      const data = (await requestAi(body)) as KnowledgeResult;
      if (data.error || (data.apiError && !hasKnowledgeContent(data))) {
        setKnowledgeResult(toKnowledgeErrorResult(data.apiError || data.error || data.analysis));
        return;
      }

      setKnowledgeResult(data);
      if (isCacheableAiResult(data)) {
        await writeHistory("ai", historyKey, data, data.title || `${q.subModule || q.module}错因讲解`);
      }
    } catch (err) {
      setKnowledgeResult(toKnowledgeErrorResult(err instanceof Error ? err.message : String(err)));
    } finally {
      setKnowledgeLoading(false);
    }
  };

  if (reviewMode && current) {
    const q = current.question;
    const materialHtml = getQuestionMaterialHtml(q);
    const questionText = getQuestionText(q);
    const correctText = getCorrectText(q);
    const correctContent = getCorrectAnswerContent(q);
    const knowledgeErrorType = toDisplayText(knowledgeResult?.errorType);
    const knowledgeAnalysis = toDisplayText(knowledgeResult?.analysis || knowledgeResult?.answerSummary);
    const knowledgeKeyPoints = toDisplayList(knowledgeResult?.keyPoints);
    const knowledgeMethod = toDisplayText(knowledgeResult?.method);
    const knowledgeMnemonic = toDisplayText(knowledgeResult?.mnemonic);
    const knowledgeExample = toDisplayText(knowledgeResult?.example);
    const knowledgeSuggestion = toDisplayText(knowledgeResult?.suggestion);
    const knowledgeBihangTip = toDisplayText(knowledgeResult?.bihangTip);
    const knowledgeError = toDisplayText(knowledgeResult?.error || knowledgeResult?.apiError || knowledgeResult?.detail);
    return (
      <div className="animate-in study-page review-page review-session-page">
        <div className="topbar sticky top-0 z-40 flex items-center px-8 h-14">
          <button onClick={() => { setReviewMode(false); setCurrentIdx(0); }} className="ghost-button text-sm font-medium mr-4 px-3 py-1.5 rounded-lg">← 退出</button>
          <span className="text-sm font-bold" style={{ color: "var(--ink)" }}>错题复习</span>
          <span className="text-xs ml-3" style={{ color: "var(--steel)" }}>{currentIdx + 1} / {queue.length}</span>
          <div className="ml-auto flex gap-2">
            <div className="px-2 py-1 rounded text-xs" style={{ background: current.loopStatus === "pending" ? "var(--brand-orange)" : "var(--link-blue)" }}>
              {current.loopStatus === "pending" ? "待复习" : `${current.loopCount}/3`}
            </div>
          </div>
        </div>

        <div className="p-8 max-w-[800px]">
          <div className="mb-6">
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--hairline-soft)" }}>
              <div className="h-full rounded-full transition-all" style={{ width: `${((currentIdx + 1) / queue.length) * 100}%`, background: "var(--primary)" }} />
            </div>
          </div>

          <div className="rounded-xl p-6 mb-5" style={{ background: "var(--canvas)", border: "1px solid var(--hairline)" }}>
            <div className="flex items-center gap-2 mb-4">
              <span className="px-2 py-0.5 rounded text-xs font-semibold" style={{ background: "var(--tint-peach)", color: "var(--brand-orange)" }}>{q.module}</span>
              <span className="px-2 py-0.5 rounded text-xs font-semibold" style={{ background: "var(--tint-sky)", color: "var(--link-blue)" }}>{q.subModule}</span>
              <span className="px-2 py-0.5 rounded text-xs font-semibold" style={{ background: "var(--tint-mint)", color: "var(--brand-green)" }}>
                环节 {current.loopCount + 1}/3
              </span>
            </div>

            {materialHtml && (
              <div
                className="question-material rounded-lg p-4 mb-4 overflow-x-auto"
                style={{ background: "var(--surface)", border: "1px solid var(--hairline)" }}
                dangerouslySetInnerHTML={{ __html: materialHtml }}
              />
            )}

            <div className="text-sm font-medium leading-relaxed mb-5 whitespace-pre-line" style={{ color: "var(--ink)" }}>{questionText}</div>

            {q.type === "single_choice" && q.options && (
              <div className="flex flex-col gap-2">
                {q.options.map((opt) => (
                  <button key={opt.key} onClick={() => !showAnswer && setUserAnswer(opt.key)}
                    className="flex items-start gap-3 px-4 py-3 rounded-lg border text-left text-sm transition-all"
                    style={{
                      borderColor: showAnswer && opt.key === q.answer ? "var(--brand-green)" : userAnswer === opt.key ? "var(--primary)" : "var(--hairline)",
                      background: showAnswer && opt.key === q.answer ? "rgba(47,148,98,0.09)" : userAnswer === opt.key ? "rgba(63,143,120,0.1)" : "var(--canvas)",
                      cursor: showAnswer ? "default" : "pointer",
                    }}>
                    <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold shrink-0"
                      style={{
                        background: showAnswer && opt.key === q.answer ? "var(--brand-green)" : userAnswer === opt.key ? "var(--primary)" : "var(--surface)",
                        color: (showAnswer && opt.key === q.answer) || userAnswer === opt.key ? "white" : "var(--slate)",
                      }}>{opt.key}</span>
                    <OptionBody option={opt} />
                  </button>
                ))}
              </div>
            )}

            {q.type === "multi_choice" && q.options && (
              <div className="flex flex-col gap-2">
                {q.options.map((opt) => {
                  const correctKeys = q.answer as string[];
                  return (
                    <div key={opt.key} className="flex items-start gap-3 px-4 py-3 rounded-lg border text-sm"
                      style={{
                        borderColor: showAnswer && correctKeys.includes(opt.key) ? "var(--brand-green)" : "var(--hairline)",
                        background: showAnswer && correctKeys.includes(opt.key) ? "rgba(47,148,98,0.09)" : "var(--canvas)",
                      }}>
                      <span className="w-5 h-5 rounded flex items-center justify-center text-xs shrink-0 border-2 mt-0.5"
                        style={{ borderColor: showAnswer && correctKeys.includes(opt.key) ? "var(--brand-green)" : "var(--hairline-strong)", background: showAnswer && correctKeys.includes(opt.key) ? "var(--brand-green)" : "var(--canvas)", color: showAnswer && correctKeys.includes(opt.key) ? "white" : "transparent" }}>✓</span>
                      <OptionBody option={opt} />
                    </div>
                  );
                })}
              </div>
            )}

            {q.type === "true_false" && (
              <div className="flex gap-4">
                {[{ v: true, l: "正确" }, { v: false, l: "错误" }].map((opt) => (
                  <div key={String(opt.v)} className="flex-1 py-4 rounded-lg border-2 text-center text-base font-semibold"
                    style={{
                      borderColor: showAnswer && q.answer === opt.v ? "var(--brand-green)" : "var(--hairline)",
                      background: showAnswer && q.answer === opt.v ? "rgba(47,148,98,0.09)" : "var(--canvas)",
                      color: showAnswer && q.answer === opt.v ? "var(--brand-green)" : "var(--slate)",
                    }}>{opt.l}</div>
                ))}
              </div>
            )}

            {!showAnswer && (
              <div className="mt-4 p-3 rounded-lg" style={{ background: "var(--tint-peach)" }}>
                <div className="text-xs font-semibold" style={{ color: "var(--brand-orange)" }}>你上次答的是：{String(current.userAnswer)}</div>
                <div className="text-xs mt-0.5" style={{ color: "var(--steel)" }}>再想想这道题怎么做？</div>
              </div>
            )}
          </div>

          {!showAnswer ? (
            <button onClick={() => setShowAnswer(true)}
              className="px-5 py-2.5 text-sm font-medium rounded-lg text-white"
              style={{ background: "var(--primary)" }}>查看答案</button>
          ) : (
            <div className="rounded-xl p-5" style={{ background: "var(--canvas)", border: "1px solid var(--hairline)" }}>
              <div className="mb-4">
                <div className="text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: "var(--steel)" }}>答案</div>
                <div className="text-sm">
                  <span className="font-semibold" style={{ color: "var(--brand-green)" }}>正确答案：{correctText}</span>
                  {correctContent && correctContent !== correctText && <span className="ml-2" style={{ color: "var(--charcoal)" }}>{correctContent}</span>}
                  {userAnswer && (
                    <>
                      <span className="mx-2">·</span>
                      <span>你的选择：{userAnswer}</span>
                      {getAnswerContent(q, userAnswer) !== userAnswer && <span className="ml-1">{getAnswerContent(q, userAnswer)}</span>}
                    </>
                  )}
                </div>
              </div>
              <div className="rounded-lg p-4 mb-4" style={{ background: "var(--surface)", border: "1px solid var(--hairline)" }}>
                <div className="flex items-center gap-3">
                  <div>
                    <div className="text-sm font-semibold" style={{ color: "var(--ink)" }}>AI 错因讲解</div>
                    <div className="text-xs mt-0.5" style={{ color: "var(--steel)" }}>使用系统设置里的 AI，把这道错题拆成错因、方法和易错提醒。</div>
                  </div>
                  <button
                    onClick={requestKnowledge}
                    disabled={knowledgeLoading}
                    className="ml-auto px-3 py-1.5 text-xs font-medium rounded-md border disabled:opacity-50"
                    style={{ borderColor: "var(--hairline-strong)", color: "var(--primary)", background: "var(--canvas)" }}
                  >
                    {knowledgeLoading ? "讲解生成中..." : "生成讲解"}
                  </button>
                </div>
                {knowledgeResult && (
                  <div className="mt-4">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="text-sm font-semibold" style={{ color: "var(--ink)" }}>{knowledgeResult.title || "错因讲解"}</div>
                      {knowledgeResult.historyHit && (
                        <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold" style={{ background: "var(--tint-mint)", color: "var(--primary)" }}>历史记录</span>
                      )}
                    </div>
                    {knowledgeErrorType && <div className="text-xs font-semibold mb-2" style={{ color: "var(--brand-orange)" }}>错因：{knowledgeErrorType}</div>}
                    {knowledgeAnalysis && <div className="text-sm leading-7 mb-4 whitespace-pre-wrap" style={{ color: "var(--charcoal)" }}>{knowledgeAnalysis}</div>}
                    {knowledgeKeyPoints.length > 0 && (
                      <div className="mb-4">
                        <div className="text-sm font-bold mb-2" style={{ color: "var(--ink)" }}>要点归纳</div>
                        <ul className="space-y-2">
                          {knowledgeKeyPoints.map((point) => (
                            <li key={point} className="flex gap-2 text-sm leading-relaxed" style={{ color: "var(--charcoal)" }}>
                              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: "var(--primary)" }} />
                              <span>{point}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {(knowledgeMnemonic || knowledgeExample) && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                        {knowledgeMnemonic && (
                          <div className="rounded-lg p-3" style={{ background: "var(--canvas)", border: "1px solid var(--hairline)" }}>
                            <div className="text-sm font-bold mb-2" style={{ color: "var(--primary)" }}>记忆口诀</div>
                            <div className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: "var(--charcoal)" }}>{knowledgeMnemonic}</div>
                          </div>
                        )}
                        {knowledgeExample && (
                          <div className="rounded-lg p-3" style={{ background: "var(--canvas)", border: "1px solid var(--hairline)" }}>
                            <div className="text-sm font-bold mb-2" style={{ color: "var(--primary)" }}>经典例题</div>
                            <div className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: "var(--charcoal)" }}>{knowledgeExample}</div>
                          </div>
                        )}
                      </div>
                    )}
                    {knowledgeMethod && <div className="text-xs leading-relaxed mb-2" style={{ color: "var(--slate)" }}>方法：{knowledgeMethod}</div>}
                    {knowledgeBihangTip && <div className="text-xs leading-relaxed mb-2" style={{ color: "var(--brand-orange)" }}>技巧：{knowledgeBihangTip}</div>}
                    {knowledgeSuggestion && <div className="text-xs leading-relaxed" style={{ color: "var(--steel)" }}>{knowledgeSuggestion}</div>}
                    {knowledgeError && <div className="text-xs mt-2" style={{ color: "var(--error)" }}>{knowledgeError}</div>}
                  </div>
                )}
              </div>
              <div className="grid grid-cols-4 gap-2 mt-5">
                <ReviewButton label="重来" hint="今天" color="var(--error)" onClick={() => handleReview("again")} />
                <ReviewButton label="困难" hint="1天后" color="var(--brand-orange)" onClick={() => handleReview("hard")} />
                <ReviewButton label="一般" hint="按曲线" color="var(--primary)" onClick={() => handleReview("good")} />
                <ReviewButton label="轻松" hint="拉长间隔" color="var(--brand-green)" onClick={() => handleReview("easy")} />
              </div>
              <div className="text-xs mt-2 text-center" style={{ color: "var(--steel)" }}>
                参考 Anki 复习模式；连续记住 3 次后自动标记为「已掌握」
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="animate-in study-page review-page">
      <div className="topbar sticky top-0 z-40 flex items-center px-8 h-14">
        <span className="text-sm font-bold" style={{ color: "var(--ink)" }}>复习计划</span>
        <span className="text-xs ml-2" style={{ color: "var(--steel)" }}>基于遗忘曲线的智能复习安排</span>
      </div>

      <div className="p-8 max-w-[1100px]">
        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="rounded-xl p-5" style={{ background: plan.overdue > 0 ? "var(--tint-peach)" : "var(--tint-mint)" }}>
            <div className="w-8 h-8 rounded-xl flex items-center justify-center text-sm font-bold mb-3" style={{ background: "rgba(253,255,251,0.72)", color: plan.overdue > 0 ? "var(--brand-orange)" : "var(--brand-green)" }}>{plan.overdue > 0 ? "!" : "✓"}</div>
            <div className="text-xl font-semibold" style={{ color: plan.overdue > 0 ? "var(--brand-orange)" : "var(--brand-green)" }}>{plan.overdue}</div>
            <div className="text-xs" style={{ color: "var(--steel)" }}>已逾期</div>
          </div>
          <div className="rounded-xl p-5" style={{ background: "var(--tint-sky)" }}>
            <div className="w-8 h-8 rounded-xl flex items-center justify-center text-sm font-bold mb-3" style={{ background: "rgba(253,255,251,0.72)", color: "var(--link-blue)" }}>T</div>
            <div className="text-xl font-semibold" style={{ color: "var(--link-blue)" }}>{plan.dueToday}</div>
            <div className="text-xs" style={{ color: "var(--steel)" }}>今日待复习</div>
          </div>
          <div className="rounded-xl p-5" style={{ background: "var(--tint-lavender)" }}>
            <div className="w-8 h-8 rounded-xl flex items-center justify-center text-sm font-bold mb-3" style={{ background: "rgba(253,255,251,0.72)", color: "var(--link-blue)" }}>↻</div>
            <div className="text-xl font-semibold" style={{ color: "var(--link-blue)" }}>{plan.reviewing}</div>
            <div className="text-xs" style={{ color: "var(--steel)" }}>复习中</div>
          </div>
          <div className="rounded-xl p-5" style={{ background: "var(--tint-mint)" }}>
            <div className="w-8 h-8 rounded-xl flex items-center justify-center text-sm font-bold mb-3" style={{ background: "rgba(253,255,251,0.72)", color: "var(--brand-green)" }}>✓</div>
            <div className="text-xl font-semibold" style={{ color: "var(--brand-green)" }}>{plan.mastered}</div>
            <div className="text-xs" style={{ color: "var(--steel)" }}>已掌握</div>
          </div>
        </div>

        {queue.length > 0 && (
          <div className="accent-band p-6 mb-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-lg font-bold mb-1" style={{ color: "var(--ink)" }}>今日有 {queue.length} 道错题待复习</div>
                <div className="text-sm" style={{ color: "var(--slate)" }}>开始复习后，系统会逐题展示，答对3次自动标记为已掌握</div>
              </div>
              <button onClick={() => setReviewMode(true)}
                className="primary-button px-6 py-3 text-sm font-semibold rounded-xl shrink-0">开始复习</button>
            </div>
          </div>
        )}

        {queue.length === 0 && (
          <div className="rounded-xl p-8 mb-6 text-center" style={{ background: "var(--canvas)", border: "1px solid var(--hairline)" }}>
            <div className="mx-auto mb-3 w-12 h-12 rounded-full flex items-center justify-center text-base font-bold" style={{ background: "var(--tint-mint)", color: "var(--primary)" }}>✓</div>
            <div className="text-base font-semibold" style={{ color: "var(--ink)" }}>今日无需复习</div>
            <div className="text-sm mt-1" style={{ color: "var(--steel)" }}>继续刷题吧，系统会在合适的时间安排复习</div>
            <Link href="/quiz" className="inline-block mt-4 px-5 py-2.5 text-sm font-medium rounded-lg text-white" style={{ background: "var(--primary)" }}>去刷题</Link>
          </div>
        )}

        <div className="rounded-xl p-5" style={{ background: "var(--canvas)", border: "1px solid var(--hairline)" }}>
          <h3 className="text-sm font-semibold mb-4" style={{ color: "var(--ink)" }}>未来7天复习计划</h3>
          <div className="grid grid-cols-7 gap-2">
            {plan.upcoming.map((day) => {
              const d = new Date(day.date);
              const dayLabel = `${d.getMonth() + 1}/${d.getDate()}`;
              const weekdayNames = ["日", "一", "二", "三", "四", "五", "六"];
              const weekday = weekdayNames[d.getDay()];
              return (
                <div key={day.date} className="rounded-lg p-3 text-center" style={{
                  background: day.count > 0 ? "var(--tint-peach)" : "var(--surface)",
                  border: day.count > 0 ? "1px solid rgba(221,91,0,0.2)" : "1px solid var(--hairline-soft)",
                }}>
                  <div className="text-xs" style={{ color: "var(--steel)" }}>周{weekday}</div>
                  <div className="text-xs font-semibold mt-0.5" style={{ color: "var(--ink)" }}>{dayLabel}</div>
                  <div className="text-sm font-bold mt-1" style={{ color: day.count > 0 ? "var(--brand-orange)" : "var(--muted)" }}>
                    {day.count > 0 ? `${day.count}题` : "-"}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function ReviewButton({ label, hint, color, onClick }: { label: string; hint: string; color: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="py-3 rounded-lg text-white" style={{ background: color }}>
      <div className="text-sm font-semibold">{label}</div>
      <div className="text-[11px] opacity-80">{hint}</div>
    </button>
  );
}

function OptionBody({ option }: { option: Option }) {
  const displayText = getOptionDisplayText(option);
  const displayHtml = getOptionDisplayHtml(option);

  if (displayText) {
    return <span style={{ color: "var(--charcoal)" }}>{displayText}</span>;
  }

  if (displayHtml) {
    return (
      <span
        className="question-material flex-1"
        dangerouslySetInnerHTML={{ __html: displayHtml }}
      />
    );
  }

  return null;
}
