"use client";

import { useEffect, useMemo, useState } from "react";
import { loadQuestionBank } from "@/lib/question-bank-client";
import { loadData, recordAnswer } from "@/lib/store";
import type { Question } from "@/lib/types";
import {
  getCorrectAnswerContent,
  getCorrectText,
  getDisplayExplanation,
  getOptionDisplayHtml,
  getOptionDisplayText,
  getQuestionMaterialHtml,
  getQuestionText,
  type AnswerValue,
} from "@/lib/question-utils";

type MockQuestion = Question & {
  num?: number;
  sourceTitle?: string;
};

function parseYear(title = "") {
  return Number(title.match(/(20\d{2})/)?.[1] || 0);
}

function answerText(value?: AnswerValue) {
  if (value === undefined || value === "") return "未答";
  if (typeof value === "boolean") return value ? "正确" : "错误";
  return Array.isArray(value) ? value.join("") : String(value);
}

function isCorrectAnswer(question: MockQuestion, value?: AnswerValue) {
  if (value === undefined || value === "") return false;
  if (question.type === "multi_choice") {
    const expected = question.answer as string[];
    const selected = String(value).split("").sort();
    return expected.length === selected.length && expected.every((key) => selected.includes(key));
  }
  if (question.type === "true_false") return value === question.answer;
  return value === question.answer;
}

function mergeMultiAnswer(current: AnswerValue | undefined, key: string) {
  const set = new Set(String(current || "").split("").filter(Boolean));
  if (set.has(key)) set.delete(key);
  else set.add(key);
  return Array.from(set).sort().join("");
}

function formatTime(seconds: number) {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

export default function MockExamPage() {
  const [questions, setQuestions] = useState<MockQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [selectedPaper, setSelectedPaper] = useState("");
  const [durationMinutes, setDurationMinutes] = useState(90);
  const [examQuestions, setExamQuestions] = useState<MockQuestion[]>([]);
  const [answeredIds, setAnsweredIds] = useState<string[]>([]);
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
  const [submitted, setSubmitted] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(90 * 60);
  const [activeId, setActiveId] = useState("");

  useEffect(() => {
    let mounted = true;
    async function loadBank() {
      setLoading(true);
      setLoadError("");
      try {
        const data = await loadQuestionBank<MockQuestion>(10000);
        if (!mounted) return;
        setQuestions(data.questions || []);
        setAnsweredIds(loadData().answeredIds || []);
        if (data.error) setLoadError(data.error);
      } catch (error) {
        if (!mounted) return;
        setAnsweredIds(loadData().answeredIds || []);
        setLoadError(error instanceof Error ? error.message : String(error));
      } finally {
        if (mounted) setLoading(false);
      }
    }
    loadBank();
    return () => {
      mounted = false;
    };
  }, []);

  const availableQuestions = useMemo(() => {
    const answeredSet = new Set(answeredIds);
    return questions.filter((question) => !answeredSet.has(question.id));
  }, [questions, answeredIds]);

  const papers = useMemo(() => {
    const map = new Map<string, number>();
    availableQuestions.forEach((question) => {
      const title = question.sourceTitle || question.source || "未命名试卷";
      map.set(title, (map.get(title) || 0) + 1);
    });
    return Array.from(map.entries())
      .filter(([, count]) => count >= 20)
      .sort((a, b) => parseYear(b[0]) - parseYear(a[0]) || b[1] - a[1] || a[0].localeCompare(b[0], "zh-Hans"));
  }, [availableQuestions]);

  useEffect(() => {
    if (papers.length > 0 && (!selectedPaper || !papers.some(([paper]) => paper === selectedPaper))) {
      setSelectedPaper(papers[0][0]);
    }
  }, [papers, selectedPaper]);

  const selectedPaperCount = papers.find(([paper]) => paper === selectedPaper)?.[1] || 0;
  const answeredCount = examQuestions.filter((question) => answers[question.id] !== undefined && answers[question.id] !== "").length;
  const correctCount = submitted
    ? examQuestions.filter((question) => isCorrectAnswer(question, answers[question.id])).length
    : 0;
  const accuracy = submitted && examQuestions.length > 0 ? Math.round((correctCount / examQuestions.length) * 100) : 0;

  useEffect(() => {
    if (!examQuestions.length || submitted) return;
    if (remainingSeconds <= 0) {
      submitExam();
      return;
    }
    const timer = window.setTimeout(() => setRemainingSeconds((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [examQuestions.length, remainingSeconds, submitted]);

  const startExam = () => {
    const nextQuestions = availableQuestions.filter((question) => (question.sourceTitle || question.source) === selectedPaper);
    setExamQuestions(nextQuestions);
    setAnswers({});
    setSubmitted(false);
    setRemainingSeconds(Math.max(1, durationMinutes) * 60);
    setActiveId(nextQuestions[0]?.id || "");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const submitExam = () => {
    if (!examQuestions.length || submitted) return;
    setSubmitted(true);
    let nextData = loadData();
    examQuestions.forEach((question) => {
      const value = answers[question.id];
      if (value !== undefined && value !== "") {
        nextData = recordAnswer(question, value, isCorrectAnswer(question, value), question.moduleKey);
      }
    });
    setAnsweredIds(nextData.answeredIds || []);
  };

  const selectAnswer = (question: MockQuestion, value: AnswerValue) => {
    if (submitted) return;
    setAnswers((prev) => ({ ...prev, [question.id]: value }));
  };

  const jumpTo = (question: MockQuestion) => {
    setActiveId(question.id);
    document.getElementById(`mock-${question.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="animate-in study-page mock-page">
      <div className="topbar sticky top-0 z-40 flex items-center px-8 h-14">
        <span className="text-sm font-bold" style={{ color: "var(--ink)" }}>真题组卷模考</span>
        <span className="ml-2 text-xs" style={{ color: "var(--steel)" }}>整卷计时 · 答题卡 · 交卷评分</span>
        {examQuestions.length > 0 && !submitted && (
          <button onClick={submitExam} className="primary-button ml-auto px-3 py-1.5 text-xs font-medium rounded-lg">
            交卷
          </button>
        )}
      </div>

      <div className="page-shell">
        <section className="bank-toolbar p-4 mb-4" style={{ background: "rgba(253,255,251,0.92)", border: "1px solid var(--hairline)" }}>
          <div className="mock-toolbar-stats grid grid-cols-4 gap-3 mb-4">
            <Stat label="未做试卷" value={loading ? "..." : papers.length} />
            <Stat label="本卷未做" value={selectedPaperCount || "-"} />
            <Stat label="已答题数" value={examQuestions.length ? `${answeredCount}/${examQuestions.length}` : "-"} />
            <Stat label={submitted ? "本次得分" : "剩余时间"} value={submitted ? `${correctCount}/${examQuestions.length}` : examQuestions.length ? formatTime(remainingSeconds) : "-"} />
          </div>

          <div className="mock-toolbar-controls grid grid-cols-[1fr_160px_140px] gap-3">
            <select
              value={selectedPaper}
              onChange={(event) => setSelectedPaper(event.target.value)}
              disabled={examQuestions.length > 0 && !submitted}
              className="quiet-input px-3 py-2 text-sm rounded-xl"
            >
              {papers.map(([paper, count]) => (
                <option key={paper} value={paper}>{paper}（{count}题）</option>
              ))}
            </select>
            <input
              type="number"
              min={1}
              max={240}
              value={durationMinutes}
              onChange={(event) => setDurationMinutes(Number(event.target.value) || 90)}
              disabled={examQuestions.length > 0 && !submitted}
              className="quiet-input px-3 py-2 text-sm rounded-xl"
            />
            <button
              onClick={startExam}
              disabled={!selectedPaper || loading}
              className="primary-button px-4 py-2 text-sm font-semibold rounded-xl disabled:opacity-50"
            >
              {examQuestions.length ? "重开本卷" : "开始模考"}
            </button>
          </div>

          {loadError && (
            <div className="mt-3 text-xs rounded-md px-3 py-2" style={{ background: "var(--tint-peach)", color: "var(--brand-orange)" }}>
              {loadError}
            </div>
          )}
          {submitted && (
            <div className="mt-3 rounded-lg px-4 py-3 flex items-center gap-4" style={{ background: "var(--tint-mint)", color: "var(--brand-green)" }}>
              <span className="text-sm font-bold">交卷完成</span>
              <span className="text-sm">正确 {correctCount} 题，正确率 {accuracy}%</span>
              <span className="text-xs" style={{ color: "var(--slate)" }}>未作答按错题计入本次得分，已作答题目写入学习记录。</span>
            </div>
          )}
        </section>

        {!examQuestions.length && (
          <div className="soft-card p-8 text-center" style={{ color: "var(--steel)" }}>
            {loading ? "题库加载中..." : "选择一套真题后开始模考。"}
          </div>
        )}

        {examQuestions.length > 0 && (
          <div className="mock-exam-layout grid grid-cols-[260px_1fr] gap-4">
            <aside className="mock-answer-card soft-card p-3 h-fit sticky top-20">
              <div className="text-xs font-semibold mb-3" style={{ color: "var(--steel)" }}>答题卡</div>
              <div className="mock-answer-grid grid grid-cols-10 gap-1">
                {examQuestions.map((question, index) => {
                  const answered = answers[question.id] !== undefined && answers[question.id] !== "";
                  const correct = submitted && isCorrectAnswer(question, answers[question.id]);
                  return (
                    <button
                      key={question.id}
                      onClick={() => jumpTo(question)}
                      className="h-7 rounded-md text-[10px] font-semibold border tabular-nums"
                      style={{
                        borderColor: activeId === question.id ? "var(--primary)" : "var(--hairline)",
                        background: submitted
                          ? correct ? "rgba(47,148,98,0.12)" : "rgba(217,82,69,0.1)"
                          : answered ? "var(--tint-sky)" : "var(--canvas)",
                        color: submitted
                          ? correct ? "var(--brand-green)" : "var(--error)"
                          : answered ? "var(--link-blue)" : "var(--steel)",
                      }}
                    >
                      {index + 1}
                    </button>
                  );
                })}
              </div>
              {!submitted && (
                <button onClick={submitExam} className="primary-button w-full mt-4 px-4 py-2 text-sm font-semibold rounded-xl">
                  交卷
                </button>
              )}
            </aside>

            <main className="mock-question-list question-panel p-5" style={{ background: "var(--canvas)", border: "1px solid var(--hairline)" }}>
              {examQuestions.map((question, index) => (
                <MockQuestionCard
                  key={question.id}
                  question={question}
                  index={index}
                  answer={answers[question.id]}
                  submitted={submitted}
                  onFocus={() => setActiveId(question.id)}
                  onSelect={(value) => selectAnswer(question, value)}
                  onToggleMulti={(key) => selectAnswer(question, mergeMultiAnswer(answers[question.id], key))}
                />
              ))}
            </main>
          </div>
        )}
      </div>
    </div>
  );
}

function MockQuestionCard({
  question,
  index,
  answer,
  submitted,
  onFocus,
  onSelect,
  onToggleMulti,
}: {
  question: MockQuestion;
  index: number;
  answer?: AnswerValue;
  submitted: boolean;
  onFocus: () => void;
  onSelect: (value: AnswerValue) => void;
  onToggleMulti: (key: string) => void;
}) {
  const correct = submitted && isCorrectAnswer(question, answer);
  const materialHtml = getQuestionMaterialHtml(question);
  const explanation = getDisplayExplanation(question);

  return (
    <article id={`mock-${question.id}`} onMouseEnter={onFocus} className="pb-6 mb-6" style={{ borderBottom: "1px solid var(--hairline-soft)" }}>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span className="text-base font-semibold mr-1" style={{ color: "var(--ink)" }}>{index + 1}.</span>
        <Tag label={question.module} bg="var(--tint-lavender)" color="var(--brand-navy)" />
        <Tag label={question.subModule} bg="var(--tint-peach)" color="var(--brand-orange)" />
      </div>

      {materialHtml && (
        <div
          className="question-material rounded-lg p-4 mb-4 overflow-x-auto"
          style={{ background: "var(--surface)", border: "1px solid var(--hairline)" }}
          dangerouslySetInnerHTML={{ __html: materialHtml }}
        />
      )}

      <div className="text-base leading-relaxed mb-5 whitespace-pre-line" style={{ color: "var(--ink)" }}>{getQuestionText(question)}</div>

      <ExamOptions question={question} answer={answer} submitted={submitted} onSelect={onSelect} onToggleMulti={onToggleMulti} />

      {submitted && (
        <div className="mt-4 rounded-lg p-4" style={{ background: correct ? "rgba(47,148,98,0.08)" : "rgba(217,82,69,0.08)" }}>
          <div className="grid gap-2">
            <div className="text-sm font-semibold" style={{ color: correct ? "var(--brand-green)" : "var(--error)" }}>
              {correct ? "回答正确" : "回答错误"}
            </div>
            <div className="text-sm" style={{ color: "var(--charcoal)" }}>
              你的答案：{answerText(answer)}；正确答案：{getCorrectText(question)}
              {getCorrectAnswerContent(question) && <span>（{getCorrectAnswerContent(question)}）</span>}
            </div>
            {explanation && (
              <div className="text-sm leading-relaxed whitespace-pre-line" style={{ color: "var(--slate)" }}>
                {explanation}
              </div>
            )}
          </div>
        </div>
      )}
    </article>
  );
}

function ExamOptions({
  question,
  answer,
  submitted,
  onSelect,
  onToggleMulti,
}: {
  question: MockQuestion;
  answer?: AnswerValue;
  submitted: boolean;
  onSelect: (value: AnswerValue) => void;
  onToggleMulti: (key: string) => void;
}) {
  if (question.type === "true_false") {
    return (
      <div className="grid grid-cols-2 gap-3">
        {[
          { key: true, label: "正确" },
          { key: false, label: "错误" },
        ].map((option) => (
          <button
            key={String(option.key)}
            onClick={() => onSelect(option.key)}
            disabled={submitted}
            className="py-4 rounded-lg border text-sm font-semibold"
            style={{
              borderColor: answer === option.key ? "var(--primary)" : "var(--hairline)",
              background: answer === option.key ? "rgba(63,143,120,0.1)" : "var(--canvas)",
              color: "var(--charcoal)",
            }}
          >
            {option.label}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      {(question.options || []).map((option) => {
        const displayText = getOptionDisplayText(option);
        const displayHtml = getOptionDisplayHtml(option);
        const selected = question.type === "multi_choice" ? String(answer || "").includes(option.key) : answer === option.key;
        const correct = question.type === "multi_choice"
          ? submitted && (question.answer as string[]).includes(option.key)
          : submitted && option.key === question.answer;
        const wrong = submitted && selected && !correct;

        return (
          <button
            key={option.key}
            onClick={() => question.type === "multi_choice" ? onToggleMulti(option.key) : onSelect(option.key)}
            disabled={submitted}
            className="answer-choice flex items-start gap-3 px-4 py-3 rounded-lg border text-left text-sm transition-all"
            style={{
              borderColor: correct ? "var(--brand-green)" : wrong ? "var(--error)" : selected ? "var(--primary)" : "var(--hairline)",
              background: correct ? "rgba(47,148,98,0.09)" : wrong ? "rgba(217,82,69,0.08)" : selected ? "rgba(63,143,120,0.1)" : "var(--canvas)",
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
              <span className="question-material flex-1" dangerouslySetInnerHTML={{ __html: displayHtml }} />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
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
