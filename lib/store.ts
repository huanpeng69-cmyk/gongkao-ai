"use client";

import { ErrorEntry, ErrorType, Question, UserProfile, DailyRecord, StudySession, AppData, ReviewRating } from "./types";
import { getCurrentDisplayName, isAuthenticated } from "./auth";

function getStorageKey() {
  const user = typeof window !== "undefined" ? localStorage.getItem("gongkao-current-user") : null;
  return `gongkao-data-${user || "default"}`;
}

function getUserName() {
  if (typeof window === "undefined") return "学员";
  return getCurrentDisplayName();
}

function getToday(): string {
  return new Date().toISOString().split("T")[0];
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
        "言语理解": { correct: 0, total: 0, level: "中等" },
        "判断推理": { correct: 0, total: 0, level: "中等" },
        "资料分析": { correct: 0, total: 0, level: "中等" },
        "数量关系": { correct: 0, total: 0, level: "中等" },
        "常识判断": { correct: 0, total: 0, level: "中等" },
        "公共基础知识": { correct: 0, total: 0, level: "中等" },
      },
    },
    errors: [],
    answeredIds: [],
    dailyHistory: [],
    studySessions: [],
  };
}

export function loadData(): AppData {
  if (typeof window === "undefined") return getDefaultData();
  try {
    const key = getStorageKey();
    const raw = localStorage.getItem(key);
    if (!raw) return getDefaultData();
    const data = JSON.parse(raw) as AppData;
    data.user.name = getUserName();
    // Ensure new fields exist for old data
    if (!data.dailyHistory) data.dailyHistory = [];
    if (!data.studySessions) data.studySessions = [];
    return data;
  } catch {
    return getDefaultData();
  }
}

export function saveData(data: AppData) {
  if (typeof window === "undefined") return;
  const key = getStorageKey();
  localStorage.setItem(key, JSON.stringify(data));
}

// ==================== 答题记录 ====================

export function recordAnswer(question: Question, userAnswer: string | string[] | boolean, isCorrect: boolean, moduleKey?: string) {
  const data = loadData();
  const today = getToday();

  data.user.totalQuestions += 1;
  data.user.todayDone += 1;
  if (isCorrect) {
    data.user.totalCorrect += 1;
    data.user.todayCorrect += 1;
  }

  // Update knowledge profile
  const kp = data.user.knowledgeProfile[question.module];
  if (kp) {
    kp.total += 1;
    if (isCorrect) kp.correct += 1;
    const rate = kp.total > 0 ? kp.correct / kp.total : 0;
    kp.level = rate >= 0.8 ? "优秀" : rate >= 0.6 ? "中等" : rate >= 0.4 ? "薄弱" : "严重薄弱";
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

  if (!data.answeredIds.includes(question.id)) {
    data.answeredIds.push(question.id);
  }

  // Update daily history
  updateDailyHistory(data, today, question.module, isCorrect, moduleKey);

  // Update streak
  updateStreak(data);

  saveData(data);
  return data;
}

function updateDailyHistory(data: AppData, today: string, moduleName: string, isCorrect: boolean, moduleKey?: string) {
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

  record.totalDone += 1;
  if (isCorrect) record.totalCorrect += 1;

  const mk = moduleKey || moduleName;
  if (!record.moduleBreakdown[mk]) {
    record.moduleBreakdown[mk] = { done: 0, correct: 0 };
  }
  record.moduleBreakdown[mk].done += 1;
  if (isCorrect) record.moduleBreakdown[mk].correct += 1;
}

function updateStreak(data: AppData) {
  const today = getToday();
  const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];

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
  const data = loadData();
  const today = getToday();
  const err = data.errors.find((e) => e.questionId === questionId);
  if (!err) return data;

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
      err.nextReviewDate = nextDate.toISOString().split("T")[0];
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

  saveData(data);
  return data;
}

// ==================== 学习时段 ====================

export function startStudySession(mode: 'quiz' | 'review' | 'knowledge' = 'quiz') {
  const data = loadData();
  const now = new Date();
  data.studySessions.push({
    date: getToday(),
    startTime: now.toISOString(),
    questionsDone: 0,
    mode,
  });
  saveData(data);
}

export function endStudySession() {
  const data = loadData();
  const session = data.studySessions[data.studySessions.length - 1];
  if (session && !session.endTime) {
    session.endTime = new Date().toISOString();
  }
  saveData(data);
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
    const dateStr = d.toISOString().split("T")[0];
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
    reviewQueue: dueToday.slice(0, 20), // 最多返回20条待复习
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
    const dateStr = d.toISOString().split("T")[0];
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
  const data = loadData();
  const today = getToday();
  // Check if there's already a record for today
  const todayRecord = data.dailyHistory.find((r) => r.date === today);
  if (!todayRecord) {
    // New day - reset today counters and check streak
    const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
    const yesterdayRecord = data.dailyHistory.find((r) => r.date === yesterday);
    if (!yesterdayRecord || yesterdayRecord.totalDone === 0) {
      data.user.streak = 0;
    }
    data.user.todayDone = 0;
    data.user.todayCorrect = 0;
    saveData(data);
  }
}
