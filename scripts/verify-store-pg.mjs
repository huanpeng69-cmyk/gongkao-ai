#!/usr/bin/env node
// PG 驱动回归测试：用真实 store.ts（STORAGE_DRIVER=pg）跑与 JSON 驱动相同的业务断言。
// 需要一个可随意清空的测试库：TEST_DATABASE_URL=postgres://... npm run test:pg
// 未设置 TEST_DATABASE_URL 时跳过（退出码 0），不影响 npm test。
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";

const require_ = createRequire(import.meta.url);
const Module = require_("module");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  console.log("⏭ 未设置 TEST_DATABASE_URL，跳过 PG 驱动测试");
  process.exit(0);
}
if (!/test/i.test(url) && process.env.ALLOW_NON_TEST_DB !== "1") {
  console.error("✖ 为防误删数据，TEST_DATABASE_URL 的库名须含 test（或设 ALLOW_NON_TEST_DB=1）");
  process.exit(2);
}
process.env.STORAGE_DRIVER = "pg";
process.env.DATABASE_URL = url;

const ts = require_("typescript");
const pg = require_("pg");
const { runMigrations } = await import("./db-migrate.mjs");

function load(file, overrides) {
  const code = ts.transpileModule(fs.readFileSync(path.join(ROOT, "lib", "server", file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  const m = new Module(file);
  m.filename = path.join(ROOT, "lib", "server", file.replace(/\.ts$/, ".js"));
  m.paths = [];
  m.require = (spec) => {
    if (spec === "server-only" || spec === "@/lib/types") return {};
    if (overrides[spec]) return overrides[spec];
    return require_(spec);
  };
  m._compile(code, m.filename);
  return m.exports;
}
const pgStore = load("store-pg.ts", {});
const store = load("store.ts", { "./store-pg": pgStore });

let pass = 0;
let fail = 0;
const check = (name, cond) => {
  console.log(`${cond ? "✅" : "❌"} ${name}`);
  cond ? pass++ : fail++;
};

const admin = new pg.Client({ connectionString: url });
await admin.connect();
try {
  await admin.query("DROP TABLE IF EXISTS usage_records, user_app_data, sessions, users, schema_migrations CASCADE");
  await runMigrations(admin);
  const again = await runMigrations(admin);
  check("M1 迁移可重复执行（第二次无操作）", again.length === 0);

  const a = await store.createUser({ username: "Alice", displayName: "Alice", password: "secret1" });
  const dup = await store.createUser({ username: "alice", displayName: "A2", password: "secret1" });
  check("P1 注册成功", a.ok === true);
  check("P1 用户名大小写归一后重复注册被拒", dup.ok === false);
  check("P2 正确密码登录", (await store.verifyUser("alice", "secret1"))?.id === a.user.id);
  check("P2 错误密码被拒", (await store.verifyUser("alice", "wrong!!")) === null);

  const { token } = await store.createSession(a.user.id);
  check("P3 会话可取回用户", (await store.getUserBySession(token))?.username === "alice");
  await store.deleteSession(token);
  check("P3 登出后会话失效", (await store.getUserBySession(token)) === null);
  const s2 = await store.createSession(a.user.id);
  await admin.query("UPDATE sessions SET expires_at = 1");
  check("P3 过期会话返回 null", (await store.getUserBySession(s2.token)) === null);
  check("P3 过期会话被清理", Number((await admin.query("SELECT count(*) n FROM sessions")).rows[0].n) === 0);

  check("P4 无数据时返回 null", (await store.getUserData(a.user.id)) === null);
  await store.saveUserData(a.user.id, { user: { name: "Alice", totalQuestions: 42 }, errors: [], dailyHistory: [] });
  check("P4 整包保存后可读回", (await store.getUserData(a.user.id))?.user.totalQuestions === 42);

  const cur = await store.getUserDataWithVersion(a.user.id);
  const ok1 = await store.saveUserDataVersioned(a.user.id, { user: { totalQuestions: 43 }, errors: [], dailyHistory: [] }, cur.version);
  const stale = await store.saveUserDataVersioned(a.user.id, { user: { totalQuestions: 1 }, errors: [], dailyHistory: [] }, cur.version);
  check("P5 版本一致时保存成功且版本 +1", ok1.ok === true && ok1.version === cur.version + 1);
  check("P5 旧版本保存返回冲突", stale.ok === false && stale.conflict === true);
  check("P5 冲突时数据未被覆盖", (await store.getUserData(a.user.id))?.user.totalQuestions === 43);
  const b = await store.createUser({ username: "bob", displayName: "Bob", password: "secret1" });
  const first = await store.saveUserDataVersioned(b.user.id, { user: {}, errors: [], dailyHistory: [] }, 0);
  const firstAgain = await store.saveUserDataVersioned(b.user.id, { user: {}, errors: [], dailyHistory: [] }, 0);
  check("P5 expectedVersion=0 首次写入成功、重复则冲突", first.ok === true && firstAgain.ok === false);

  await store.recordUsage({ userId: a.user.id, kind: "text", model: "m1", promptTokens: 100, completionTokens: 50 });
  await store.recordUsage({ userId: a.user.id, kind: "text", model: "m1", promptTokens: 200, completionTokens: 80 });
  await store.recordUsage({ userId: a.user.id, kind: "image", model: "img-1" });
  const sum = await store.getUsageSummary(a.user.id);
  check("U1 用量累计正确（300/130，3 次）", sum.totals.prompt === 300 && sum.totals.completion === 130 && sum.totals.calls === 3);
  check("U1 按能力/模型统计", sum.byKind.image.calls === 1 && sum.byModel.m1.calls === 2);
  check("U1 近 14 天序列与最近列表", sum.series.length === 14 && sum.recent.length === 3 && sum.recent[0].kind === "image");
  check("U2 其他用户看不到", (await store.getUsageSummary(b.user.id)).totals.calls === 0);

  // ==================== 阶段 2b：作答流水 ====================
  const today = "2026-11-24";
  await store.recordAnswer({ userId: a.user.id, questionId: "q1", module: "判断推理", isCorrect: true, minutesSpent: 0.5, localDate: today });
  await store.recordAnswer({ userId: a.user.id, questionId: "q2", module: "资料分析", isCorrect: false, minutesSpent: 1.25, localDate: today });
  await store.recordAnswer({ userId: a.user.id, questionId: "q1", module: "判断推理", isCorrect: true, isReview: true, localDate: today });
  const counted = await store.countAnswers(a.user.id, today);
  check("A1 作答流水按日聚合（3 条，2 对）", counted.total === 3 && counted.correct === 2);

  const rows = (await admin.query(
    "SELECT question_id, is_correct, is_review, minutes_spent FROM answer_records WHERE user_id = $1 AND local_date = $2 ORDER BY question_id",
    [a.user.id, today],
  )).rows;
  check("A2 落库字段正确（复习标记、耗时）", rows.length === 3 && rows.filter((r) => r.is_review).length === 1);
  check("A3 耗时四舍五入到 1 位小数", rows.some((r) => Number(r.minutes_spent) === 1.3));

  // 非正数/NaN 耗时存 null，不污染平均耗时
  await store.recordAnswer({ userId: a.user.id, questionId: "q3", isCorrect: true, minutesSpent: -5, localDate: today });
  await store.recordAnswer({ userId: a.user.id, questionId: "q4", isCorrect: true, minutesSpent: Number.NaN, localDate: today });
  const nullMinutes = (await admin.query(
    "SELECT count(*)::int AS n FROM answer_records WHERE user_id = $1 AND question_id IN ('q3','q4') AND minutes_spent IS NULL",
    [a.user.id],
  )).rows[0].n;
  check("A4 非正数 / NaN 耗时存 null", nullMinutes === 2);

  // 用户隔离：另一个用户看不到
  check("A5 其他用户的作答流水互不可见", (await store.countAnswers(b.user.id, today)).total === 0);

  // 删除用户时级联删除流水
  await admin.query("DELETE FROM users WHERE id = $1", [b.user.id]);
  const orphan = (await admin.query("SELECT count(*)::int AS n FROM answer_records WHERE user_id = $1", [b.user.id])).rows[0].n;
  check("A6 删除用户级联清理作答流水", orphan === 0);
} catch (error) {
  console.error("测试运行异常：", error);
  fail++;
} finally {
  await admin.end();
  await pgStore.closePool();
}
console.log(`\nPG store 回归测试：${pass}/${pass + fail} 通过`);
console.log(`STORE_PG_TEST=${fail === 0 ? "PASS" : "FAIL"}`);
process.exit(fail === 0 ? 0 : 1);
