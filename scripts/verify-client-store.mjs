#!/usr/bin/env node
// 客户端 store 回归测试：lib/store.ts（"use client"，依赖 window/localStorage）。
// 覆盖本次 P0 改动：
//   ③ knowledgeProfile 键与真实题库 module 对齐（言语理解与表达），且作答时自愈创建缺失键；
//   ② updateErrorType 把 AI 错因写回错题本，且只接受 6 类已知错因、只针对真实错题。
//   首刷幂等（重复作答不累加题数）、按题记时、addStudyMinutes 整卷结算、reviewQueue 不截断。
//
// 用项目自带 typescript 把源码转译为 CJS 后加载，stub 掉 auth / types / window 边界。
// 每个用例块都重新编译一份独立 store 模块，避免模块级 dataCache 串味（这是此前一次假红的根因）。
// 运行： node scripts/verify-client-store.mjs
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";

const require_ = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STORE_TS = path.join(ROOT, "lib", "store.ts");

let ts;
try {
  ts = require_("typescript");
} catch {
  console.error("✖ 找不到 typescript，请先 `npm install`");
  process.exit(2);
}

const SOURCE = fs.readFileSync(STORE_TS, "utf8");

// 构造一道真实题库形态的题（module 与题库一致）
const QUESTION = {
  id: "yanyu-001",
  type: "single_choice",
  module: "言语理解与表达", // 真实题库 module（此前默认键是“言语理解”，不匹配）
  moduleKey: "yanyu",
  question: "下列关于文段的理解，正确的是：",
  options: [{ key: "A", text: "A" }, { key: "B", text: "B" }],
  answer: "A",
  explanation: "解析",
  knowledgePoints: ["主旨概括"],
};

// 编译一份全新的 store 模块实例：自带独立的 localStorage / window / dataCache。
function makeStore() {
  const map = new Map();
  const localStorage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _map: map,
  };
  globalThis.window = { localStorage };
  globalThis.localStorage = localStorage;

  const CODE = ts.transpileModule(SOURCE, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
      allowSyntheticDefaultImports: true,
    },
  }).outputText;

  const Module = require_("module");
  const storeModule = new Module("client-store");
  storeModule.filename = path.join(ROOT, "lib", "store.js");
  storeModule.paths = [];
  storeModule.require = (spec) => {
    if (spec === "@/lib/auth" || spec === "./auth") return { getCurrentDisplayName: () => "学员" };
    if (spec === "@/lib/types" || spec === "./types") return {};
    if (spec === "server-only") return {};
    return require_(spec);
  };
  storeModule._compile(CODE, storeModule.filename);
  return storeModule.exports;
}

let pass = 0;
let fail = 0;
const check = (name, cond) => {
  console.log(`${cond ? "✅" : "❌"} ${name}`);
  cond ? pass++ : fail++;
};

// --- ③ 言语模块：默认键已对齐，作答后正确累计 ---
{
  const store = makeStore();
  const data = store.loadData();
  check("③ 默认 knowledgeProfile 含「言语理解与表达」键", !!data.user.knowledgeProfile["言语理解与表达"]);
  check("③ 默认 knowledgeProfile 不再含旧键「言语理解」", !data.user.knowledgeProfile["言语理解"]);

  store.recordAnswer(QUESTION, "B", false); // 答错
  const after = store.loadData();
  const kp = after.user.knowledgeProfile["言语理解与表达"];
  check("③ 言语题作答后该模块 total 累计为 1（修复前永远 0）", kp && kp.total === 1 && kp.correct === 0);
  check("③ 错题本记录了该错题（用于后续错因回填）", after.errors.some((e) => e.questionId === "yanyu-001"));
}

// --- ③ 自愈：历史旧数据若缺失某模块键，作答时自动创建（不抛错、不错位） ---
{
  const store = makeStore();
  const data = store.loadData();
  delete data.user.knowledgeProfile["判断推理"]; // 模拟旧数据缺键
  store.saveData(data);
  const q2 = { ...QUESTION, id: "panduan-1", module: "判断推理", moduleKey: "panduan" };
  store.recordAnswer(q2, "A", true); // 答对
  const after = store.loadData();
  const kp = after.user.knowledgeProfile["判断推理"];
  check("③ 缺失键作答后自愈创建并正确累计", kp && kp.total === 1 && kp.correct === 1);
}

// --- ② updateErrorType：把 AI 错因写回错题本，且仅接受已知错因、仅针对真实错题 ---
{
  const store = makeStore();
  store.recordAnswer(QUESTION, "B", false); // 先答错，产生错题
  store.updateErrorType("yanyu-001", "概念混淆");
  const after = store.loadData();
  const err = after.errors.find((e) => e.questionId === "yanyu-001");
  check("② 已知错因可写回错题本", !!err && err.errorType === "概念混淆");
}
{
  const store = makeStore();
  store.recordAnswer(QUESTION, "B", false);
  store.updateErrorType("yanyu-001", "乱写的错因"); // 非 6 类已知
  const after = store.loadData();
  const err = after.errors.find((e) => e.questionId === "yanyu-001");
  check("② 未知错因被拒绝写回（保持默认）", !!err && err.errorType === "思路偏差");
}
{
  const store = makeStore();
  // 没答错，错题本里没有该 id
  store.updateErrorType("不存在的题", "审题失误");
  const after = store.loadData();
  check("② 非真实错题不被写入", !after.errors.some((e) => e.questionId === "不存在的题"));
}

// --- 首刷幂等：同一题重复作答不再累加题数/正确数（避免二刷污染正确率） ---
{
  const store = makeStore();
  const base = store.loadData();
  store.recordAnswer(QUESTION, "B", false); // 首刷答错
  store.recordAnswer(QUESTION, "A", true); // 二刷答对
  const after = store.loadData();
  const kp = after.user.knowledgeProfile["言语理解与表达"];
  check("首刷幂等：totalQuestions 只累加 1 次", after.user.totalQuestions === base.user.totalQuestions + 1);
  check("首刷幂等：todayDone 只累加 1 次", after.user.todayDone === base.user.todayDone + 1);
  check("首刷幂等：模块 total 只累加 1 次且仍记首刷为错", !!kp && kp.total === 1 && kp.correct === 0);
  check(
    "首刷幂等：answeredIds 记录该题且不重复",
    after.answeredIds.filter((id) => id === "yanyu-001").length === 1,
  );
}

// --- 耗时：重复作答只累加 timeSpentMinutes，不累加题数 ---
{
  const store = makeStore();
  const today = store.getLocalDateKey();
  const base = store.loadData();
  const baseMinutes = (base.dailyHistory.find((r) => r.date === today) || {}).timeSpentMinutes || 0;
  store.recordAnswer(QUESTION, "B", false, undefined, 0.5);
  store.recordAnswer(QUESTION, "B", false, undefined, 1.25);
  const after = store.loadData();
  const rec = after.dailyHistory.find((r) => r.date === today) || {};
  // store 约定按 1 位小数入账，0.5 + 1.25 = 1.75 会进位为 1.8
  check("耗时：二刷仍累加 timeSpentMinutes（0.5 + 1.25 → 1.8）", Math.abs((rec.timeSpentMinutes || 0) - baseMinutes - 1.8) < 1e-9);
  check("耗时：二刷不重复累加当天题数", rec.totalDone === ((base.dailyHistory.find((r) => r.date === today) || {}).totalDone || 0) + 1);
}

// --- addStudyMinutes：整卷模考一次性结算当天时长，非法输入不写入 ---
{
  const store = makeStore();
  const today = store.getLocalDateKey();
  const baseMinutes = (store.loadData().dailyHistory.find((r) => r.date === today) || {}).timeSpentMinutes || 0;
  store.addStudyMinutes(12.5);
  const afterFirst = (store.loadData().dailyHistory.find((r) => r.date === today) || {}).timeSpentMinutes || 0;
  check("addStudyMinutes：累加当天时长", Math.abs(afterFirst - baseMinutes - 12.5) < 1e-9);
  store.addStudyMinutes(0);
  store.addStudyMinutes(-5);
  store.addStudyMinutes(Number.NaN);
  const afterBad = (store.loadData().dailyHistory.find((r) => r.date === today) || {}).timeSpentMinutes || 0;
  check("addStudyMinutes：非正数/NaN 不写入", Math.abs(afterBad - afterFirst) < 1e-9);
}

// --- reviewQueue 不截断：超过 20 条到期错题也要全部返回（此前 slice(0,20)） ---
{
  const store = makeStore();
  const today = store.getLocalDateKey();
  const data = store.loadData();
  for (let i = 0; i < 25; i++) {
    data.errors.push({
      questionId: `due-${i}`,
      question: { ...QUESTION, id: `due-${i}` },
      userAnswer: "B",
      errorType: "思路偏差",
      errorDate: today,
      loopStatus: "pending",
      loopCount: 0,
      reviewHistory: [{ date: today, correct: false }],
      nextReviewDate: today,
      easeFactor: 2.5,
      interval: 0,
    });
  }
  store.saveData(data);
  const plan = store.getReviewPlan();
  check("reviewQueue：25 条到期错题全部返回（不截断到 20）", plan.reviewQueue.length === 25);
  check("reviewQueue：dueToday 计数与实际队列一致", plan.dueToday === 25);
}

console.log(`\n客户端 store 回归测试：${pass}/${pass + fail} 通过`);
console.log(`CLIENT_STORE_TEST=${fail === 0 ? "PASS" : "FAIL"}`);
process.exit(fail === 0 ? 0 : 1);
