"use client";

import { ErrorEntry, ErrorType, Question, UserProfile, DailyRecord, StudySession, AppData, ReviewRating } from "./types";
import { getCurrentDisplayName, isAuthenticated } from "./auth";

let dataCache: AppData | null = null;
let dataCacheUser = "";
let saveQueue = Promise.resolve();

// ==================== 多设备同步（阶段 2a） ====================
// 每次修改都记成一个「操作」（op），保存时带上服务端版本号（If-Match）。
// 若其它设备已先保存（服务端返回 409），就以服务端最新数据为底，把本机尚未确认的操作按顺序重放一遍再保存，
// 两台设备的进度都保留，不再「后保存的整包覆盖先保存的」。见 docs/decisions/2026-11-23-database-migration.md。
type DataOp = (data: AppData) => unknown; // 返回 false 表示本次没有改动，不触发保存
export const DATA_SYNCED_EVENT = "gongkao:data-synced";
const MAX_PENDING_OPS = 500;
const MAX_CONFLICT_RETRIES = 3;
let syncedVersion: number | null = null; // null = 服务端没给版本号（旧服务端/尚未同步），保存时不带 If-Match
let pendingOps: DataOp[] = [];
let lastCommitted: string | null = null; // 最近一次提交后的数据快照，用来识别外部 saveData 改了哪些字段

function getUserName() {
  if (typeof window === "undefined") return "学员";
  return getCurrentDisplayName();
}

export function getLocalDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getToday(): string {
  return getLocalDateKey();
}

function getDefaultData(): AppData {
  return {
    user: {
      name: getUserName(),
      streak: 0,
      totalQuestions: 0,
      totalCorrect: 0,
      dailyGoal: 30,
      todayDone: 0,
      todayCorrect: 0,
      errorBook: [],
      knowledgeProfile: {
        "言语理解与表达": { correct: 0, total: 0, level: "中等" },
        "判断推理": { correct: 0, total: 0, level: "中等" },
        "资料分析": { correct: 0, total: 0, level: "中等" },
        "数量关系": { correct: 0, total: 0, level: "中等" },
        "常识判断": { correct: 0, total: 0, level: "中等" },
        "公共基础知识": { correct: 0, total: 0, level: "中等" },
        "申论": { correct: 0, total: 0, level: "中等" },
      },
    },
    errors: [],
    answeredIds: [],
    dailyHistory: [],
    studySessions: [],
  };
}

export function loadData(): AppData {
  if (dataCache && dataCacheUser === getCurrentDisplayName()) return dataCache;
  return getDefaultData();
}

function cloneJson<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

function normalizeData(data: AppData) {
  data.user.name = getUserName();
  if (!data.dailyHistory) data.dailyHistory = [];
  if (!data.studySessions) data.studySessions = [];
  return data;
}

function enqueueOp(op: DataOp) {
  pendingOps.push(op);
  // 长时间离线只保留最近的操作，防止内存无限增长；被丢弃的操作已体现在本机数据里，只是冲突时无法重放。
  if (pendingOps.length > MAX_PENDING_OPS) pendingOps.splice(0, pendingOps.length - MAX_PENDING_OPS);
}

function persist(data: AppData) {
  data.user.name = getUserName();
  dataCache = data;
  dataCacheUser = getCurrentDisplayName();
  lastCommitted = JSON.stringify(data);
  saveQueue = saveQueue.then(flushPending).catch(() => undefined);
}

/** store 内部统一的修改入口：在当前数据上执行 op，并记入待同步队列。 */
function mutate(op: DataOp): AppData {
  const data = loadData();
  if (op(data) === false) return data;
  if (typeof window === "undefined") return data;
  enqueueOp(op);
  persist(data);
  return data;
}

/** 以服务端数据为底，重放本机尚未确认的操作。 */
function rebase(serverData: AppData | null, version: number | null, notify: boolean) {
  const base = normalizeData(serverData || getDefaultData());
  for (const op of pendingOps) op(base);
  dataCache = base;
  dataCacheUser = getCurrentDisplayName();
  lastCommitted = JSON.stringify(base);
  syncedVersion = version;
  if (notify && typeof window !== "undefined" && typeof window.dispatchEvent === "function" && typeof CustomEvent === "function") {
    window.dispatchEvent(new CustomEvent(DATA_SYNCED_EVENT));
  }
}

async function flushPending() {
  for (let attempt = 0; attempt <= MAX_CONFLICT_RETRIES; attempt += 1) {
    if (!dataCache || pendingOps.length === 0) return;
    const sentOps = pendingOps.length;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (syncedVersion !== null) headers["If-Match"] = String(syncedVersion);
    let response: Response;
    try {
      response = await fetch("/api/data", {
        method: "PUT",
        headers,
        credentials: "include",
        body: JSON.stringify(dataCache),
      });
    } catch {
      // 离线：操作留在队列里，下次修改时一并同步；内存缓存保证当前会话可用。
      return;
    }
    const body = (await response.json().catch(() => null)) as { version?: unknown; data?: AppData | null } | null;
    if (response.ok) {
      if (typeof body?.version === "number") syncedVersion = body.version;
      // 发送期间新增的操作还在队列里，由它们各自排队的保存发出。
      pendingOps.splice(0, sentOps);
      return;
    }
    if (response.status !== 409 || typeof body?.version !== "number") return;
    rebase(body.data ?? null, body.version, true);
  }
}

/**
 * 外部直接整包保存（如百宝箱）。与上次提交的快照比对出改动的顶层字段，记成「覆盖这些字段」的操作，
 * 冲突重放时只覆盖这些字段，不会抹掉其它设备的进度。
 */
export function saveData(data: AppData) {
  if (typeof window === "undefined") return;
  data.user.name = getUserName();
  const before = lastCommitted ? (JSON.parse(lastCommitted) as Record<string, unknown>) : null;
  const current = data as unknown as Record<string, unknown>;
  const keys = Array.from(new Set([...Object.keys(current), ...(before ? Object.keys(before) : [])]));
  const changed = before ? keys.filter((key) => JSON.stringify(current[key]) !== JSON.stringify(before[key])) : keys;
  if (changed.length > 0) {
    const snapshot = cloneJson(current);
    enqueueOp((target) => {
      const record = target as unknown as Record<string, unknown>;
      for (const key of changed) {
        if (snapshot[key] === undefined) delete record[key];
        else record[key] = cloneJson(snapshot[key]);
      }
    });
  }
  persist(data);
}

/** 等待本机所有待保存的修改发送完成。 */
export function waitForSync() {
  return saveQueue;
}

export async function hydrateData() {
  if (typeof window === "undefined" || !isAuthenticated()) return loadData();
  try {
    // 先把本机待保存的修改发出去，避免刚做的题被服务端旧数据盖掉。
    await saveQueue;
    const response = await fetch("/api/data", { credentials: "include", cache: "no-store" });
    if (!response.ok) return loadData();
    const payload = await response.json();
    // 换了账号：上个账号没同步出去的操作不能重放到新账号上。
    if (dataCacheUser !== getCurrentDisplayName()) pendingOps = [];
    rebase((payload.data as AppData | null) || null, typeof payload.version === "number" ? payload.version : null, false);
    if (pendingOps.length > 0) saveQueue = saveQueue.then(flushPending).catch(() => undefined);
    return dataCache || loadData();
  } catch {
    return loadData();
  }
}

// ==================== 答题记录 ====================

export function recordAnswer(
  question: Question,
  userAnswer: string | string[] | boolean,
  isCorrect: boolean,
  moduleKey?: string,
  minutesSpent = 0,
) {
  return mutate((data) => {
    const today = getToday();
    // 首刷口径：重复作答只补记耗时与错题本，不再累加题数/正确数，避免二刷污染正确率。
    const isFirstAttempt = !data.answeredIds.includes(question.id);
    const minutes = Number.isFinite(minutesSpent) && minutesSpent > 0 ? Math.round(minutesSpent * 10) / 10 : 0;

    if (isFirstAttempt) {
      data.user.totalQuestions += 1;
      data.user.todayDone += 1;
      if (isCorrect) {
        data.user.totalCorrect += 1;
        data.user.todayCorrect += 1;
      }

      // Update knowledge profile
      const kp = data.user.knowledgeProfile[question.module] || (data.user.knowledgeProfile[question.module] = { correct: 0, total: 0, level: "中等" });
      if (kp) {
        kp.total += 1;
        if (isCorrect) kp.correct += 1;
        const rate = kp.total > 0 ? kp.correct / kp.total : 0;
        kp.level = rate >= 0.8 ? "优秀" : rate >= 0.6 ? "中等" : rate >= 0.4 ? "薄弱" : "严重薄弱";
      }
    }

    // Add to error book if wrong
    if (!isCorrect) {
      const existing = data.errors.find((e) => e.questionId === question.id);
      if (!existing) {
        const errorType: ErrorType = "思路偏差";
        data.errors.push({
          questionId: question.id,
          question,
          userAnswer,
          errorType,
          errorDate: today,
          loopStatus: "pending",
          loopCount: 0,
          reviewHistory: [{ date: today, correct: false }],
          nextReviewDate: today, // 首次错题当天就要复习
          easeFactor: 2.5,
          interval: 0,
        });
      }
    }

    if (isFirstAttempt) {
      data.answeredIds.push(question.id);
    }

    // Update daily history
    updateDailyHistory(data, today, question.module, isCorrect, moduleKey, isFirstAttempt, minutes);

    // Update streak
    updateStreak(data);

    return data;
  });
}

function ensureDailyRecord(data: AppData, today: string): DailyRecord {
  let record = data.dailyHistory.find((r) => r.date === today);
  if (!record) {
    record = {
      date: today,
      totalDone: 0,
      totalCorrect: 0,
      moduleBreakdown: {},
      errorTypes: {},
      timeSpentMinutes: 0,
      reviewDone: 0,
      reviewCorrect: 0,
    };
    data.dailyHistory.push(record);
  }
  return record;
}

function updateDailyHistory(
  data: AppData,
  today: string,
  moduleName: string,
  isCorrect: boolean,
  moduleKey: string | undefined,
  isFirstAttempt: boolean,
  minutesSpent: number,
) {
  const record = ensureDailyRecord(data, today);

  // 耗时每次都记（二刷也要计时），题数/正确数只在首刷累加。
  if (minutesSpent > 0) {
    record.timeSpentMinutes = Math.round((record.timeSpentMinutes + minutesSpent) * 10) / 10;
  }
  if (!isFirstAttempt) return;

  record.totalDone += 1;
  if (isCorrect) record.totalCorrect += 1;

  const mk = moduleKey || moduleName;
  if (!record.moduleBreakdown[mk]) {
    record.moduleBreakdown[mk] = { done: 0, correct: 0 };
  }
  record.moduleBreakdown[mk].done += 1;
  if (isCorrect) record.moduleBreakdown[mk].correct += 1;
}

/** 批量累加当天学习时长（整卷模考交卷时一次性记入）。 */
export function addStudyMinutes(minutes: number) {
  return mutate((data) => {
    if (!Number.isFinite(minutes) || minutes <= 0) return false;
    const record = ensureDailyRecord(data, getToday());
    record.timeSpentMinutes = Math.round((record.timeSpentMinutes + minutes) * 10) / 10;
    return data;
  });
}

function updateStreak(data: AppData) {
  const today = getToday();
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = getLocalDateKey(yesterdayDate);

  const todayRecord = data.dailyHistory.find((r) => r.date === today);
  if (todayRecord && todayRecord.totalDone === 1) {
    // First question today
    const yesterdayRecord = data.dailyHistory.find((r) => r.date === yesterday);
    if (yesterdayRecord && yesterdayRecord.totalDone > 0) {
      data.user.streak += 1;
    } else if (!yesterdayRecord || yesterdayRecord.totalDone === 0) {
      data.user.streak = 1;
    }
  }
}

// ==================== 复习记录 ====================

export function recordReview(questionId: string, result: boolean | ReviewRating) {
  return mutate((data) => {
    const today = getToday();
    const err = data.errors.find((e) => e.questionId === questionId);
    if (!err) return false;

    const rating: ReviewRating = typeof result === "boolean" ? (result ? "good" : "again") : result;
    const isCorrect = rating !== "again";

    err.reviewHistory.push({ date: today, correct: isCorrect, rating });

    if (rating === "again") {
      err.loopCount = 0;
      err.loopStatus = "pending";
      err.nextReviewDate = today; // 答错后立即回到今日队列
      err.easeFactor = Math.max(1.3, (err.easeFactor || 2.5) - 0.2);
      err.interval = 0;
    } else {
      err.loopCount += 1;
      if (err.loopCount >= 3) {
        err.loopStatus = "mastered";
        err.nextReviewDate = undefined;
      } else {
        err.loopStatus = "reviewing";
        const ef = err.easeFactor || 2.5;
        const interval = err.interval || 0;
        let newInterval: number;

        if (rating === "hard") {
          newInterval = 1;
          err.easeFactor = Math.max(1.3, ef - 0.15);
        } else if (rating === "easy") {
          if (err.loopCount === 1) {
            newInterval = 3;
          } else if (err.loopCount === 2) {
            newInterval = 7;
          } else {
            newInterval = Math.round(interval * ef * 1.5);
          }
          err.easeFactor = Math.min(3.0, ef + 0.15);
        } else {
          if (err.loopCount === 1) {
            newInterval = 1;
          } else if (err.loopCount === 2) {
            newInterval = 3;
          } else {
            newInterval = Math.round(interval * ef);
          }
          err.easeFactor = Math.max(1.3, ef + (0.1 - (5 - 3) * (0.08 + (5 - 3) * 0.02)));
        }

        err.interval = newInterval;
        const nextDate = new Date();
        nextDate.setDate(nextDate.getDate() + newInterval);
        err.nextReviewDate = getLocalDateKey(nextDate);
      }
    }

    // Update daily review stats
    let record = data.dailyHistory.find((r) => r.date === today);
    if (!record) {
      record = {
        date: today,
        totalDone: 0,
        totalCorrect: 0,
        moduleBreakdown: {},
        errorTypes: {},
        timeSpentMinutes: 0,
        reviewDone: 0,
        reviewCorrect: 0,
      };
      data.dailyHistory.push(record);
    }
    record.reviewDone += 1;
    if (isCorrect) record.reviewCorrect += 1;

    return data;
  });
}

// ==================== 学习时段 ====================

export function startStudySession(mode: 'quiz' | 'review' | 'knowledge' = 'quiz') {
  return mutate((data) => {
    const now = new Date();
    data.studySessions.push({
      date: getToday(),
      startTime: now.toISOString(),
      questionsDone: 0,
      mode,
    });
  });
}

export function endStudySession() {
  return mutate((data) => {
    const session = data.studySessions[data.studySessions.length - 1];
    if (session && !session.endTime) {
      session.endTime = new Date().toISOString();
    }
  });
}

// ==================== 复习计划 ====================

export function getReviewPlan() {
  const data = loadData();
  const today = getToday();

  const pending = data.errors.filter((e) => e.loopStatus === "pending");
  const dueToday = data.errors.filter((e) => e.nextReviewDate && e.nextReviewDate <= today && e.loopStatus !== "mastered");
  const overdue = dueToday.filter((e) => e.nextReviewDate && e.nextReviewDate < today);

  // 未来7天的复习计划
  const upcoming: { date: string; count: number }[] = [];
  for (let i = 1; i <= 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    const dateStr = getLocalDateKey(d);
    const count = data.errors.filter((e) => e.nextReviewDate === dateStr && e.loopStatus !== "mastered").length;
    upcoming.push({ date: dateStr, count });
  }

  return {
    total: data.errors.length,
    pending: pending.length,
    dueToday: dueToday.length,
    overdue: overdue.length,
    mastered: data.errors.filter((e) => e.loopStatus === "mastered").length,
    reviewing: data.errors.filter((e) => e.loopStatus === "reviewing").length,
    upcoming,
    reviewQueue: dueToday, // 全部到期错题（此前截断到 20 条会让逾期堆积后永远看不到后面的题）
  };
}

// ==================== 统计查询 ====================

export function getErrorStats() {
  const data = loadData();
  const total = data.errors.length;
  const pending = data.errors.filter((e) => e.loopStatus === "pending").length;
  const reviewing = data.errors.filter((e) => e.loopStatus === "reviewing").length;
  const mastered = data.errors.filter((e) => e.loopStatus === "mastered").length;
  return { total, pending, reviewing, mastered };
}

export function getWeeklyStats() {
  const data = loadData();
  const stats: { date: string; done: number; correct: number; accuracy: number }[] = [];

  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = getLocalDateKey(d);
    const record = data.dailyHistory.find((r) => r.date === dateStr);
    stats.push({
      date: dateStr,
      done: record?.totalDone || 0,
      correct: record?.totalCorrect || 0,
      accuracy: record && record.totalDone > 0 ? Math.round((record.totalCorrect / record.totalDone) * 100) : 0,
    });
  }

  return stats;
}

export function getErrorTypeDistribution() {
  const data = loadData();
  const dist: Record<string, number> = {};
  data.errors.forEach((e) => {
    dist[e.errorType] = (dist[e.errorType] || 0) + 1;
  });
  return Object.entries(dist)
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);
}

export function getModuleAccuracy() {
  const data = loadData();
  return Object.entries(data.user.knowledgeProfile).map(([name, kp]) => ({
    name,
    total: kp.total,
    correct: kp.correct,
    rate: kp.total > 0 ? Math.round((kp.correct / kp.total) * 100) : 0,
    level: kp.level,
  }));
}

export function isLoggedIn(): boolean {
  if (typeof window === "undefined") return false;
  return isAuthenticated();
}

/** 重置今日数据（每天首次访问时调用） */
export function resetTodayIfNeeded() {
  return mutate((data) => {
    const today = getToday();
    // Check if there's already a record for today
    const todayRecord = data.dailyHistory.find((r) => r.date === today);
    if (!todayRecord) {
      // New day - reset today counters and check streak
      const yesterdayDate = new Date();
      yesterdayDate.setDate(yesterdayDate.getDate() - 1);
      const yesterday = getLocalDateKey(yesterdayDate);
      const yesterdayRecord = data.dailyHistory.find((r) => r.date === yesterday);
      if (!yesterdayRecord || yesterdayRecord.totalDone === 0) {
        data.user.streak = 0;
      }
      data.user.todayDone = 0;
      data.user.todayCorrect = 0;
    }
    return todayRecord ? false : undefined;
  });
}
// ==================== 错因回填 ====================

// 把 AI 错因分析识别出的错因写回错题本，让错题本/统计页的「错因分布」真实可信。
// 仅在题目确实答错（错题本里存在该错题）时写入，且只接受预定义的 6 类错因，避免被垃圾值污染。
export const KNOWN_ERROR_TYPES: ErrorType[] = [
  "知识盲区", "概念混淆", "审题失误", "计算/推理错误", "思路偏差", "时间压力",
];

export function updateErrorType(questionId: string, errorType: string) {
  if (!KNOWN_ERROR_TYPES.includes(errorType as ErrorType)) return;
  return mutate((data) => {
    const err = data.errors.find((e) => e.questionId === questionId);
    if (!err) return false; // 只有真实答错的题才回填
    err.errorType = errorType as ErrorType;
    return data;
  });
}
