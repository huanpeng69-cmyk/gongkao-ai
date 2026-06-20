"use client";

import { useEffect, useMemo, useState } from "react";
import { ThreeBlocksTool, ThreeCubeTool, ThreeCutTool } from "@/components/ToolboxThreeTools";
import {
  defaultMemoryCards,
  formulaItems,
  fractionItems,
  toolboxCategories,
  type MemoryCard,
} from "@/lib/toolbox-content";

type ToolId =
  | "formula"
  | "speed"
  | "abxr"
  | "table"
  | "fractions"
  | "calculator"
  | "timer"
  | "cube"
  | "blocks"
  | "cut"
  | "views"
  | "cards";

type ToolMeta = {
  id: ToolId;
  category: "data" | "graphics" | "cards";
  title: string;
  desc: string;
  icon: string;
};

type DrillProblem = {
  text: string;
  answer: number;
  unit?: string;
  explain: string;
};

type Block = { x: number; y: number; z: number };

const tools: ToolMeta[] = [
  { id: "formula", category: "data", title: "公式大全", desc: "公式速查 + 默写判定", icon: "📘" },
  { id: "speed", category: "data", title: "速算练习", desc: "闭门修炼、夺魁限时、自定义算式", icon: "⚡" },
  { id: "abxr", category: "data", title: "ABXR专项", desc: "基期比重、平均数、倍数同形速算", icon: "📐" },
  { id: "table", category: "data", title: "速算表格", desc: "加减乘除表格化批量练习", icon: "📊" },
  { id: "fractions", category: "data", title: "分数记忆", desc: "百化分、平方数、单位换算卡片", icon: "🧠" },
  { id: "calculator", category: "data", title: "计算器", desc: "百分比、增长率、平均数、比重", icon: "🧮" },
  { id: "timer", category: "data", title: "计时器", desc: "考试模拟、倒计时、秒表计次", icon: "⏱" },
  { id: "cube", category: "graphics", title: "空间重构", desc: "六面体展开、相对面、公共边训练", icon: "🧊" },
  { id: "blocks", category: "graphics", title: "立体拼合", desc: "积木增删、合并、移动与投影视图", icon: "🧩" },
  { id: "cut", category: "graphics", title: "截面图", desc: "正方体切割面形状判断", icon: "✂" },
  { id: "views", category: "graphics", title: "三视图", desc: "主视、俯视、左视投影训练", icon: "◫" },
  { id: "cards", category: "cards", title: "行测记忆卡片", desc: "资料分类、翻转背诵、掌握度复习、批量导入", icon: "▣" },
];

const toolById = Object.fromEntries(tools.map((tool) => [tool.id, tool])) as Record<ToolId, ToolMeta>;

const cardStoreKey = "gongkao-toolbox-memory-cards";
const progressStoreKey = "gongkao-toolbox-memory-progress";
const memoryClearVersionKey = "gongkao-toolbox-memory-clear-version";
const memoryClearVersion = "2026-06-19-memory-card-clean-v1";

function randomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function closeEnough(input: string, answer: number, tolerance = 0.03) {
  const value = Number(input);
  if (!Number.isFinite(value)) return false;
  const base = Math.max(1, Math.abs(answer));
  return Math.abs(value - answer) / base <= tolerance;
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, "").replace(/×/g, "x").replace(/÷/g, "/").toLowerCase();
}

function makeSpeedProblem(mode: string): DrillProblem {
  if (mode === "percent") {
    const part = randomInt(12, 980);
    const total = randomInt(part + 20, 1600);
    return {
      text: `${part} 占 ${total} 的百分之几？`,
      answer: round2((part / total) * 100),
      unit: "%",
      explain: `比重 = 部分 / 整体 x 100% = ${part}/${total} x 100%`,
    };
  }
  if (mode === "growth") {
    const base = randomInt(80, 900);
    const current = base + randomInt(-60, 260);
    return {
      text: `基期 ${base}，现期 ${current}，增长率是多少？`,
      answer: round2(((current - base) / base) * 100),
      unit: "%",
      explain: `增长率 = (现期 - 基期) / 基期 x 100%`,
    };
  }
  if (mode === "average") {
    const count = randomInt(3, 6);
    const nums = Array.from({ length: count }, () => randomInt(60, 980));
    return {
      text: `${nums.join(" + ")} 的平均数是多少？`,
      answer: round2(nums.reduce((sum, item) => sum + item, 0) / nums.length),
      explain: `平均数 = 总数 / 个数，共 ${count} 项`,
    };
  }
  if (mode === "multiply") {
    const a = randomInt(12, 98);
    const b = randomInt(12, 98);
    return {
      text: `${a} x ${b} = ?`,
      answer: a * b,
      explain: "两位数乘法，可用拆分、凑整或平方差。",
    };
  }
  const a = randomInt(120, 980);
  const b = randomInt(11, 99);
  return {
    text: `${a} ÷ ${b} = ?`,
    answer: round2(a / b),
    explain: "截位直除，答案保留 2 位小数。",
  };
}

function makeTableProblems(type: string) {
  return Array.from({ length: 12 }, (_, index) => {
    const a = randomInt(20, 980);
    const b = randomInt(10, 360);
    const left = type === "division" ? a * randomInt(2, 9) : a;
    const right = type === "division" ? randomInt(2, 36) : b;
    let answer = left + right;
    let symbol = "+";
    if (type === "subtraction") {
      answer = left - right;
      symbol = "-";
    }
    if (type === "multiplication") {
      const x = randomInt(11, 99);
      const y = randomInt(11, 99);
      return { id: `p-${index}`, text: `${x} x ${y}`, answer: x * y };
    }
    if (type === "division") {
      answer = round2(left / right);
      symbol = "÷";
    }
    return { id: `p-${index}`, text: `${left} ${symbol} ${right}`, answer };
  });
}

function sameBlock(a: Block, b: Block) {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

function getProjection(blocks: Block[], view: "front" | "top" | "left") {
  const cells = new Set<string>();
  blocks.forEach((block) => {
    if (view === "front") cells.add(`${block.x},${block.y}`);
    if (view === "top") cells.add(`${block.x},${block.z}`);
    if (view === "left") cells.add(`${block.z},${block.y}`);
  });
  return cells;
}

export default function ToolboxPage() {
  const [activeCategory, setActiveCategory] = useState<(typeof toolboxCategories)[number]["id"]>("data");
  const [activeTool, setActiveTool] = useState<ToolId>("formula");

  useEffect(() => {
    if (!localStorage.getItem("gongkao-current-user")) {
      window.location.href = "/login";
    }
  }, []);

  const visibleTools = tools.filter((tool) => tool.category === activeCategory);
  const activeMeta = toolById[activeTool];
  const spatialMode = activeCategory === "graphics";

  useEffect(() => {
    const first = tools.find((tool) => tool.category === activeCategory);
    if (first && !visibleTools.some((tool) => tool.id === activeTool)) {
      setActiveTool(first.id);
    }
  }, [activeCategory, activeTool, visibleTools]);

  return (
    <div className="study-page toolbox-page animate-in">
      <div className="topbar sticky top-0 z-40 flex h-14 items-center px-8">
        <span className="text-sm font-bold" style={{ color: "var(--ink)" }}>
          备考百宝箱
        </span>
        <div className="ml-auto text-xs" style={{ color: "var(--steel)" }}>
          资料分析 + 空间想象 + 行测记忆卡片
        </div>
      </div>

      <div
        className="page-shell"
        style={spatialMode ? { padding: 18, width: "min(100%, calc(100vw - var(--sidebar-width)))" } : undefined}
      >
        {!spatialMode && (
        <section className="dashboard-hero mb-5 p-6">
          <div className="toolbox-hero-grid grid grid-cols-[minmax(0,1fr)_260px] gap-5">
            <div>
              <div className="eyebrow mb-2">EFFICIENCY TOOLS</div>
              <h1 className="mb-2 text-3xl font-bold" style={{ color: "var(--ink)" }}>
                备考百宝箱
              </h1>
              <p className="max-w-3xl text-sm leading-7" style={{ color: "var(--slate)" }}>
                复刻百宝箱的资料分析和空间想象工具，并新增行测资料记忆卡片。申论类按你的要求先不接入。
              </p>
            </div>
            <div className="soft-card p-4">
              <div className="text-xs font-semibold" style={{ color: "var(--steel)" }}>
                当前可用
              </div>
              <div className="mt-2 text-4xl font-bold" style={{ color: "var(--primary)" }}>
                {tools.length}
              </div>
              <div className="text-xs" style={{ color: "var(--steel)" }}>
                个实用模块
              </div>
            </div>
          </div>
        </section>
        )}

        <div className={spatialMode ? "toolbox-layout flex flex-col gap-3" : "toolbox-layout grid grid-cols-[260px_minmax(0,1fr)] gap-5"}>
          <aside
            className={spatialMode ? "toolbox-sidebar toolbox-spatial-sidebar soft-card p-3" : "toolbox-sidebar soft-card p-3"}
            style={spatialMode ? { alignItems: "center", display: "flex", gap: 12, minHeight: 58 } : undefined}
          >
            {spatialMode ? (
              <>
                <div className="shrink-0 px-2">
                  <div className="text-sm font-bold" style={{ color: "var(--ink)" }}>
                    图形推理 / 空间想象
                  </div>
                  <div className="text-xs" style={{ color: "var(--steel)" }}>
                    六面体、拼合、截面、三视图
                  </div>
                </div>
                <div className="toolbox-tool-list flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1">
                  {visibleTools.map((tool) => (
                    <button
                      key={tool.id}
                      onClick={() => setActiveTool(tool.id)}
                      className="flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-left text-sm"
                      style={{
                        background: activeTool === tool.id ? "rgba(63,143,120,0.12)" : "var(--canvas)",
                        border: activeTool === tool.id ? "1px solid rgba(63,143,120,0.24)" : "1px solid var(--hairline-soft)",
                        color: activeTool === tool.id ? "var(--primary)" : "var(--charcoal)",
                        width: 188,
                      }}
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: "var(--surface)" }}>
                        {tool.icon}
                      </span>
                      <span className="min-w-0">
                        <span className="block font-semibold">{tool.title}</span>
                        <span className="block truncate text-xs" style={{ color: "var(--steel)" }}>
                          {tool.desc}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <>
            <div>
            <div className="mb-2 px-2 text-xs font-bold" style={{ color: "var(--stone)" }}>
              分类目录
            </div>
            <div className={spatialMode ? "toolbox-category-list flex gap-2 overflow-x-auto pb-1" : "toolbox-category-list flex flex-col gap-2"}>
              {toolboxCategories.map((category) => {
                const active = activeCategory === category.id;
                const count = tools.filter((tool) => tool.category === category.id).length;
                return (
                  <button
                    key={category.id}
                    onClick={() => setActiveCategory(category.id)}
                    className="rounded-xl px-3 py-3 text-left"
                    style={{
                      background: active ? "var(--canvas)" : "transparent",
                      border: active ? "1px solid var(--hairline)" : "1px solid transparent",
                      color: active ? "var(--ink)" : "var(--slate)",
                      flex: spatialMode ? "0 0 190px" : undefined,
                    }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-bold">{category.title}</span>
                      <span className="rounded-full px-2 py-0.5 text-xs" style={{ background: "var(--surface)" }}>
                        {count}
                      </span>
                    </div>
                    <div className="mt-1 text-xs leading-5" style={{ color: "var(--steel)" }}>
                      {category.desc}
                    </div>
                  </button>
                );
              })}
            </div>
            </div>

            <div>
            <div className={spatialMode ? "mb-2 px-2 text-xs font-bold" : "mt-5 mb-2 px-2 text-xs font-bold"} style={{ color: "var(--stone)" }}>
              工具入口
            </div>
            <div className={spatialMode ? "toolbox-tool-list flex gap-2 overflow-x-auto pb-1" : "toolbox-tool-list flex flex-col gap-1.5"}>
              {visibleTools.map((tool) => (
                <button
                  key={tool.id}
                  onClick={() => setActiveTool(tool.id)}
                  className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm"
                  style={{
                    background: activeTool === tool.id ? "rgba(63,143,120,0.12)" : "transparent",
                    color: activeTool === tool.id ? "var(--primary)" : "var(--charcoal)",
                    flex: spatialMode ? "0 0 210px" : undefined,
                  }}
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: "var(--surface)" }}>
                    {tool.icon}
                  </span>
                  <span className="min-w-0">
                    <span className="block font-semibold">{tool.title}</span>
                    <span className="block truncate text-xs" style={{ color: "var(--steel)" }}>
                      {tool.desc}
                    </span>
                  </span>
                </button>
              ))}
            </div>
            </div>
              </>
            )}
          </aside>

          <main className="min-w-0">
            {!spatialMode && (
            <section className="soft-card mb-4 p-5">
              <div className="flex items-start gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl text-xl" style={{ background: "var(--surface)" }}>
                  {activeMeta.icon}
                </div>
                <div>
                  <h2 className="text-xl font-bold" style={{ color: "var(--ink)" }}>
                    {activeMeta.title}
                  </h2>
                  <p className="mt-1 text-sm" style={{ color: "var(--steel)" }}>
                    {activeMeta.desc}
                  </p>
                </div>
              </div>
            </section>
            )}

            <ToolRenderer activeTool={activeTool} />
          </main>
        </div>
      </div>
    </div>
  );
}

function ToolRenderer({ activeTool }: { activeTool: ToolId }) {
  if (activeTool === "formula") return <FormulaTool />;
  if (activeTool === "speed") return <SpeedTool />;
  if (activeTool === "abxr") return <AbxrTool />;
  if (activeTool === "table") return <TableTool />;
  if (activeTool === "fractions") return <FractionTool />;
  if (activeTool === "calculator") return <CalculatorTool />;
  if (activeTool === "timer") return <TimerTool />;
  if (activeTool === "cube") return <ThreeCubeTool />;
  if (activeTool === "blocks") return <ThreeBlocksTool />;
  if (activeTool === "cut") return <ThreeCutTool />;
  if (activeTool === "views") return <ThreeBlocksTool viewsOnly />;
  return <MemoryCardTool />;
}

function FormulaTool() {
  const groups = Array.from(new Set(formulaItems.map((item) => item.group)));
  const [group, setGroup] = useState(groups[0]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const list = formulaItems.filter((item) => item.group === group);

  const result = list.flatMap((item) =>
    item.blanks.map((blank, index) => {
      const key = `${item.id}-${index}`;
      return normalizeText(answers[key] || "") === normalizeText(blank);
    }),
  );
  const score = result.length ? Math.round((result.filter(Boolean).length / result.length) * 100) : 0;

  return (
    <section className="soft-card p-5">
      <div className="mb-4 flex flex-wrap gap-2">
        {groups.map((item) => (
          <button
            key={item}
            onClick={() => {
              setGroup(item);
              setSubmitted(false);
            }}
            className="rounded-lg px-3 py-2 text-xs font-semibold"
            style={{ background: group === item ? "var(--primary)" : "var(--surface)", color: group === item ? "white" : "var(--slate)" }}
          >
            {item}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_260px] gap-4">
        <div className="space-y-3">
          {list.map((item) => (
            <div key={item.id} className="rounded-xl p-4" style={{ background: "var(--canvas)", border: "1px solid var(--hairline)" }}>
              <div className="text-sm font-bold" style={{ color: "var(--ink)" }}>
                {item.title}
              </div>
              <div className="mt-2 rounded-lg px-3 py-2 text-sm font-semibold" style={{ background: "var(--surface)", color: "var(--primary)" }}>
                {item.formula}
              </div>
              <div className="mt-2 text-xs leading-6" style={{ color: "var(--steel)" }}>
                {item.note}
              </div>
              <div className="mt-3 grid gap-2">
                {item.blanks.map((blank, index) => {
                  const key = `${item.id}-${index}`;
                  const ok = normalizeText(answers[key] || "") === normalizeText(blank);
                  return (
                    <label key={key} className="grid grid-cols-[90px_minmax(0,1fr)_64px] items-center gap-2 text-xs">
                      <span style={{ color: "var(--steel)" }}>默写空 {index + 1}</span>
                      <input
                        value={answers[key] || ""}
                        onChange={(event) => setAnswers((value) => ({ ...value, [key]: event.target.value }))}
                        className="quiet-input rounded-lg px-3 py-2 outline-none"
                        placeholder="填写等号后的核心答案"
                      />
                      <span style={{ color: submitted ? (ok ? "var(--brand-green)" : "var(--error)") : "var(--muted)" }}>
                        {submitted ? (ok ? "正确" : "待改") : "未判"}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="rounded-xl p-4" style={{ background: "var(--surface)", border: "1px solid var(--hairline)" }}>
          <div className="text-sm font-bold" style={{ color: "var(--ink)" }}>
            公式默写
          </div>
          <div className="mt-3 text-4xl font-bold" style={{ color: "var(--primary)" }}>
            {submitted ? `${score}%` : "--"}
          </div>
          <p className="mt-2 text-xs leading-6" style={{ color: "var(--steel)" }}>
            规则同目标百宝箱：隐藏核心答案，由你逐空填写后统一判定。输入时会忽略空格和乘号差异。
          </p>
          <button onClick={() => setSubmitted(true)} className="primary-button mt-4 w-full rounded-lg px-4 py-2 text-sm font-semibold">
            提交判定
          </button>
          <button
            onClick={() => {
              setAnswers({});
              setSubmitted(false);
            }}
            className="ghost-button mt-2 w-full rounded-lg px-4 py-2 text-sm font-semibold"
          >
            清空重练
          </button>
        </div>
      </div>
    </section>
  );
}

function SpeedTool() {
  const [mode, setMode] = useState("division");
  const [problem, setProblem] = useState(() => makeSpeedProblem("division"));
  const [answer, setAnswer] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [stats, setStats] = useState({ done: 0, correct: 0 });
  const [duelCount, setDuelCount] = useState(10);

  const next = (nextMode = mode) => {
    setProblem(makeSpeedProblem(nextMode));
    setAnswer("");
    setSubmitted(false);
  };

  const submit = () => {
    const ok = closeEnough(answer, problem.answer);
    setStats((value) => ({ done: value.done + 1, correct: value.correct + (ok ? 1 : 0) }));
    setSubmitted(true);
  };

  return (
    <section className="soft-card p-5">
      <div className="grid grid-cols-[280px_minmax(0,1fr)] gap-5">
        <div>
          <div className="mb-3 text-sm font-bold" style={{ color: "var(--ink)" }}>
            闭门修炼设置
          </div>
          <div className="grid gap-2">
            {[
              ["division", "截位直除"],
              ["percent", "百分比"],
              ["growth", "增长率"],
              ["average", "平均数"],
              ["multiply", "乘法"],
            ].map(([value, label]) => (
              <button
                key={value}
                onClick={() => {
                  setMode(value);
                  next(value);
                }}
                className="rounded-lg px-3 py-2 text-left text-sm font-semibold"
                style={{ background: mode === value ? "var(--primary)" : "var(--surface)", color: mode === value ? "white" : "var(--slate)" }}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="mt-5 rounded-xl p-3" style={{ background: "var(--surface)" }}>
            <div className="text-xs font-semibold" style={{ color: "var(--steel)" }}>
              速算夺魁档位
            </div>
            <div className="mt-2 grid grid-cols-4 gap-2">
              {[10, 15, 20, 30].map((count) => (
                <button
                  key={count}
                  onClick={() => setDuelCount(count)}
                  className="rounded-lg px-2 py-2 text-xs font-bold"
                  style={{ background: duelCount === count ? "var(--brand-orange)" : "var(--canvas)", color: duelCount === count ? "white" : "var(--slate)" }}
                >
                  {count}题
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs leading-5" style={{ color: "var(--steel)" }}>
              答案允许 ±3% 容错，完成后按题量记录正确率。
            </p>
          </div>
        </div>

        <div className="rounded-xl p-5" style={{ background: "var(--canvas)", border: "1px solid var(--hairline)" }}>
          <div className="mb-4 grid grid-cols-4 gap-3">
            <MetricSmall label="今日刷题" value={stats.done} />
            <MetricSmall label="总正确" value={stats.correct} />
            <MetricSmall label="正确率" value={stats.done ? `${Math.round((stats.correct / stats.done) * 100)}%` : "--"} />
            <MetricSmall label="档位" value={`${duelCount}题`} />
          </div>

          <div className="rounded-2xl p-5 text-center" style={{ background: "var(--surface)" }}>
            <div className="text-xs font-semibold" style={{ color: "var(--steel)" }}>
              当前题目
            </div>
            <div className="mt-3 text-2xl font-bold" style={{ color: "var(--ink)" }}>
              {problem.text}
            </div>
            <div className="mx-auto mt-5 flex max-w-sm gap-2">
              <input
                value={answer}
                onChange={(event) => setAnswer(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !submitted) submit();
                }}
                className="quiet-input flex-1 rounded-xl px-4 py-3 text-center text-lg font-bold outline-none"
                placeholder="保留 2 位"
              />
              <button onClick={submitted ? () => next() : submit} className="primary-button rounded-xl px-4 py-2 text-sm font-semibold">
                {submitted ? "下一题" : "提交"}
              </button>
            </div>
            {submitted && (
              <div className="mt-4 text-sm leading-7" style={{ color: closeEnough(answer, problem.answer) ? "var(--brand-green)" : "var(--error)" }}>
                答案：{problem.answer}
                {problem.unit || ""}。{problem.explain}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function AbxrTool() {
  const [problem, setProblem] = useState(() => makeAbxrProblem());
  const [answer, setAnswer] = useState("");
  const [submitted, setSubmitted] = useState(false);

  function makeAbxrProblem() {
    const a = randomInt(120, 980);
    const b = randomInt(90, 760);
    const x = randomInt(-12, 28) / 100;
    const r = randomInt(-10, 24) / 100;
    const value = round2((a / b) * ((1 + r) / (1 + x)) * 100);
    return {
      a,
      b,
      x,
      r,
      value,
      text: `A=${a}，B=${b}，A增长率=${Math.round(x * 100)}%，B增长率=${Math.round(r * 100)}%，求基期 A/B（%）`,
    };
  }

  return (
    <section className="soft-card p-5">
      <div className="grid grid-cols-[minmax(0,1fr)_300px] gap-5">
        <div className="rounded-xl p-5" style={{ background: "var(--canvas)", border: "1px solid var(--hairline)" }}>
          <div className="eyebrow mb-2">ABXR</div>
          <h3 className="text-lg font-bold" style={{ color: "var(--ink)" }}>
            基期比重 / 基期平均数 / 基期倍数同形训练
          </h3>
          <p className="mt-2 text-sm leading-7" style={{ color: "var(--slate)" }}>
            这类题本质是 A/B 再乘一个修正项。把 A 的增长率记为 x，B 的增长率记为 r，基期值 = A/B x (1+r)/(1+x)。
          </p>
          <div className="mt-5 rounded-2xl p-5 text-center" style={{ background: "var(--surface)" }}>
            <div className="text-2xl font-bold" style={{ color: "var(--ink)" }}>
              {problem.text}
            </div>
            <div className="mx-auto mt-5 flex max-w-sm gap-2">
              <input
                value={answer}
                onChange={(event) => setAnswer(event.target.value)}
                className="quiet-input flex-1 rounded-xl px-4 py-3 text-center text-lg font-bold outline-none"
                placeholder="输入百分数"
              />
              <button
                onClick={() => (submitted ? (setProblem(makeAbxrProblem()), setAnswer(""), setSubmitted(false)) : setSubmitted(true))}
                className="primary-button rounded-xl px-4 py-2 text-sm font-semibold"
              >
                {submitted ? "下一题" : "判定"}
              </button>
            </div>
            {submitted && (
              <div className="mt-4 text-sm leading-7" style={{ color: closeEnough(answer, problem.value) ? "var(--brand-green)" : "var(--error)" }}>
                标准答案：{problem.value}%。先算 A/B，再用 (1+r)/(1+x) 修正。
              </div>
            )}
          </div>
        </div>

        <div className="rounded-xl p-4" style={{ background: "var(--surface)", border: "1px solid var(--hairline)" }}>
          <div className="text-sm font-bold" style={{ color: "var(--ink)" }}>
            速记规则
          </div>
          {[
            "A 与 B 谁增长更快，决定基期值向哪个方向修正。",
            "x 接近 r 时，修正项接近 1，可先估 A/B。",
            "选项差距大时，增长率小数项可截位处理。",
            "比重、平均数、倍数的基期公式同形。",
          ].map((item) => (
            <div key={item} className="mt-3 rounded-lg px-3 py-2 text-sm leading-6" style={{ background: "var(--canvas)", color: "var(--charcoal)" }}>
              {item}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function TableTool() {
  const [type, setType] = useState("addition");
  const [problems, setProblems] = useState(() => makeTableProblems("addition"));
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);

  const score = problems.filter((problem) => closeEnough(answers[problem.id] || "", problem.answer, type === "division" ? 0.03 : 0)).length;

  const reset = (nextType = type) => {
    setType(nextType);
    setProblems(makeTableProblems(nextType));
    setAnswers({});
    setSubmitted(false);
  };

  return (
    <section className="soft-card p-5">
      <div className="mb-4 flex flex-wrap gap-2">
        {[
          ["addition", "加法"],
          ["subtraction", "减法"],
          ["multiplication", "乘法"],
          ["division", "除法"],
        ].map(([value, label]) => (
          <button
            key={value}
            onClick={() => reset(value)}
            className="rounded-lg px-3 py-2 text-sm font-semibold"
            style={{ background: type === value ? "var(--primary)" : "var(--surface)", color: type === value ? "white" : "var(--slate)" }}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-3">
        {problems.map((problem) => {
          const ok = closeEnough(answers[problem.id] || "", problem.answer, type === "division" ? 0.03 : 0);
          return (
            <div key={problem.id} className="rounded-xl p-3" style={{ background: "var(--canvas)", border: "1px solid var(--hairline)" }}>
              <div className="text-sm font-bold" style={{ color: "var(--ink)" }}>
                {problem.text}
              </div>
              <input
                value={answers[problem.id] || ""}
                onChange={(event) => setAnswers((value) => ({ ...value, [problem.id]: event.target.value }))}
                className="quiet-input mt-3 w-full rounded-lg px-3 py-2 text-center font-bold outline-none"
                placeholder="答案"
              />
              {submitted && (
                <div className="mt-2 text-xs" style={{ color: ok ? "var(--brand-green)" : "var(--error)" }}>
                  {ok ? "正确" : `答案 ${problem.answer}`}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex items-center justify-between gap-3">
        <div className="text-sm" style={{ color: "var(--steel)" }}>
          {submitted ? `本次结果：${score}/${problems.length}` : "除法答案允许 ±3% 误差，其余题目需精确。"}
        </div>
        <div className="flex gap-2">
          <button onClick={() => setSubmitted(true)} className="primary-button rounded-lg px-4 py-2 text-sm font-semibold">
            交卷
          </button>
          <button onClick={() => reset()} className="ghost-button rounded-lg px-4 py-2 text-sm font-semibold">
            换一组
          </button>
        </div>
      </div>
    </section>
  );
}

function FractionTool() {
  const groups = Array.from(new Set(fractionItems.map((item) => item.group)));
  const [group, setGroup] = useState("基础百化分");
  const list = fractionItems.filter((item) => item.group === group);
  const [index, setIndex] = useState(0);
  const [show, setShow] = useState(false);

  const card = list[index % Math.max(1, list.length)];

  useEffect(() => {
    setIndex(0);
    setShow(false);
  }, [group]);

  return (
    <section className="soft-card p-5">
      <div className="mb-4 flex flex-wrap gap-2">
        {groups.map((item) => (
          <button
            key={item}
            onClick={() => setGroup(item)}
            className="rounded-lg px-3 py-2 text-xs font-semibold"
            style={{ background: group === item ? "var(--primary)" : "var(--surface)", color: group === item ? "white" : "var(--slate)" }}
          >
            {item}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_320px] gap-4">
        <div className="rounded-2xl p-8 text-center" style={{ background: "var(--canvas)", border: "1px solid var(--hairline)" }}>
          <div className="text-xs font-bold" style={{ color: "var(--steel)" }}>
            {card?.group}
          </div>
          <div className="mt-6 text-6xl font-bold" style={{ color: "var(--primary)" }}>
            {show ? card?.back : card?.front}
          </div>
          <div className="mt-5 text-sm" style={{ color: "var(--steel)" }}>
            {show ? card?.hint : "点击翻面查看答案"}
          </div>
          <div className="mt-6 flex justify-center gap-2">
            <button onClick={() => setShow((value) => !value)} className="primary-button rounded-lg px-4 py-2 text-sm font-semibold">
              翻面
            </button>
            <button
              onClick={() => {
                setIndex((value) => (value + 1) % list.length);
                setShow(false);
              }}
              className="ghost-button rounded-lg px-4 py-2 text-sm font-semibold"
            >
              下一张
            </button>
          </div>
        </div>
        <div className="rounded-xl p-4" style={{ background: "var(--surface)", border: "1px solid var(--hairline)" }}>
          <div className="text-sm font-bold" style={{ color: "var(--ink)" }}>
            分数表格
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {list.map((item) => (
              <div key={item.id} className="rounded-lg px-3 py-2 text-sm" style={{ background: "var(--canvas)", color: "var(--charcoal)" }}>
                <span className="font-bold">{item.front}</span>
                <span className="mx-2" style={{ color: "var(--muted)" }}>
                  =
                </span>
                {item.back}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function CalculatorTool() {
  const [mode, setMode] = useState("percent");
  const [values, setValues] = useState("320,1280");
  const [history, setHistory] = useState<string[]>([]);

  const result = useMemo(() => {
    const nums = values
      .split(/[,，\s]+/)
      .map(Number)
      .filter(Number.isFinite);
    if (mode === "percent" && nums.length >= 2) return `${round2((nums[0] / nums[1]) * 100)}%`;
    if (mode === "growth" && nums.length >= 2) return `${round2(((nums[1] - nums[0]) / nums[0]) * 100)}%`;
    if (mode === "average" && nums.length >= 1) return String(round2(nums.reduce((sum, item) => sum + item, 0) / nums.length));
    if (mode === "share" && nums.length >= 2) return `${round2((nums[0] / nums[1]) * 100)}%`;
    return "--";
  }, [mode, values]);

  const modeHelp: Record<string, string> = {
    percent: "百分比 = 第 1 个数 / 第 2 个数 x 100%",
    growth: "增长率 = (第 2 个数 - 第 1 个数) / 第 1 个数 x 100%",
    average: "平均数 = 所有输入项之和 / 项数",
    share: "比重 = 部分值 / 总体值 x 100%",
  };

  return (
    <section className="soft-card p-5">
      <div className="grid grid-cols-[minmax(0,1fr)_300px] gap-5">
        <div className="rounded-xl p-5" style={{ background: "var(--canvas)", border: "1px solid var(--hairline)" }}>
          <div className="mb-4 grid grid-cols-4 gap-2">
            {[
              ["percent", "百分比"],
              ["growth", "增长率"],
              ["average", "平均数"],
              ["share", "比重"],
            ].map(([value, label]) => (
              <button
                key={value}
                onClick={() => setMode(value)}
                className="rounded-lg px-3 py-2 text-xs font-semibold"
                style={{ background: mode === value ? "var(--primary)" : "var(--surface)", color: mode === value ? "white" : "var(--slate)" }}
              >
                {label}
              </button>
            ))}
          </div>
          <textarea
            value={values}
            onChange={(event) => setValues(event.target.value)}
            className="quiet-input min-h-[120px] w-full rounded-xl px-4 py-3 outline-none"
            placeholder="输入数值，用逗号或空格分隔"
          />
          <div className="mt-3 text-xs" style={{ color: "var(--steel)" }}>
            {modeHelp[mode]}
          </div>
          <div className="mt-5 rounded-2xl p-5 text-center" style={{ background: "var(--surface)" }}>
            <div className="text-xs font-semibold" style={{ color: "var(--steel)" }}>
              计算结果
            </div>
            <div className="mt-2 text-4xl font-bold" style={{ color: "var(--primary)" }}>
              {result}
            </div>
          </div>
          <button
            onClick={() => setHistory((items) => [`${modeHelp[mode]}：${values} = ${result}`, ...items].slice(0, 8))}
            className="primary-button mt-4 rounded-lg px-4 py-2 text-sm font-semibold"
          >
            记入历史
          </button>
        </div>
        <div className="rounded-xl p-4" style={{ background: "var(--surface)", border: "1px solid var(--hairline)" }}>
          <div className="text-sm font-bold" style={{ color: "var(--ink)" }}>
            计算历史
          </div>
          <div className="mt-3 space-y-2">
            {history.length === 0 ? (
              <div className="py-8 text-center text-xs" style={{ color: "var(--steel)" }}>
                暂无历史
              </div>
            ) : (
              history.map((item) => (
                <div key={item} className="rounded-lg p-3 text-xs leading-5" style={{ background: "var(--canvas)", color: "var(--charcoal)" }}>
                  {item}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function TimerTool() {
  const [mode, setMode] = useState<"exam" | "countdown" | "stopwatch">("exam");
  const [seconds, setSeconds] = useState(120 * 60);
  const [running, setRunning] = useState(false);
  const [laps, setLaps] = useState<number[]>([]);

  useEffect(() => {
    if (!running) return undefined;
    const id = window.setInterval(() => {
      setSeconds((value) => {
        if (mode === "stopwatch") return value + 1;
        if (value <= 1) {
          setRunning(false);
          return 0;
        }
        return value - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [mode, running]);

  const timeText = formatTime(seconds);
  const setPreset = (nextSeconds: number, nextMode = mode) => {
    setMode(nextMode);
    setSeconds(nextSeconds);
    setRunning(false);
    setLaps([]);
  };

  return (
    <section className="soft-card p-5">
      <div className="grid grid-cols-[minmax(0,1fr)_300px] gap-5">
        <div className="rounded-2xl p-8 text-center" style={{ background: "var(--canvas)", border: "1px solid var(--hairline)" }}>
          <div className="mb-4 flex justify-center gap-2">
            {[
              ["exam", "考试模拟"],
              ["countdown", "倒计时"],
              ["stopwatch", "秒表"],
            ].map(([value, label]) => (
              <button
                key={value}
                onClick={() => setPreset(value === "stopwatch" ? 0 : seconds, value as "exam" | "countdown" | "stopwatch")}
                className="rounded-lg px-3 py-2 text-xs font-semibold"
                style={{ background: mode === value ? "var(--primary)" : "var(--surface)", color: mode === value ? "white" : "var(--slate)" }}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="text-xs font-semibold" style={{ color: "var(--steel)" }}>
            {mode === "stopwatch" ? "已用时间" : "剩余时间"}
          </div>
          <div className="mt-4 text-7xl font-bold tabular-nums" style={{ color: seconds === 0 ? "var(--error)" : "var(--primary)" }}>
            {timeText}
          </div>
          <div className="mt-6 flex justify-center gap-2">
            <button onClick={() => setRunning((value) => !value)} className="primary-button rounded-lg px-5 py-2 text-sm font-semibold">
              {running ? "暂停" : seconds === 0 && mode !== "stopwatch" ? "重新开始" : "开始"}
            </button>
            <button
              onClick={() => {
                if (mode === "stopwatch") setLaps((items) => [seconds, ...items].slice(0, 8));
              }}
              className="ghost-button rounded-lg px-5 py-2 text-sm font-semibold"
            >
              计次
            </button>
          </div>
        </div>
        <div className="rounded-xl p-4" style={{ background: "var(--surface)", border: "1px solid var(--hairline)" }}>
          <div className="text-sm font-bold" style={{ color: "var(--ink)" }}>
            快捷设置
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {[
              ["行测 120分钟", 120 * 60, "exam"],
              ["申论 150分钟", 150 * 60, "exam"],
              ["5分钟", 5 * 60, "countdown"],
              ["10分钟", 10 * 60, "countdown"],
              ["25分钟", 25 * 60, "countdown"],
              ["45分钟", 45 * 60, "countdown"],
            ].map(([label, value, nextMode]) => (
              <button key={label} onClick={() => setPreset(value as number, nextMode as "exam" | "countdown")} className="rounded-lg px-3 py-2 text-sm font-semibold" style={{ background: "var(--canvas)", color: "var(--slate)" }}>
                {label}
              </button>
            ))}
          </div>
          <div className="mt-5 text-sm font-bold" style={{ color: "var(--ink)" }}>
            计次记录
          </div>
          <div className="mt-2 space-y-2">
            {laps.length === 0 ? (
              <div className="text-xs" style={{ color: "var(--steel)" }}>
                秒表模式下可记录计次。
              </div>
            ) : (
              laps.map((lap, index) => (
                <div key={`${lap}-${index}`} className="rounded-lg px-3 py-2 text-sm" style={{ background: "var(--canvas)", color: "var(--charcoal)" }}>
                  第 {laps.length - index} 次：{formatTime(lap)}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function CubeTool() {
  const [net, setNet] = useState("1-4-1型");
  const [mode, setMode] = useState("贴图模式");
  const [selected, setSelected] = useState("A");
  const faces = ["A", "B", "C", "D", "E", "F"];
  const opposite: Record<string, string> = { A: "D", B: "E", C: "F", D: "A", E: "B", F: "C" };

  return (
    <section className="soft-card p-5">
      <div className="grid grid-cols-[minmax(0,1fr)_300px] gap-5">
        <div className="rounded-xl p-5" style={{ background: "var(--canvas)", border: "1px solid var(--hairline)" }}>
          <div className="mb-4 flex flex-wrap gap-2">
            {["1-4-1型", "1-3-2型", "3-3型"].map((item) => (
              <button key={item} onClick={() => setNet(item)} className="rounded-lg px-3 py-2 text-xs font-semibold" style={{ background: net === item ? "var(--primary)" : "var(--surface)", color: net === item ? "white" : "var(--slate)" }}>
                {item}
              </button>
            ))}
            {["贴图模式", "旋转模式"].map((item) => (
              <button key={item} onClick={() => setMode(item)} className="rounded-lg px-3 py-2 text-xs font-semibold" style={{ background: mode === item ? "var(--brand-orange)" : "var(--surface)", color: mode === item ? "white" : "var(--slate)" }}>
                {item}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-[260px_minmax(0,1fr)] gap-4">
            <div className="grid h-[260px] grid-cols-4 grid-rows-3 gap-2 rounded-xl p-3" style={{ background: "var(--surface)" }}>
              {Array.from({ length: 12 }).map((_, index) => {
                const layout: Record<string, number[]> = {
                  "1-4-1型": [1, 4, 5, 6, 7, 9],
                  "1-3-2型": [1, 4, 5, 6, 9, 10],
                  "3-3型": [0, 1, 2, 4, 5, 6],
                };
                const faceIndex = layout[net].indexOf(index);
                const face = faces[faceIndex];
                return face ? (
                  <button
                    key={index}
                    onClick={() => setSelected(face)}
                    className="rounded-lg text-xl font-bold"
                    style={{
                      background: selected === face ? "var(--primary)" : "var(--canvas)",
                      color: selected === face ? "white" : "var(--ink)",
                      border: "1px solid var(--hairline)",
                    }}
                  >
                    {face}
                  </button>
                ) : (
                  <div key={index} />
                );
              })}
            </div>
            <div className="rounded-xl p-4" style={{ background: "var(--surface)" }}>
              <div className="text-sm font-bold" style={{ color: "var(--ink)" }}>
                判定要点
              </div>
              <div className="mt-3 space-y-2 text-sm leading-6" style={{ color: "var(--charcoal)" }}>
                <p>当前选中面：{selected}</p>
                <p>相对面：{opposite[selected]}</p>
                <p>相对面不能相邻；三面相邻时，公共顶点的顺逆时针方向保持不变。</p>
                <p>{mode === "贴图模式" ? "贴图模式用于标记面与图案。" : "旋转模式用于训练旋转后相邻关系。"}</p>
              </div>
            </div>
          </div>
        </div>
        <div className="rounded-xl p-4" style={{ background: "var(--surface)", border: "1px solid var(--hairline)" }}>
          <div className="text-sm font-bold" style={{ color: "var(--ink)" }}>
            操作说明
          </div>
          {["切换展开型观察相对面", "单击面块选中并查看相对面", "用公共边和公共顶点排除错误选项", "新版实现保留训练逻辑，省去目标站复杂 3D 依赖"].map((item) => (
            <div key={item} className="mt-3 rounded-lg px-3 py-2 text-sm" style={{ background: "var(--canvas)", color: "var(--charcoal)" }}>
              {item}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function BlocksTool({ title, viewsOnly = false }: { title: string; viewsOnly?: boolean }) {
  const [blocks, setBlocks] = useState<Block[]>([
    { x: 1, y: 0, z: 1 },
    { x: 2, y: 0, z: 1 },
    { x: 1, y: 1, z: 1 },
    { x: 1, y: 0, z: 2 },
  ]);
  const [cursor, setCursor] = useState<Block>({ x: 2, y: 1, z: 2 });
  const [message, setMessage] = useState("点选坐标添加独立积木。");

  const addBlock = () => {
    if (blocks.some((block) => sameBlock(block, cursor))) {
      setMessage("此处有积木");
      return;
    }
    setBlocks((items) => [...items, cursor]);
    setMessage("已添加新积木");
  };

  const removeBlock = () => {
    setBlocks((items) => items.filter((block) => !sameBlock(block, cursor)));
    setMessage("已删除选中坐标");
  };

  return (
    <section className="soft-card p-5">
      <div className="grid grid-cols-[minmax(0,1fr)_340px] gap-5">
        <div className="rounded-xl p-5" style={{ background: "var(--canvas)", border: "1px solid var(--hairline)" }}>
          <div className="mb-4 flex items-center justify-between">
            <div>
              <div className="text-lg font-bold" style={{ color: "var(--ink)" }}>
                {title}
              </div>
              <div className="text-xs" style={{ color: "var(--steel)" }}>
                {message}
              </div>
            </div>
            {!viewsOnly && (
              <button onClick={() => setBlocks([])} className="ghost-button rounded-lg px-3 py-2 text-xs font-semibold">
                清空
              </button>
            )}
          </div>

          <div className="grid grid-cols-5 gap-2">
            {Array.from({ length: 25 }).map((_, index) => {
              const x = index % 5;
              const z = Math.floor(index / 5);
              const height = blocks.filter((block) => block.x === x && block.z === z).length;
              const active = cursor.x === x && cursor.z === z;
              return (
                <button
                  key={index}
                  onClick={() => setCursor((value) => ({ ...value, x, z }))}
                  className="aspect-square rounded-lg text-sm font-bold"
                  style={{
                    background: active ? "var(--primary)" : height ? "var(--tint-mint)" : "var(--surface)",
                    color: active ? "white" : "var(--ink)",
                    border: "1px solid var(--hairline)",
                  }}
                >
                  {height || ""}
                </button>
              );
            })}
          </div>

          {!viewsOnly && (
            <div className="mt-4 grid grid-cols-[1fr_1fr_1fr_120px_120px] gap-2">
              {(["x", "y", "z"] as const).map((axis) => (
                <label key={axis} className="text-xs font-semibold" style={{ color: "var(--steel)" }}>
                  {axis.toUpperCase()}轴
                  <input
                    type="number"
                    min={0}
                    max={4}
                    value={cursor[axis]}
                    onChange={(event) => setCursor((value) => ({ ...value, [axis]: Math.max(0, Math.min(4, Number(event.target.value))) }))}
                    className="quiet-input mt-1 w-full rounded-lg px-3 py-2 outline-none"
                  />
                </label>
              ))}
              <button onClick={addBlock} className="primary-button self-end rounded-lg px-3 py-2 text-sm font-semibold">
                新建
              </button>
              <button onClick={removeBlock} className="ghost-button self-end rounded-lg px-3 py-2 text-sm font-semibold">
                删除
              </button>
            </div>
          )}
        </div>

        <ProjectionPanel blocks={blocks} />
      </div>
    </section>
  );
}

function ProjectionPanel({ blocks }: { blocks: Block[] }) {
  return (
    <div className="rounded-xl p-4" style={{ background: "var(--surface)", border: "1px solid var(--hairline)" }}>
      <div className="text-sm font-bold" style={{ color: "var(--ink)" }}>
        投影视图
      </div>
      <div className="mt-3 grid gap-3">
        {[
          ["front", "主视图"],
          ["top", "俯视图"],
          ["left", "左视图"],
        ].map(([view, label]) => (
          <div key={view} className="rounded-lg p-3" style={{ background: "var(--canvas)" }}>
            <div className="mb-2 text-xs font-semibold" style={{ color: "var(--steel)" }}>
              {label}
            </div>
            <ProjectionGrid cells={getProjection(blocks, view as "front" | "top" | "left")} />
          </div>
        ))}
      </div>
    </div>
  );
}

function ProjectionGrid({ cells }: { cells: Set<string> }) {
  return (
    <div className="grid w-full grid-cols-5 gap-1">
      {Array.from({ length: 25 }).map((_, index) => {
        const x = index % 5;
        const y = 4 - Math.floor(index / 5);
        const active = cells.has(`${x},${y}`);
        return <div key={index} className="aspect-square rounded" style={{ background: active ? "var(--primary)" : "var(--surface)", border: "1px solid var(--hairline)" }} />;
      })}
    </div>
  );
}

function CutTool() {
  const [shape, setShape] = useState("triangle");
  const shapeMeta: Record<string, { title: string; desc: string; points: string }> = {
    triangle: { title: "三角形截面", desc: "切到同一顶点相邻三条棱，常见为三角形。", points: "80,20 160,160 20,160" },
    rectangle: { title: "矩形截面", desc: "平行于一组相对面切割，截面多为矩形或正方形。", points: "35,45 165,45 165,155 35,155" },
    hexagon: { title: "六边形截面", desc: "同时切过六条棱，常见为六边形。", points: "70,25 140,25 180,95 140,170 70,170 25,95" },
  };
  const current = shapeMeta[shape];

  return (
    <section className="soft-card p-5">
      <div className="grid grid-cols-[260px_minmax(0,1fr)] gap-5">
        <div className="rounded-xl p-4" style={{ background: "var(--surface)", border: "1px solid var(--hairline)" }}>
          <div className="text-sm font-bold" style={{ color: "var(--ink)" }}>
            截面类型
          </div>
          <div className="mt-3 grid gap-2">
            {Object.entries(shapeMeta).map(([key, item]) => (
              <button key={key} onClick={() => setShape(key)} className="rounded-lg px-3 py-2 text-left text-sm font-semibold" style={{ background: shape === key ? "var(--primary)" : "var(--canvas)", color: shape === key ? "white" : "var(--slate)" }}>
                {item.title}
              </button>
            ))}
          </div>
        </div>
        <div className="rounded-xl p-5" style={{ background: "var(--canvas)", border: "1px solid var(--hairline)" }}>
          <div className="grid grid-cols-[220px_minmax(0,1fr)] gap-5">
            <svg viewBox="0 0 200 200" className="h-[220px] w-[220px] rounded-xl" style={{ background: "var(--surface)" }}>
              <rect x="45" y="45" width="110" height="110" fill="none" stroke="#7c8982" strokeWidth="3" />
              <path d="M45 45 L75 18 L185 18 L155 45 M155 45 L185 18 L185 128 L155 155 M45 155 L75 128 L185 128" fill="none" stroke="#b7c9bd" strokeWidth="2" />
              <polygon points={current.points} fill="rgba(229,111,78,0.26)" stroke="#e56f4e" strokeWidth="4" />
            </svg>
            <div>
              <div className="text-xl font-bold" style={{ color: "var(--ink)" }}>
                {current.title}
              </div>
              <p className="mt-3 text-sm leading-7" style={{ color: "var(--slate)" }}>
                {current.desc}
              </p>
              <div className="mt-4 rounded-xl p-3 text-sm leading-6" style={{ background: "var(--surface)", color: "var(--charcoal)" }}>
                判断顺序：先看切面经过几个面，再数切过几条棱，最后判断是否平行于某个面或对角线。
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function MemoryCardTool() {
  const [cards, setCards] = useState<MemoryCard[]>(defaultMemoryCards);
  const [progress, setProgress] = useState<Record<string, "new" | "review" | "mastered">>({});
  const [category, setCategory] = useState("全部");
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [showMastered, setShowMastered] = useState(false);
  const [importText, setImportText] = useState("");

  useEffect(() => {
    try {
      if (localStorage.getItem(memoryClearVersionKey) !== memoryClearVersion) {
        localStorage.removeItem(cardStoreKey);
        localStorage.removeItem(progressStoreKey);
        localStorage.setItem(memoryClearVersionKey, memoryClearVersion);
        setCards(defaultMemoryCards);
        setProgress({});
        return;
      }
      const saved = localStorage.getItem(cardStoreKey);
      const savedProgress = localStorage.getItem(progressStoreKey);
      if (saved) {
        const savedCards = JSON.parse(saved) as MemoryCard[];
        const savedIds = new Set(savedCards.map((card) => card.id));
        const mergedCards = [...defaultMemoryCards.filter((card) => !savedIds.has(card.id)), ...savedCards];
        setCards(mergedCards);
        localStorage.setItem(cardStoreKey, JSON.stringify(mergedCards));
      }
      if (savedProgress) setProgress(JSON.parse(savedProgress));
    } catch {
      setCards(defaultMemoryCards);
    }
  }, []);

  const categories = ["全部", ...Array.from(new Set(cards.map((card) => card.category)))];
  const filtered = cards.filter((card) => {
    if (!showMastered && progress[card.id] === "mastered") return false;
    const matchCategory = category === "全部" || card.category === category;
    const text = `${card.category} ${card.subcategory} ${card.front} ${card.back} ${card.tags.join(" ")}`;
    return matchCategory && text.toLowerCase().includes(query.toLowerCase());
  });
  const activeCard = filtered[index % Math.max(1, filtered.length)];
  const reviewCount = cards.filter((card) => progress[card.id] === "review").length;
  const masteredCount = cards.filter((card) => progress[card.id] === "mastered").length;
  const statusLabel = activeCard
    ? progress[activeCard.id] === "mastered"
      ? "已掌握"
      : progress[activeCard.id] === "review"
        ? "记不住"
        : "新卡"
    : "";

  useEffect(() => {
    if (filtered.length > 0 && index >= filtered.length) {
      setIndex(filtered.length - 1);
    }
  }, [filtered.length, index]);

  const saveCards = (nextCards: MemoryCard[]) => {
    setCards(nextCards);
    localStorage.setItem(cardStoreKey, JSON.stringify(nextCards));
  };

  const mark = (status: "review" | "mastered") => {
    if (!activeCard) return;
    const next = { ...progress, [activeCard.id]: status };
    setProgress(next);
    localStorage.setItem(progressStoreKey, JSON.stringify(next));
    setFlipped(false);
    if (status === "mastered" && !showMastered) {
      setIndex((value) => Math.min(value, Math.max(filtered.length - 2, 0)));
    } else {
      setIndex((value) => (value + 1) % Math.max(1, filtered.length));
    }
  };

  const importCards = () => {
    const text = importText.trim();
    if (!text) return;
    let next: MemoryCard[] = [];
    try {
      const parsed = JSON.parse(text) as MemoryCard[];
      next = parsed.map((item, idx) => ({
        id: item.id || `import-${Date.now()}-${idx}`,
        category: item.category || "行测资料",
        subcategory: item.subcategory || "导入",
        front: item.front,
        back: item.back,
        tags: item.tags || [],
      }));
    } catch {
      next = text
        .split(/\n+/)
        .map((line, idx) => {
          const parts = line.split(/\t|,，/).map((part) => part.trim());
          if (parts.length < 2) return null;
          return {
            id: `import-${Date.now()}-${idx}`,
            category: parts[2] || "行测资料",
            subcategory: parts[3] || "导入",
            front: parts[0],
            back: parts[1],
            tags: parts.slice(4).filter(Boolean),
          } satisfies MemoryCard;
        })
        .filter(Boolean) as MemoryCard[];
    }
    if (next.length) {
      saveCards([...next, ...cards]);
      setImportText("");
      setCategory("全部");
      setIndex(0);
    }
  };

  return (
    <section className="soft-card p-5">
      <div className="mb-4 rounded-xl p-3 text-xs leading-6" style={{ background: "var(--tint-yellow)", color: "var(--charcoal)" }}>
        已内置行测分类知识卡片，并保留批量导入。可用“正面,背面,分类,小类,标签”逐行导入，也可粘贴 JSON 数组。
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_320px] gap-5">
        <div>
          <div className="mb-4 grid grid-cols-4 gap-3">
            <MetricSmall label="卡片总数" value={cards.length} />
            <MetricSmall label="可刷新卡" value={filtered.length} />
            <MetricSmall label="待复习" value={reviewCount} />
            <MetricSmall label="已掌握" value={masteredCount} />
          </div>

          <div className="mb-3 flex flex-wrap gap-2">
            {categories.map((item) => (
              <button key={item} onClick={() => (setCategory(item), setIndex(0), setFlipped(false))} className="rounded-lg px-3 py-2 text-xs font-semibold" style={{ background: category === item ? "var(--primary)" : "var(--surface)", color: category === item ? "white" : "var(--slate)" }}>
                {item}
              </button>
            ))}
          </div>
          <label className="mb-3 flex items-center gap-2 text-xs font-semibold" style={{ color: "var(--slate)" }}>
            <input
              type="checkbox"
              checked={showMastered}
              onChange={(event) => (setShowMastered(event.target.checked), setIndex(0), setFlipped(false))}
            />
            显示已掌握
          </label>
          <input value={query} onChange={(event) => (setQuery(event.target.value), setIndex(0))} className="quiet-input mb-4 w-full rounded-xl px-4 py-3 outline-none" placeholder="搜索题干、答案、标签或分类" />

          <div className="min-h-[320px] rounded-2xl p-6" style={{ background: "var(--canvas)", border: "1px solid var(--hairline)" }}>
            {activeCard ? (
              <>
                <div className="flex items-center gap-2 text-xs font-semibold" style={{ color: "var(--steel)" }}>
                  <span>{activeCard.category}</span>
                  <span>/</span>
                  <span>{activeCard.subcategory}</span>
                  <span className="ml-auto rounded-full px-2 py-1" style={{ background: "var(--surface)" }}>
                    {statusLabel}
                  </span>
                </div>
                <button onClick={() => setFlipped((value) => !value)} className="mt-5 block min-h-[180px] w-full rounded-2xl p-6 text-left" style={{ background: "var(--surface)", color: "var(--ink)" }}>
                  <div className="text-xs font-semibold" style={{ color: "var(--steel)" }}>
                    {flipped ? "答案" : "问题"}
                  </div>
                  <div className="mt-4 whitespace-pre-line text-xl font-bold leading-9">{flipped ? activeCard.back : activeCard.front}</div>
                </button>
                <div className="mt-4 flex flex-wrap gap-2">
                  {activeCard.tags.map((tag) => (
                    <span key={tag} className="rounded-full px-2.5 py-1 text-xs" style={{ background: "var(--tint-mint)", color: "var(--primary)" }}>
                      {tag}
                    </span>
                  ))}
                </div>
                <div className="mt-5 flex gap-2">
                  <button onClick={() => setFlipped((value) => !value)} className="ghost-button rounded-lg px-4 py-2 text-sm font-semibold">
                    翻面
                  </button>
                  <button onClick={() => mark("review")} className="rounded-lg px-4 py-2 text-sm font-semibold text-white" style={{ background: "var(--brand-orange)" }}>
                    记不住
                  </button>
                  <button onClick={() => mark("mastered")} className="primary-button rounded-lg px-4 py-2 text-sm font-semibold">
                    已掌握
                  </button>
                  <button onClick={() => (setIndex((value) => (value + 1) % Math.max(1, filtered.length)), setFlipped(false))} className="ghost-button ml-auto rounded-lg px-4 py-2 text-sm font-semibold">
                    下一张
                  </button>
                </div>
              </>
            ) : (
              <div className="py-20 text-center text-sm" style={{ color: "var(--steel)" }}>
                没有可刷新的卡片
              </div>
            )}
          </div>
        </div>

        <div className="rounded-xl p-4" style={{ background: "var(--surface)", border: "1px solid var(--hairline)" }}>
          <div className="text-sm font-bold" style={{ color: "var(--ink)" }}>
            批量导入
          </div>
          <p className="mt-2 text-xs leading-6" style={{ color: "var(--steel)" }}>
            支持 JSON 数组，或逐行 CSV/TSV：正面,背面,分类,小类,标签。
          </p>
          <textarea
            value={importText}
            onChange={(event) => setImportText(event.target.value)}
            className="quiet-input mt-3 min-h-[190px] w-full rounded-xl px-3 py-3 text-xs outline-none"
            placeholder={"例：\n两期比重升降看什么？,看部分增长率a与整体增长率b,资料分析,比重,公式"}
          />
          <button onClick={importCards} className="primary-button mt-3 w-full rounded-lg px-4 py-2 text-sm font-semibold">
            导入卡片
          </button>
          <button
            onClick={() => {
              saveCards(defaultMemoryCards);
              localStorage.removeItem(progressStoreKey);
              setProgress({});
            }}
            className="ghost-button mt-2 w-full rounded-lg px-4 py-2 text-sm font-semibold"
          >
            恢复种子库
          </button>
        </div>
      </div>
    </section>
  );
}

function MetricSmall({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl px-3 py-3" style={{ background: "var(--surface)", border: "1px solid var(--hairline)" }}>
      <div className="text-xl font-bold" style={{ color: "var(--primary)" }}>
        {value}
      </div>
      <div className="text-xs" style={{ color: "var(--steel)" }}>
        {label}
      </div>
    </div>
  );
}

function formatTime(total: number) {
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return [hours, minutes, seconds].map((item) => String(item).padStart(2, "0")).join(":");
}
