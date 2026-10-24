"use client";

import { useEffect, useState } from "react";

// 与 app/stats/page.tsx 的视觉约定保持一致（CSS 变量 + soft-card）。

type KindBucket = { prompt: number; completion: number; calls: number };
type DayPoint = { date: string; prompt: number; completion: number; calls: number };
type RecentItem = {
  id: string;
  kind: "text" | "image";
  model: string;
  promptTokens: number;
  completionTokens: number;
  cached: boolean;
  createdAt: string;
};
type UsageSummary = {
  today: { prompt: number; completion: number };
  thisMonth: { prompt: number; completion: number };
  totals: { prompt: number; completion: number; calls: number; cached: number };
  byKind: Record<string, KindBucket>;
  byModel: Record<string, KindBucket>;
  series: DayPoint[];
  recent: RecentItem[];
};

const fmt = (n: number) => (n >= 10000 ? `${(n / 1000).toFixed(1)}k` : String(n));
const sum = (b?: KindBucket) => (b ? b.prompt + b.completion : 0);
const shortDate = (iso: string) => {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

export default function UsagePage() {
  const [data, setData] = useState<UsageSummary | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/usage", { cache: "no-store" });
        if (res.status === 404) {
          if (alive) setError("当前为静态站点模式，没有服务端用量数据。");
          return;
        }
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          if (alive) setError(body?.error || `加载失败（${res.status}）`);
          return;
        }
        const json = (await res.json()) as UsageSummary;
        if (alive) setData(json);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "加载失败");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="animate-in study-page">
        <div className="topbar sticky top-0 z-40 flex items-center px-8 h-14">
          <span className="text-sm font-bold" style={{ color: "var(--ink)" }}>Token 用量</span>
        </div>
        <div className="p-8 text-sm" style={{ color: "var(--steel)" }}>加载中...</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="animate-in study-page">
        <div className="topbar sticky top-0 z-40 flex items-center px-8 h-14">
          <span className="text-sm font-bold" style={{ color: "var(--ink)" }}>Token 用量</span>
        </div>
        <div className="p-8 max-w-[900px]">
          <div className="rounded-xl p-5 text-sm" style={{ background: "var(--tint-peach)", border: "1px solid var(--hairline)", color: "var(--ink)" }}>
            {error || "暂无数据"}
          </div>
        </div>
      </div>
    );
  }

  const text = data.byKind.text;
  const image = data.byKind.image;
  const maxDay = Math.max(...data.series.map((d) => d.prompt + d.completion), 1);
  const totalAll = data.totals.prompt + data.totals.completion;

  return (
    <div className="animate-in study-page stats-page">
      <div className="topbar sticky top-0 z-40 flex items-center px-8 h-14">
        <span className="text-sm font-bold" style={{ color: "var(--ink)" }}>Token 用量</span>
        <span className="text-xs ml-2" style={{ color: "var(--steel)" }}>只统计服务端代理的 AI 调用</span>
      </div>

      <div className="p-8 max-w-[1100px]">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <SummaryCard label="今日 Token" value={fmt(data.today.prompt + data.today.completion)} icon="T" bg="var(--tint-sky)" sub={`输入 ${fmt(data.today.prompt)} · 输出 ${fmt(data.today.completion)}`} />
          <SummaryCard label="本月 Token" value={fmt(data.thisMonth.prompt + data.thisMonth.completion)} icon="M" bg="var(--tint-mint)" sub={`输入 ${fmt(data.thisMonth.prompt)} · 输出 ${fmt(data.thisMonth.completion)}`} />
          <SummaryCard label="累计 Token" value={fmt(totalAll)} icon="Σ" bg="var(--tint-lavender)" sub={`共 ${data.totals.calls} 次调用`} />
          <SummaryCard label="缓存命中" value={String(data.totals.cached)} icon="↯" bg="var(--tint-peach)" sub="未消耗 Token 的次数" />
        </div>

        <div className="grid grid-cols-[2fr_1fr] gap-4 mb-6">
          <div className="rounded-xl p-5" style={{ background: "var(--canvas)", border: "1px solid var(--hairline)" }}>
            <h3 className="text-sm font-semibold mb-4" style={{ color: "var(--ink)" }}>近 14 天 Token 消耗</h3>
            <div className="flex items-end gap-1.5" style={{ height: 180 }}>
              {data.series.map((d) => {
                const total = d.prompt + d.completion;
                const h = total > 0 ? Math.max(4, (total / maxDay) * 100) : 0;
                const inputH = total > 0 ? (d.prompt / total) * 100 : 0;
                const isToday = d.date === data.series[data.series.length - 1]?.date;
                return (
                  <div key={d.date} className="flex-1 flex flex-col items-center gap-1" title={`${d.date}：输入 ${d.prompt} / 输出 ${d.completion}`}>
                    <div className="text-[10px] font-semibold" style={{ color: "var(--steel)" }}>{total ? fmt(total) : ""}</div>
                    <div className="w-full rounded-t-md overflow-hidden flex flex-col justify-end" style={{ height: 140, background: "var(--hairline-soft)" }}>
                      <div style={{ height: `${h}%`, background: "var(--link-blue)", opacity: 0.45 }} className="w-full" data-tip="input" />
                      <div style={{ height: `${h * (1 - inputH / 100)}%`, background: "var(--brand-green)" }} className="w-full" data-tip="output" />
                    </div>
                    <div className="text-[10px]" style={{ color: isToday ? "var(--ink)" : "var(--steel)", fontWeight: isToday ? 700 : 400 }}>{shortDate(d.date)}</div>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-4 mt-3 text-xs" style={{ color: "var(--steel)" }}>
              <span className="flex items-center gap-1.5"><i className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: "var(--link-blue)", opacity: 0.45 }} />输入</span>
              <span className="flex items-center gap-1.5"><i className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: "var(--brand-green)" }} />输出</span>
            </div>
          </div>

          <div className="rounded-xl p-5" style={{ background: "var(--canvas)", border: "1px solid var(--hairline)" }}>
            <h3 className="text-sm font-semibold mb-4" style={{ color: "var(--ink)" }}>能力分布</h3>
            <div className="flex flex-col gap-4">
              <BucketRow label="文字讲解" bucket={text} tone="var(--link-blue)" />
              <BucketRow label="漫画生图" bucket={image} tone="var(--brand-orange)" note="生图接口不返回 token，按张数计" />
            </div>
            <div className="mt-5 pt-4 text-xs leading-relaxed" style={{ borderTop: "1px solid var(--hairline)", color: "var(--steel)" }}>
              口径说明：只统计经服务端代理的调用；原生 App 直连上游不在此列。生图类接口不返回 token 用量，因此 Token 记 0、只计次数。
            </div>
          </div>
        </div>

        <div className="rounded-xl p-5 mb-6" style={{ background: "var(--canvas)", border: "1px solid var(--hairline)" }}>
          <h3 className="text-sm font-semibold mb-4" style={{ color: "var(--ink)" }}>按模型</h3>
          {Object.keys(data.byModel).length === 0 ? (
            <div className="text-sm" style={{ color: "var(--steel)" }}>暂无调用记录</div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {Object.entries(data.byModel)
                .sort((a, b) => sum(b[1]) - sum(a[1]))
                .map(([model, bucket]) => (
                  <div key={model} className="flex items-center gap-3">
                    <span className="text-xs font-mono truncate" style={{ color: "var(--charcoal)", width: 220 }} title={model}>{model}</span>
                    <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: "var(--hairline-soft)" }}>
                      <div className="h-full rounded-full" style={{ width: `${totalAll > 0 ? (sum(bucket) / totalAll) * 100 : 0}%`, background: "var(--primary)" }} />
                    </div>
                    <span className="text-xs font-semibold tabular-nums" style={{ color: "var(--ink)", width: 90, textAlign: "right" }}>{fmt(sum(bucket))}</span>
                    <span className="text-xs tabular-nums" style={{ color: "var(--steel)", width: 60, textAlign: "right" }}>{bucket.calls} 次</span>
                  </div>
                ))}
            </div>
          )}
        </div>

        <div className="rounded-xl p-5" style={{ background: "var(--canvas)", border: "1px solid var(--hairline)" }}>
          <h3 className="text-sm font-semibold mb-4" style={{ color: "var(--ink)" }}>最近调用（最多 50 条）</h3>
          {data.recent.length === 0 ? (
            <div className="text-sm" style={{ color: "var(--steel)" }}>暂无调用记录</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr style={{ color: "var(--steel)" }}>
                    <th className="text-left font-medium pb-2 pr-3">时间</th>
                    <th className="text-left font-medium pb-2 pr-3">类型</th>
                    <th className="text-left font-medium pb-2 pr-3">模型</th>
                    <th className="text-right font-medium pb-2 pr-3">输入</th>
                    <th className="text-right font-medium pb-2 pr-3">输出</th>
                    <th className="text-right font-medium pb-2">来源</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent.map((r) => (
                    <tr key={r.id} style={{ borderTop: "1px solid var(--hairline-soft)" }}>
                      <td className="py-1.5 pr-3 tabular-nums" style={{ color: "var(--steel)" }}>{new Date(r.createdAt).toLocaleString("zh-CN", { hour12: false })}</td>
                      <td className="py-1.5 pr-3" style={{ color: "var(--charcoal)" }}>{r.kind === "image" ? "生图" : "文字"}</td>
                      <td className="py-1.5 pr-3 font-mono truncate" style={{ color: "var(--charcoal)", maxWidth: 220 }} title={r.model}>{r.model}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums" style={{ color: "var(--ink)" }}>{fmt(r.promptTokens)}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums" style={{ color: "var(--ink)" }}>{fmt(r.completionTokens)}</td>
                      <td className="py-1.5 text-right" style={{ color: r.cached ? "var(--brand-green)" : "var(--steel)" }}>{r.cached ? "缓存" : "实时"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, icon, bg, sub }: { label: string; value: string; icon: string; bg: string; sub?: string }) {
  return (
    <div className="soft-card p-5" style={{ background: bg }}>
      <div className="w-8 h-8 rounded-xl flex items-center justify-center text-sm font-bold mb-3" style={{ background: "rgba(253,255,251,0.72)", color: "var(--primary)" }}>{icon}</div>
      <div className="text-xl font-semibold" style={{ color: "var(--ink)" }}>{value}</div>
      <div className="text-xs" style={{ color: "var(--steel)" }}>{label}</div>
      {sub && <div className="text-[11px] mt-1" style={{ color: "var(--steel)" }}>{sub}</div>}
    </div>
  );
}

function BucketRow({ label, bucket, tone, note }: { label: string; bucket?: KindBucket; tone: string; note?: string }) {
  const total = sum(bucket);
  const calls = bucket?.calls || 0;
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-medium" style={{ color: "var(--charcoal)" }}>{label}</span>
        <span className="text-sm font-semibold tabular-nums" style={{ color: tone }}>{fmt(total)}</span>
      </div>
      <div className="text-xs tabular-nums" style={{ color: "var(--steel)" }}>
        输入 {fmt(bucket?.prompt || 0)} · 输出 {fmt(bucket?.completion || 0)} · {calls} 次
      </div>
      {note && <div className="text-[11px] mt-0.5" style={{ color: "var(--steel)" }}>{note}</div>}
    </div>
  );
}
