"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  createHistoryKey,
  deleteHistory,
  getAiConfigFingerprint,
  getImageConfigFingerprint,
  type HistoryEntry,
  isCacheableAiResult,
  isCacheableImageResult,
  listHistory,
  readHistory,
  withHistoryHit,
  writeHistory,
} from "@/lib/ai-history";
import { toDisplayList, toDisplayText } from "@/lib/ai-display";
import { getErrorStats, getReviewPlan, loadData, resetTodayIfNeeded } from "@/lib/store";
import { preloadImage } from "@/lib/image-optimizer";
import { requestAi } from "@/lib/client-ai";
import { requestImage } from "@/lib/client-image";
import { readSavedImageConfig } from "@/lib/default-ai-config";

type TutorResult = {
  source?: string;
  title?: string;
  analysis?: string;
  keyPoints?: unknown[];
  method?: string;
  mnemonic?: string;
  example?: string;
  answerSummary?: string;
  suggestion?: string;
  errorType?: string;
  error?: string;
  detail?: string;
  apiError?: string;
  historyHit?: boolean;
};

type ComicResult = {
  imageUrl?: string;
  b64Json?: string;
  mimeType?: string;
  error?: string;
  detail?: string;
  historyHit?: boolean;
};

export default function Dashboard() {
  const [data, setData] = useState<ReturnType<typeof loadData> | null>(null);
  const [reviewPlan, setReviewPlan] = useState<ReturnType<typeof getReviewPlan> | null>(null);

  useEffect(() => {
    if (!localStorage.getItem("gongkao-current-user")) {
      window.location.href = "/login";
      return;
    }
    resetTodayIfNeeded();
    setData(loadData());
    setReviewPlan(getReviewPlan());
  }, []);

  if (!data) return <div className="p-8 text-sm" style={{ color: "var(--steel)" }}>加载中...</div>;

  const user = data.user;
  const accuracy = user.totalQuestions > 0 ? Math.round((user.totalCorrect / user.totalQuestions) * 100) : 0;
  const todayAccuracy = user.todayDone > 0 ? Math.round((user.todayCorrect / user.todayDone) * 100) : 0;
  const errorStats = getErrorStats();
  const pendingErrors = errorStats.pending;
  const dueToday = reviewPlan?.dueToday || 0;
  const overdue = reviewPlan?.overdue || 0;
  const goalProgress = user.dailyGoal > 0 ? Math.min(100, Math.round((user.todayDone / user.dailyGoal) * 100)) : 0;

  const weakPoints = Object.entries(user.knowledgeProfile)
    .filter(([, kp]) => kp.total > 0)
    .map(([name, kp]) => ({
      name,
      total: kp.total,
      correct: kp.correct,
      rate: Math.round((kp.correct / kp.total) * 100),
    }))
    .sort((a, b) => a.rate - b.rate)
    .slice(0, 3);

  return (
    <div className="study-page animate-in">
      <div className="topbar sticky top-0 z-40 flex items-center px-8 h-14">
        <span className="text-sm font-bold" style={{ color: "var(--ink)" }}>学习主页</span>
        <div className="ml-auto flex gap-2">
          <Link href="/settings" className="ghost-button px-3 py-1.5 text-xs font-medium rounded-lg">
            设置
          </Link>
          <Link href="/quiz" className="primary-button px-3 py-1.5 text-xs font-medium rounded-lg">
            打开题库
          </Link>
        </div>
      </div>

      <div className="page-shell">
        <div className="dashboard-hero p-8 mb-6">
          <div className="mobile-home-brand">
            <div className="mobile-brand-lockup">
              <div className="mobile-brand-mark">▰</div>
              <div>
                <div className="mobile-brand-title">公考私教</div>
                <div className="mobile-brand-subtitle">AI Study Desk</div>
              </div>
            </div>
            <Link href="/settings" className="mobile-bell" aria-label="系统设置">○</Link>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_300px] gap-6 items-stretch">
            <div className="mobile-hero-copy">
              <div className="eyebrow mb-2">Dashboard</div>
              <h1 className="text-3xl font-bold mb-2" style={{ color: "var(--ink)" }}>
                你好，<span className="mobile-name-accent">{user.name}</span>
              </h1>
              <p className="text-sm mb-7 max-w-[680px]" style={{ color: "var(--slate)" }}>
                {user.totalQuestions === 0
                  ? "欢迎使用公务员智学。先从真题题库开始，系统会记录错题、安排复习，并用 AI 帮你讲透原因。"
                  : `你已经累计刷题 ${user.totalQuestions} 道，正确率 ${accuracy}%。继续保持！`}
              </p>
              <div className="mobile-ai-cube" aria-hidden="true">
                <span>AI</span>
              </div>

              <div className="mobile-metric-grid grid grid-cols-4 gap-4">
                <Metric label="总刷题量" value={user.totalQuestions} color="var(--primary)" />
                <Metric label="综合正确率" value={`${accuracy}%`} color="var(--brand-green)" />
                <Metric label="今日已做" value={user.todayDone} color="var(--link-blue)" />
                <Metric label="待复习错题" value={pendingErrors} color="var(--brand-orange)" />
              </div>
            </div>

            <div className="soft-card today-plan-card p-5 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-11 h-11 rounded-full flex items-center justify-center text-sm font-bold" style={{ background: "linear-gradient(135deg, var(--primary), var(--link-blue))", color: "white" }}>
                    {user.name.charAt(0).toUpperCase() || "学"}
                  </div>
                  <div>
                    <div className="text-sm font-bold" style={{ color: "var(--ink)" }}>今日计划</div>
                    <div className="text-xs" style={{ color: "var(--steel)" }}>{user.streak > 0 ? `连续学习 ${user.streak} 天` : "从今天开始建立节奏"}</div>
                  </div>
                </div>
                <div className="flex items-end gap-2 mb-2">
                  <span className="text-4xl font-bold" style={{ color: "var(--primary)" }}>{goalProgress}</span>
                  <span className="pb-1 text-sm font-semibold" style={{ color: "var(--steel)" }}>%</span>
                </div>
                <div className="text-xs mb-3" style={{ color: "var(--steel)" }}>今日目标：{user.todayDone}/{user.dailyGoal} 题</div>
                <div className="h-2.5 rounded-full overflow-hidden" style={{ background: "var(--hairline-soft)" }}>
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${goalProgress}%`, background: goalProgress >= 100 ? "var(--brand-green)" : "var(--primary)" }}
                  />
                </div>
              </div>
              <Link href={dueToday > 0 ? "/review" : "/quiz"} className="primary-button mt-5 text-center px-4 py-2.5 text-sm font-semibold rounded-xl">
                {dueToday > 0 ? `复习 ${dueToday} 题` : "继续刷题"}
              </Link>
            </div>
          </div>
        </div>

        <HomeTutorPanel />

        {(overdue > 0 || dueToday > 0) && (
          <div className="soft-card mb-4 px-5 py-4 flex items-center gap-4" style={{ background: overdue > 0 ? "rgba(255,232,221,0.72)" : "rgba(253,255,251,0.9)" }}>
            <div className="w-11 h-11 rounded-xl flex items-center justify-center text-base font-bold" style={{ background: "rgba(229,111,78,0.13)", color: "var(--brand-orange)" }}>↻</div>
            <div className="flex-1">
              <div className="text-sm font-semibold" style={{ color: "var(--ink)" }}>
                {overdue > 0 ? `有 ${overdue} 道错题已逾期未复习` : `今天还有 ${dueToday} 道错题待复习`}
              </div>
              <div className="text-xs" style={{ color: "var(--steel)" }}>及时复习可以更有效地巩固记忆。</div>
            </div>
            <Link href="/review" className="px-4 py-2 text-xs font-medium rounded-lg text-white" style={{ background: "var(--brand-orange)" }}>
              去复习
            </Link>
          </div>
        )}

        <div className="mobile-secondary-stats grid grid-cols-3 gap-4 mb-6">
          <Card title="今日正确" value={user.todayCorrect} bg="var(--tint-mint)" color="var(--brand-green)" />
          <Card title="今日错题" value={user.todayDone - user.todayCorrect} bg="var(--tint-peach)" color="var(--brand-orange)" />
          <Card title="今日正确率" value={user.todayDone > 0 ? `${todayAccuracy}%` : "-"} bg="var(--tint-sky)" color="var(--link-blue)" />
        </div>

        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="soft-card p-5">
            <h3 className="text-sm font-semibold mb-4" style={{ color: "var(--ink)" }}>知识点掌握度</h3>
            {Object.entries(user.knowledgeProfile).map(([name, kp]) => {
              const rate = kp.total > 0 ? Math.round((kp.correct / kp.total) * 100) : 0;
              const color = rate >= 80 ? "var(--brand-green)" : rate >= 60 ? "var(--brand-orange)" : kp.total === 0 ? "var(--muted)" : "var(--error)";
              return (
                <div key={name} className="flex items-center gap-3 mb-3">
                  <div className="text-xs font-medium w-28 text-right" style={{ color: "var(--charcoal)" }}>{name}</div>
                  <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: "var(--hairline-soft)" }}>
                    <div className="h-full rounded-full" style={{ width: `${rate}%`, background: color }} />
                  </div>
                  <div className="text-xs font-semibold w-12 text-right" style={{ color: "var(--steel)" }}>
                    {kp.total === 0 ? "未做" : `${rate}%`}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="soft-card p-5">
            <h3 className="text-sm font-semibold mb-4" style={{ color: "var(--ink)" }}>薄弱知识点</h3>
            {weakPoints.length === 0 ? (
              <div className="text-center py-8">
                <div className="mx-auto mb-3 w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold" style={{ background: "var(--tint-mint)", color: "var(--primary)" }}>✓</div>
                <div className="text-xs" style={{ color: "var(--steel)" }}>开始刷题后，这里会自动显示你的薄弱点。</div>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {weakPoints.map((wp) => (
                  <div key={wp.name} className="rounded-lg px-3.5 py-3" style={{ background: "var(--tint-peach)" }}>
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm font-semibold" style={{ color: "var(--ink)" }}>{wp.name}</div>
                        <div className="text-xs mt-0.5" style={{ color: "var(--steel)" }}>做了 {wp.total} 题，正确 {wp.correct} 题</div>
                      </div>
                      <span className="text-xs font-semibold px-2.5 py-1 rounded-full text-white" style={{ background: wp.rate < 40 ? "var(--error)" : "var(--brand-orange)" }}>
                        {wp.rate}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <Link href="/quiz" className="accent-band block p-5 mb-6 transition-shadow hover:shadow-md">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="eyebrow mb-1">Question Bank</div>
              <div className="text-lg font-bold mb-1" style={{ color: "var(--ink)" }}>真题题库 + 材料题组 + 错因讲解</div>
              <div className="text-sm" style={{ color: "var(--slate)" }}>直接练国考和省考真题；资料分析等材料题会按左材料、右题组的方式呈现。</div>
            </div>
            <div className="primary-button px-4 py-2 rounded-xl text-sm font-semibold shrink-0">进入题库</div>
          </div>
        </Link>

        <div className="mobile-quick-grid grid grid-cols-5 gap-4">
          <QuickLink href="/quiz" icon="✓" title="真题题库" desc="材料题组 + AI 讲解" color="var(--brand-teal)" />
          <QuickLink href="/review" icon="↻" title="复习计划" desc={dueToday > 0 ? `${dueToday} 题待复习` : "暂无待复习"} color="var(--link-blue)" />
          <QuickLink href="/mock" icon="90" title="真题模考" desc="整卷计时训练" color="var(--brand-orange)" />
          <QuickLink href="/toolbox" icon="▣" title="百宝箱" desc="公式速算 + 图推工具" color="var(--brand-navy)" />
          <QuickLink href="/stats" icon="%" title="数据统计" desc="正确率与薄弱点" color="var(--brand-green)" />
        </div>
      </div>
    </div>
  );
}

function getComicImageSrc(result?: ComicResult | null) {
  if (!result) return "";
  if (result.imageUrl) return result.imageUrl;
  if (result.b64Json?.startsWith("data:image/")) return result.b64Json;
  if (/^https?:\/\//i.test(result.b64Json || "")) return result.b64Json || "";
  if (result.b64Json) return `data:${result.mimeType || "image/png"};base64,${result.b64Json}`;
  return "";
}

function getHistoryLabel(fallback: string, label?: string) {
  const value = (label || fallback).trim().replace(/\s+/g, " ");
  return value.length > 42 ? `${value.slice(0, 42)}...` : value;
}

function getTutorHistoryLabel(prompt: string, imageName: string, result?: TutorResult) {
  const text = prompt.trim().replace(/\s+/g, " ");
  if (text) return getHistoryLabel(text);
  if (imageName) return getHistoryLabel(`上传题目：${imageName}`);
  return result?.title || "AI 私教讲解";
}

function getComicHistoryLabel(prompt: string, imageName: string, result?: TutorResult) {
  const base = result?.title || prompt.trim() || (imageName ? `上传题目：${imageName}` : "AI 讲解");
  return getHistoryLabel(`${base} 漫画`);
}

function getAiPreview(value: TutorResult) {
  return getHistoryLabel(
    toDisplayText(value.answerSummary || value.analysis || value.suggestion || value.method) || "点击调用这条历史讲解",
  );
}

function hasUsefulTutorResult(result?: TutorResult | null) {
  if (!result) return false;
  return Boolean(
    toDisplayText(result.analysis || result.answerSummary || result.suggestion || result.method || result.error || result.apiError || result.detail) ||
      toDisplayList(result.keyPoints).length,
  );
}

function formatHistoryTime(time: number) {
  const diff = Date.now() - time;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.max(1, Math.floor(diff / 60_000))}分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}小时前`;
  return new Date(time).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

function HomeTutorPanel() {
  const [prompt, setPrompt] = useState("");
  const [imageDataUrl, setImageDataUrl] = useState("");
  const [imageName, setImageName] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TutorResult | null>(null);
  const [comicLoading, setComicLoading] = useState(false);
  const [comicResult, setComicResult] = useState<ComicResult | null>(null);
  const [aiHistory, setAiHistory] = useState<HistoryEntry<TutorResult>[]>([]);
  const [imageHistory, setImageHistory] = useState<HistoryEntry<ComicResult>[]>([]);

  const loadRecentHistory = async () => {
    const [answers, images] = await Promise.all([
      listHistory<TutorResult>({ kind: "ai", limit: 8 }),
      listHistory<ComicResult>({ kind: "image", limit: 6 }),
    ]);
    setAiHistory(answers);
    setImageHistory(images);
  };

  useEffect(() => {
    loadRecentHistory();
  }, []);

  const handleFile = (file?: File) => {
    if (!file) return;
    setImageName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      setImageDataUrl(dataUrl);
      // 预加载图片以提升显示速度
      if (dataUrl) {
        preloadImage(dataUrl).catch(() => {
          // 预加载失败不影响功能
        });
      }
    };
    reader.readAsDataURL(file);
  };

  const askTutor = async () => {
    if (!prompt.trim() && !imageDataUrl) return;
    setLoading(true);
    setResult(null);
    setComicResult(null);

    try {
      const body = {
        mode: "tutor",
        prompt,
        imageDataUrl,
        images: imageDataUrl ? [imageDataUrl] : [],
        imageName,
      };
      const historyKey = createHistoryKey("ai", {
        scope: "home_tutor",
        config: getAiConfigFingerprint(),
        body: { mode: body.mode, prompt: body.prompt, imageDataUrl: body.imageDataUrl, requestVersion: "ai-card-v2" },
      });
      const cached = await readHistory<TutorResult>(historyKey);
      if (hasUsefulTutorResult(cached)) {
        setResult(withHistoryHit(cached as TutorResult));
        await loadRecentHistory();
        return;
      }

      const data = (await requestAi(body)) as TutorResult;
      setResult(data);
      if (isCacheableAiResult(data)) {
        await writeHistory("ai", historyKey, data, getTutorHistoryLabel(prompt, imageName, data));
        await loadRecentHistory();
      }
    } catch (err) {
      setResult({
        source: "local_fallback",
        title: "讲解失败",
        analysis: `AI 讲解调用失败：${err instanceof Error ? err.message : String(err)}`,
        keyPoints: [],
      });
    } finally {
      setLoading(false);
    }
  };

  const generateComic = async () => {
    if (!result) return;
    const imageCfg = readSavedImageConfig();

    if (!imageCfg.apiKey || !imageCfg.baseUrl) {
      setComicResult({
        error: "生图接口未配置",
        detail: "请先到设置页填写漫画生图接口，或点击“沿用文字接口”。",
      });
      return;
    }

    setComicLoading(true);
    setComicResult(null);
    try {
      const content = [
        prompt ? `用户问题：${prompt}` : "",
        imageName ? `题目图片：${imageName}。漫画必须依据AI已识别出的题目内容生成，不得另编题目。` : "",
        result.title ? `讲解标题：${toDisplayText(result.title)}` : "",
        result.analysis ? `讲解内容：${toDisplayText(result.analysis)}` : "",
        result.method ? `方法步骤：${toDisplayText(result.method)}` : "",
        result.keyPoints?.length ? `核心要点：${toDisplayList(result.keyPoints).join("、")}` : "",
        result.answerSummary ? `答案总结：${toDisplayText(result.answerSummary)}` : "",
      ].filter(Boolean).join("\n\n");
      const body = { content };
      const historyKey = createHistoryKey("image", {
        scope: "home_tutor_comic",
        config: getImageConfigFingerprint(),
        body,
      });
      const cached = await readHistory<ComicResult>(historyKey);
      if (cached) {
        setComicResult(withHistoryHit(cached));
        await loadRecentHistory();
        return;
      }

      const data = await requestImage<ComicResult>(body);
      setComicResult(data);
      if (isCacheableImageResult(data)) {
        await writeHistory("image", historyKey, data, getComicHistoryLabel(prompt, imageName, result));
        await loadRecentHistory();
      }
    } catch (err) {
      setComicResult({
        error: "生图请求失败",
        detail: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setComicLoading(false);
    }
  };

  const useAiHistory = async (entry: HistoryEntry<TutorResult>) => {
    const value = await readHistory<TutorResult>(entry.key);
    setResult(withHistoryHit(value || entry.value));
    setComicResult(null);
    await loadRecentHistory();
  };

  const useImageHistory = async (entry: HistoryEntry<ComicResult>) => {
    const value = await readHistory<ComicResult>(entry.key);
    setComicResult(withHistoryHit(value || entry.value));
    await loadRecentHistory();
  };

  const removeHistoryEntry = async (entry: HistoryEntry) => {
    await deleteHistory(entry.key);
    await loadRecentHistory();
  };

  const comicSrc = getComicImageSrc(comicResult);
  const resultAnalysis = toDisplayText(result?.analysis);
  const resultKeyPoints = toDisplayList(result?.keyPoints);
  const resultMethod = toDisplayText(result?.method);
  const resultMnemonic = toDisplayText(result?.mnemonic);
  const resultExample = toDisplayText(result?.example);
  const resultSuggestion = toDisplayText(result?.suggestion);
  const resultSummary = toDisplayText(result?.answerSummary);
  const resultError = toDisplayText(result?.error || result?.apiError || result?.detail);

  const copyResult = async () => {
    if (!result) return;
    const text = [
      toDisplayText(result.title) || "AI 知识讲解",
      resultAnalysis,
      resultKeyPoints.length ? `要点归纳：\n${resultKeyPoints.map((item) => `- ${item}`).join("\n")}` : "",
      resultMethod ? `方法：${resultMethod}` : "",
      resultMnemonic ? `记忆口诀：${resultMnemonic}` : "",
      resultExample ? `经典例题：${resultExample}` : "",
      resultSummary ? `总结：${resultSummary}` : "",
    ].filter(Boolean).join("\n\n");
    await navigator.clipboard?.writeText(text);
  };

  return (
    <section className="ai-tutor-panel rounded-[18px] p-5 mb-6">
      <div className="grid grid-cols-[minmax(0,1fr)_320px] gap-5">
        <div>
          <div className="flex items-center justify-between gap-3 mb-3">
            <div>
              <div className="eyebrow mb-1">AI Tutor</div>
              <h3 className="text-base font-bold" style={{ color: "var(--ink)" }}>AI 私教讲解</h3>
              <p className="text-xs mt-1" style={{ color: "var(--steel)" }}>支持文字提问、上传题目图片、生成漫画分镜。</p>
            </div>
            <Link href="/settings" className="ghost-button px-3 py-1.5 text-xs font-medium rounded-lg">
              接口设置
            </Link>
          </div>

          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="输入一道题、一个知识点，或问：这道资料分析怎么秒算？"
            className="quiet-input w-full min-h-[112px] rounded-xl px-3.5 py-3 text-sm outline-none"
          />

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label className="ghost-button inline-flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-lg cursor-pointer">
              上传图片
              <input type="file" accept="image/*" className="hidden" onChange={(event) => handleFile(event.target.files?.[0])} />
            </label>
            {imageName && (
              <button
                onClick={() => { setImageDataUrl(""); setImageName(""); }}
                className="px-3 py-2 text-xs rounded-md"
                style={{ background: "var(--surface)", color: "var(--steel)" }}
              >
                {imageName} · 移除
              </button>
            )}
            <button
              onClick={askTutor}
              disabled={loading || (!prompt.trim() && !imageDataUrl)}
              className="primary-button ml-auto px-4 py-2 text-sm font-medium rounded-lg disabled:opacity-50"
            >
              {loading ? "生成中..." : "生成讲解"}
            </button>
          </div>
        </div>

        <div className="rounded-2xl overflow-hidden" style={{ background: "var(--surface)", border: "1px solid var(--hairline)" }}>
          {imageDataUrl ? (
            <img src={imageDataUrl} alt="上传题目预览" className="w-full h-full min-h-[180px] max-h-[260px] object-contain bg-white" />
          ) : (
            <div className="h-full min-h-[180px] flex items-center justify-center text-center px-6 text-xs" style={{ color: "var(--steel)" }}>
              上传题目截图后，AI 会结合图片内容进行讲解。
            </div>
          )}
        </div>
      </div>

      {result && (
        <div className="mt-4 rounded-2xl p-4" style={{ background: "var(--canvas)", border: "1px solid var(--hairline)" }}>
          <div className="flex items-center gap-3 mb-2">
            <div className="text-sm font-semibold" style={{ color: "var(--ink)" }}>{result.title || "AI 知识讲解"}</div>
            {result.historyHit && (
              <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold" style={{ background: "var(--tint-mint)", color: "var(--primary)" }}>历史记录</span>
            )}
            <button
              onClick={copyResult}
              className="ghost-button ml-auto px-3 py-1.5 text-xs font-medium rounded-lg"
              style={{ color: "var(--slate)" }}
            >
              复制
            </button>
            <button
              onClick={generateComic}
              disabled={comicLoading}
              className="ghost-button px-3 py-1.5 text-xs font-medium rounded-lg disabled:opacity-50"
              style={{ color: "var(--primary)" }}
            >
              {comicLoading ? "漫画生成中..." : "生成讲解漫画"}
            </button>
          </div>
          {resultAnalysis && <div className="text-sm leading-7 mb-4 whitespace-pre-wrap" style={{ color: "var(--charcoal)" }}>{resultAnalysis}</div>}
          {resultKeyPoints.length > 0 && (
            <div className="mb-4">
              <div className="text-sm font-bold mb-2" style={{ color: "var(--ink)" }}>要点归纳</div>
              <ul className="space-y-2">
                {resultKeyPoints.map((point) => (
                  <li key={point} className="flex gap-2 text-sm leading-relaxed" style={{ color: "var(--charcoal)" }}>
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: "var(--primary)" }} />
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {(resultMnemonic || resultExample) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
              {resultMnemonic && (
                <div className="rounded-lg p-3" style={{ background: "var(--surface)", border: "1px solid var(--hairline)" }}>
                  <div className="text-sm font-bold mb-2" style={{ color: "var(--primary)" }}>记忆口诀</div>
                  <div className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: "var(--charcoal)" }}>{resultMnemonic}</div>
                </div>
              )}
              {resultExample && (
                <div className="rounded-lg p-3" style={{ background: "var(--surface)", border: "1px solid var(--hairline)" }}>
                  <div className="text-sm font-bold mb-2" style={{ color: "var(--primary)" }}>经典例题</div>
                  <div className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: "var(--charcoal)" }}>{resultExample}</div>
                </div>
              )}
            </div>
          )}
          {resultMethod && <div className="text-xs leading-relaxed mb-2" style={{ color: "var(--slate)" }}>方法：{resultMethod}</div>}
          {resultSuggestion && <div className="text-xs leading-relaxed mb-2" style={{ color: "var(--steel)" }}>建议：{resultSuggestion}</div>}
          {resultSummary && <div className="text-xs leading-relaxed" style={{ color: "var(--brand-green)" }}>总结：{resultSummary}</div>}
          {resultError && <div className="text-xs mt-2" style={{ color: "var(--error)" }}>{resultError}</div>}
        </div>
      )}

      {comicResult?.error && (
        <div className="mt-3 rounded-lg p-3 text-sm" style={{ background: "var(--tint-peach)", color: "var(--brand-orange)" }}>
          {comicResult.error}{comicResult.detail ? `：${comicResult.detail}` : ""}
        </div>
      )}
      {comicSrc && (
        <div className="mt-3 rounded-lg p-3" style={{ background: "var(--surface)", border: "1px solid var(--hairline)" }}>
          {comicResult?.historyHit && <div className="text-xs font-semibold mb-2" style={{ color: "var(--primary)" }}>已调用历史图片</div>}
          <img src={comicSrc} alt="AI 讲解漫画" className="w-full max-h-[720px] object-contain rounded-md" />
        </div>
      )}

      <HistoryPanel
        aiHistory={aiHistory}
        imageHistory={imageHistory}
        onUseAi={useAiHistory}
        onUseImage={useImageHistory}
        onDelete={removeHistoryEntry}
      />
    </section>
  );
}

function HistoryPanel({
  aiHistory,
  imageHistory,
  onUseAi,
  onUseImage,
  onDelete,
}: {
  aiHistory: HistoryEntry<TutorResult>[];
  imageHistory: HistoryEntry<ComicResult>[];
  onUseAi: (entry: HistoryEntry<TutorResult>) => void;
  onUseImage: (entry: HistoryEntry<ComicResult>) => void;
  onDelete: (entry: HistoryEntry) => void;
}) {
  return (
    <div className="mt-5 pt-4" style={{ borderTop: "1px solid var(--hairline)" }}>
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <div className="text-sm font-semibold" style={{ color: "var(--ink)" }}>历史记录</div>
          <div className="text-xs mt-0.5" style={{ color: "var(--steel)" }}>已生成的答案和图片可直接调用，记录过多会自动收缩。</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-xl p-3" style={{ background: "rgba(253,255,251,0.78)", border: "1px solid var(--hairline)" }}>
          <div className="text-xs font-semibold mb-2" style={{ color: "var(--slate)" }}>最近答案</div>
          {aiHistory.length === 0 ? (
            <div className="text-xs py-4 text-center" style={{ color: "var(--steel)" }}>暂无答案历史</div>
          ) : (
            <div className="flex flex-col gap-2">
              {aiHistory.map((entry) => (
                <div key={entry.key} className="rounded-lg p-3" style={{ background: "var(--canvas)", border: "1px solid var(--hairline-soft)" }}>
                  <div className="flex items-start gap-2">
                    <button onClick={() => onUseAi(entry)} className="flex-1 text-left">
                      <div className="text-xs font-semibold mb-1" style={{ color: "var(--ink)" }}>{getHistoryLabel("AI 讲解", entry.label)}</div>
                      <div className="text-xs leading-relaxed line-clamp-2" style={{ color: "var(--steel)" }}>{getAiPreview(entry.value)}</div>
                    </button>
                    <button
                      onClick={() => onDelete(entry)}
                      className="px-2 py-1 text-[11px] rounded-md"
                      style={{ background: "var(--surface)", color: "var(--steel)" }}
                    >
                      删除
                    </button>
                  </div>
                  <div className="text-[11px] mt-2" style={{ color: "var(--muted)" }}>
                    {formatHistoryTime(entry.lastUsedAt || entry.createdAt)} · 调用 {entry.hits || 0} 次
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl p-3" style={{ background: "rgba(253,255,251,0.78)", border: "1px solid var(--hairline)" }}>
          <div className="text-xs font-semibold mb-2" style={{ color: "var(--slate)" }}>最近图片</div>
          {imageHistory.length === 0 ? (
            <div className="text-xs py-4 text-center" style={{ color: "var(--steel)" }}>暂无图片历史</div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {imageHistory.map((entry) => {
                const src = getComicImageSrc(entry.value);
                return (
                  <div key={entry.key} className="rounded-lg p-2" style={{ background: "var(--canvas)", border: "1px solid var(--hairline-soft)" }}>
                    <button onClick={() => onUseImage(entry)} className="w-full text-left">
                      <div className="aspect-[4/3] rounded-md overflow-hidden flex items-center justify-center" style={{ background: "var(--surface)" }}>
                        {src ? (
                          <img src={src} alt={entry.label || "历史图片"} className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-xs" style={{ color: "var(--steel)" }}>图片</span>
                        )}
                      </div>
                      <div className="text-xs font-semibold mt-2 truncate" style={{ color: "var(--ink)" }}>{getHistoryLabel("AI 图片", entry.label)}</div>
                    </button>
                    <div className="flex items-center justify-between gap-2 mt-1">
                      <span className="text-[11px]" style={{ color: "var(--muted)" }}>{formatHistoryTime(entry.lastUsedAt || entry.createdAt)}</span>
                      <button
                        onClick={() => onDelete(entry)}
                        className="px-2 py-1 text-[11px] rounded-md"
                        style={{ background: "var(--surface)", color: "var(--steel)" }}
                      >
                        删除
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div className="rounded-2xl px-4 py-3" style={{ background: "rgba(253,255,251,0.66)", border: "1px solid rgba(217,230,220,0.74)" }}>
      <div className="text-2xl font-bold" style={{ color }}>{value}</div>
      <div className="text-xs" style={{ color: "var(--steel)" }}>{label}</div>
    </div>
  );
}

function Card({ title, value, bg, color }: { title: string; value: string | number; bg: string; color: string }) {
  return (
    <div className="soft-card p-5" style={{ background: bg }}>
      <div className="w-8 h-8 rounded-full mb-4" style={{ background: color, opacity: 0.9 }} />
      <div className="text-xl font-bold" style={{ color }}>{value}</div>
      <div className="text-xs" style={{ color: "var(--steel)" }}>{title}</div>
    </div>
  );
}

function QuickLink({ href, icon, title, desc, color }: { href: string; icon: string; title: string; desc: string; color: string }) {
  return (
    <Link href={href} className="soft-card p-6 text-center hover:shadow-md">
      <div className="mx-auto mb-3 w-10 h-10 rounded-xl flex items-center justify-center text-base font-bold" style={{ background: color, color: "white" }}>{icon}</div>
      <div className="text-sm font-semibold" style={{ color: "var(--ink)" }}>{title}</div>
      <div className="text-xs mt-1" style={{ color: "var(--steel)" }}>{desc}</div>
    </Link>
  );
}
