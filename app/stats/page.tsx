"use client";

import { useState, useEffect } from "react";
import { loadData, getWeeklyStats, getErrorTypeDistribution, getModuleAccuracy, getErrorStats } from "@/lib/store";

export default function StatsPage() {
  const [data, setData] = useState<ReturnType<typeof loadData> | null>(null);
  const [weeklyStats, setWeeklyStats] = useState<ReturnType<typeof getWeeklyStats>>([]);
  const [errorDist, setErrorDist] = useState<ReturnType<typeof getErrorTypeDistribution>>([]);
  const [moduleAcc, setModuleAcc] = useState<ReturnType<typeof getModuleAccuracy>>([]);

  useEffect(() => {
    const d = loadData();
    setData(d);
    setWeeklyStats(getWeeklyStats());
    setErrorDist(getErrorTypeDistribution());
    setModuleAcc(getModuleAccuracy());
  }, []);

  if (!data) return <div className="p-8 text-sm" style={{ color: "var(--steel)" }}>加载中...</div>;

  const accuracy = data.user.totalQuestions > 0 ? Math.round((data.user.totalCorrect / data.user.totalQuestions) * 100) : 0;
  const loopStats = getErrorStats();
  const totalErrors = loopStats.total;
  const loopRate = totalErrors > 0 ? Math.round((loopStats.mastered / totalErrors) * 100) : 0;
  const maxDone = Math.max(...weeklyStats.map((d) => d.done), 1);

  // 今日学习时长估算
  const todaySessions = data.studySessions.filter((s) => s.date === new Date().toISOString().split("T")[0]);
  const totalMinutes = todaySessions.reduce((sum, s) => {
    if (!s.endTime) return sum;
    return sum + (new Date(s.endTime).getTime() - new Date(s.startTime).getTime()) / 60000;
  }, 0);

  // 常见错因颜色
  const errorColors: Record<string, { color: string; bg: string }> = {
    "知识盲区": { color: "var(--link-blue)", bg: "var(--tint-sky)" },
    "概念混淆": { color: "var(--brand-orange)", bg: "var(--tint-peach)" },
    "思路偏差": { color: "var(--link-blue)", bg: "var(--tint-lavender)" },
    "审题失误": { color: "var(--steel)", bg: "var(--tint-yellow)" },
    "计算/推理错误": { color: "var(--brand-green)", bg: "var(--tint-mint)" },
    "时间压力": { color: "var(--brand-teal)", bg: "var(--tint-rose)" },
  };

  const pieTotal = errorDist.reduce((s, e) => s + e.count, 0) || 1;
  const pieSegments = errorDist.map((ed, i) => {
    const prevPct = errorDist.slice(0, i).reduce((s, e) => s + (e.count / pieTotal) * 100, 0);
    const pct = (ed.count / pieTotal) * 100;
    const c = errorColors[ed.type]?.color || "var(--muted)";
    return `${c} ${prevPct}% ${prevPct + pct}%`;
  });

  return (
    <div className="animate-in study-page stats-page">
      <div className="topbar sticky top-0 z-40 flex items-center px-8 h-14">
        <span className="text-sm font-bold" style={{ color: "var(--ink)" }}>数据统计</span>
        <span className="text-xs ml-2" style={{ color: "var(--steel)" }}>用数据驱动你的备考策略</span>
      </div>

      <div className="p-8 max-w-[1100px]">
        {/* Summary Cards */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          <SummaryCard label="总刷题量" value={String(data.user.totalQuestions)} icon="Σ" bg="var(--tint-sky)" />
          <SummaryCard label="综合正确率" value={accuracy > 0 ? `${accuracy}%` : "-"} icon="%" bg="var(--tint-mint)" />
          <SummaryCard label="连续学习" value={`${data.user.streak}天`} icon="D" bg="var(--tint-peach)" />
          <SummaryCard label="错题闭环" value={`${loopRate}%`} icon="↻" bg="var(--tint-lavender)" />
        </div>

        {/* Top Row: Weekly Chart + Summary */}
        <div className="grid grid-cols-[2fr_1fr] gap-4 mb-6">
          {/* Bar Chart - Real Data */}
          <div className="rounded-xl p-5" style={{ background: "var(--canvas)", border: "1px solid var(--hairline)" }}>
            <h3 className="text-sm font-semibold mb-4" style={{ color: "var(--ink)" }}>近7天刷题量</h3>
            <div className="flex items-end gap-2" style={{ height: 180 }}>
              {weeklyStats.map((d) => {
                const dayLabel = `${new Date(d.date).getMonth() + 1}/${new Date(d.date).getDate()}`;
                const isToday = d.date === new Date().toISOString().split("T")[0];
                return (
                  <div key={d.date} className="flex-1 flex flex-col items-center gap-1">
                    <div className="text-xs font-semibold" style={{ color: "var(--steel)" }}>{d.done || ""}</div>
                    <div className="w-full rounded-t transition-all" style={{
                      height: `${Math.max(d.done > 0 ? 8 : 0, (d.done / maxDone) * 130)}px`,
                      background: isToday ? "var(--primary)" : "var(--primary)",
                      opacity: isToday ? 1 : 0.5,
                    }} />
                    <span className="text-xs" style={{ color: isToday ? "var(--primary)" : "var(--steel)", fontWeight: isToday ? 600 : 400 }}>{dayLabel}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Detail Summary */}
          <div className="rounded-xl p-5" style={{ background: "var(--canvas)", border: "1px solid var(--hairline)" }}>
            <h3 className="text-sm font-semibold mb-4" style={{ color: "var(--ink)" }}>学习概况</h3>
            <div className="flex flex-col gap-4">
              <SummaryItem label="总刷题量" value={String(data.user.totalQuestions)} />
              <SummaryItem label="综合正确率" value={accuracy > 0 ? `${accuracy}%` : "-"} color="var(--brand-green)" />
              <SummaryItem label="连续学习天数" value={`${data.user.streak}天`} color="var(--brand-orange)" />
              <SummaryItem label="错题闭环完成率" value={`${loopRate}%`} color="var(--primary)" sub={`${totalErrors}道错题中${loopStats.mastered}道已掌握`} />
              <SummaryItem label="今日刷题" value={`${data.user.todayDone} 题`} />
              <SummaryItem label="今日正确率" value={data.user.todayDone > 0 ? `${Math.round((data.user.todayCorrect / data.user.todayDone) * 100)}%` : "-"} />
            </div>
          </div>
        </div>

        {/* Module Accuracy - Real Data */}
        <div className="rounded-xl p-5 mb-6" style={{ background: "var(--canvas)", border: "1px solid var(--hairline)" }}>
          <h3 className="text-sm font-semibold mb-4" style={{ color: "var(--ink)" }}>各模块正确率</h3>
          {moduleAcc.every((m) => m.total === 0) ? (
            <div className="text-center py-6 text-sm" style={{ color: "var(--steel)" }}>开始刷题后，各模块正确率将在这里展示</div>
          ) : (
            moduleAcc.map((m) => {
              const color = m.rate >= 80 ? "var(--brand-green)" : m.rate >= 60 ? "var(--brand-orange)" : "var(--error)";
              return (
                <div key={m.name} className="flex items-center gap-3 mb-3">
                  <div className="text-xs font-medium w-28 text-right" style={{ color: "var(--charcoal)" }}>{m.name}</div>
                  <div className="flex-1 h-5 rounded-md overflow-hidden" style={{ background: "var(--hairline-soft)" }}>
                    <div className="h-full rounded-md" style={{ width: m.total > 0 ? `${m.rate}%` : "0%", background: color }} />
                  </div>
                  <div className="text-xs font-semibold w-16 text-right" style={{ color: "var(--steel)" }}>
                    {m.total === 0 ? "未做" : `${m.rate}% (${m.correct}/${m.total})`}
                  </div>
                  {m.total > 0 && (
                    <span className="text-xs px-2 py-0.5 rounded" style={{
                      background: m.level === "优秀" ? "var(--tint-mint)" : m.level === "中等" ? "var(--tint-sky)" : "var(--tint-peach)",
                      color: m.level === "优秀" ? "var(--brand-green)" : m.level === "中等" ? "var(--link-blue)" : "var(--brand-orange)",
                    }}>{m.level}</span>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Bottom Row */}
        <div className="grid grid-cols-2 gap-4">
          {/* Error Distribution - Real Data */}
          <div className="rounded-xl p-5" style={{ background: "var(--canvas)", border: "1px solid var(--hairline)" }}>
            <h3 className="text-sm font-semibold mb-4" style={{ color: "var(--ink)" }}>错因分布统计</h3>
            {errorDist.length === 0 ? (
              <div className="text-center py-8">
                <div className="mx-auto mb-3 w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold" style={{ background: "var(--tint-sky)", color: "var(--link-blue)" }}>%</div>
                <div className="text-xs" style={{ color: "var(--steel)" }}>做错题目后，错因分布将在这里展示</div>
              </div>
            ) : (
              <div className="flex items-center gap-6">
                <div className="rounded-full shrink-0" style={{ width: 140, height: 140, background: `conic-gradient(${pieSegments.join(",")})` }} />
                <div className="flex-1">
                  {errorDist.map((ed) => (
                    <div key={ed.type} className="flex items-center gap-2 mb-1.5">
                      <div className="w-3 h-3 rounded-sm shrink-0" style={{ background: errorColors[ed.type]?.color || "var(--muted)" }} />
                      <span className="text-xs" style={{ color: "var(--charcoal)" }}>{ed.type}</span>
                      <span className="text-xs font-semibold ml-auto" style={{ color: errorColors[ed.type]?.color || "var(--muted)" }}>
                        {ed.count}题 ({Math.round((ed.count / pieTotal) * 100)}%)
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Loop Progress - Real Data */}
          <div className="rounded-xl p-5" style={{ background: "var(--canvas)", border: "1px solid var(--hairline)" }}>
            <h3 className="text-sm font-semibold mb-4" style={{ color: "var(--ink)" }}>错题闭环进度</h3>
            <div className="flex flex-col gap-3.5">
              <LoopItem label="待复习" value={loopStats.pending} color="var(--brand-orange)" />
              <LoopItem label="复习中 (1/3 或 2/3)" value={loopStats.reviewing} color="var(--link-blue)" />
              <LoopItem label="已掌握 (3/3)" value={loopStats.mastered} color="var(--brand-green)" />
              <div className="mt-2 p-3 rounded-lg" style={{ background: "var(--surface)" }}>
                <div className="text-xs" style={{ color: "var(--steel)" }}>闭环完成率</div>
                <div className="text-xl font-semibold mt-0.5" style={{ color: "var(--primary)" }}>{loopRate}%</div>
                <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--hairline-soft)" }}>
                  <div className="h-full rounded-full transition-all" style={{ width: `${loopRate}%`, background: "var(--primary)" }} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, icon, bg }: { label: string; value: string; icon: string; bg: string }) {
  return (
    <div className="soft-card p-5" style={{ background: bg }}>
      <div className="w-8 h-8 rounded-xl flex items-center justify-center text-sm font-bold mb-3" style={{ background: "rgba(253,255,251,0.72)", color: "var(--primary)" }}>{icon}</div>
      <div className="text-xl font-semibold" style={{ color: "var(--ink)" }}>{value}</div>
      <div className="text-xs" style={{ color: "var(--steel)" }}>{label}</div>
    </div>
  );
}

function SummaryItem({ label, value, color, sub }: { label: string; value: string; color?: string; sub?: string }) {
  return (
    <div>
      <div className="text-xs" style={{ color: "var(--steel)" }}>{label}</div>
      <div className="text-lg font-semibold" style={{ color: color || "var(--ink)" }}>{value}</div>
      {sub && <div className="text-xs mt-0.5" style={{ color: "var(--steel)" }}>{sub}</div>}
    </div>
  );
}

function LoopItem({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <div className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
        <span className="text-sm" style={{ color: "var(--charcoal)" }}>{label}</span>
      </div>
      <span className="text-lg font-semibold" style={{ color }}>{value}</span>
    </div>
  );
}
