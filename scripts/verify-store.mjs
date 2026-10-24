#!/usr/bin/env node
// 最小回归测试：lib/server/store.ts 的持久化不变量。
//   F1  跨实例（Vercel 多副本）不得因陈旧内存快照覆盖而静默丢数据。
//   F4  读取失败 / 结构非法时，绝不把损坏误判为空库并覆盖；失败不得毒化写入队列。
//
// 无测试框架依赖：用项目自带 typescript 把真实源码转译为 CJS 后加载，
// 仅把数据目录（GONGKAO_DATA_DIR）指向一次性临时目录，其余路径真实。
// 运行： npm test
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require_ = createRequire(import.meta.url);
const Module = require_("module");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STORE_TS = path.join(ROOT, "lib", "server", "store.ts");

let ts;
try {
  ts = require_("typescript");
} catch {
  console.error("✖ 找不到 typescript，请先 `npm install`");
  process.exit(2);
}

const SOURCE = fs.readFileSync(STORE_TS, "utf8");
const CODE = ts.transpileModule(SOURCE, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    esModuleInterop: true,
    allowSyntheticDefaultImports: true,
  },
}).outputText;

const tmpRoots = [];
function makeDataDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gk-store-test-"));
  tmpRoots.push(dir);
  return dir;
}

// 加载 store 的一个全新模块实例（dataDirectory 在模块顶层读取 env，故每实例前先设好目录）。
// 用 Module#_compile 注入 require：stub 掉 "server-only" 与类型导入，node: 内置模块走真实解析。
function loadStore(dataDir) {
  process.env.GONGKAO_DATA_DIR = dataDir;
  const m = new Module(`store-${Math.random().toString(36).slice(2)}`);
  m.filename = path.join(ROOT, "lib", "server", "store.js");
  m.paths = [];
  m.require = (spec) => {
    if (spec === "server-only" || spec === "@/lib/types" || spec === "./types") return {};
    return require_(spec);
  };
  m._compile(CODE, m.filename);
  return m.exports;
}

const dbFile = (dir) => path.join(dir, "users.json");
const readRaw = (f) => fs.readFileSync(f, "utf8");
const userKeys = (dir) => Object.keys(JSON.parse(readRaw(dbFile(dir))).users || {}).sort();
const sum2 = (b) => (b ? b.prompt + b.completion : 0);

let pass = 0;
let fail = 0;
const check = (name, cond) => {
  console.log(`${cond ? "✅" : "❌"} ${name}`);
  cond ? pass++ : fail++;
};
const throws = async (fn) => {
  try {
    await fn();
    return null;
  } catch (e) {
    return e;
  }
};

const seedDb = () => ({
  users: { alice: { id: "aid", username: "alice", displayName: "Alice", passwordHash: "", salt: "", createdAt: "x" } },
  sessions: {},
  appData: { aid: { user: { name: "Alice", totalQuestions: 5 }, errors: [], dailyHistory: [] } },
});

async function main() {
  // --- F1：两个实例共享同一目录，写入不得互相覆盖 ---
  {
    const dir = makeDataDir();
    const A = loadStore(dir);
    const B = loadStore(dir);
    const alice = await A.createUser({ username: "alice", displayName: "Alice", password: "secret1" });
    const bob = await B.createUser({ username: "bob", displayName: "Bob", password: "secret2" });
    check("F1 A 创建 alice 成功", alice.ok === true);
    check("F1 B 创建 bob 成功（未清掉 alice）", bob.ok === true && userKeys(dir).join(",") === "alice,bob");
    await A.saveUserData(alice.user.id, { user: { name: "Alice", totalQuestions: 42 }, errors: [], dailyHistory: [] });
    check("F1 A 写数据后仍保留 alice+bob", userKeys(dir).join(",") === "alice,bob");
    const seenByB = await B.getUserData(alice.user.id);
    check("F1 B 能读到 A 刚写的数据", !!(seenByB && seenByB.user && seenByB.user.totalQuestions === 42));
  }

  // --- F4：首次运行（无文件）正常创建 ---
  {
    const dir = makeDataDir();
    const store = loadStore(dir);
    const res = await store.createUser({ username: "newbie", displayName: "New", password: "secret1" });
    check("F4 无库文件时可正常创建（ENOENT 视为空库）", res.ok === true && fs.existsSync(dbFile(dir)));
  }

  // --- F4：正常写入保留既有用户+数据，且生成可恢复 .bak ---
  {
    const dir = makeDataDir();
    fs.writeFileSync(dbFile(dir), JSON.stringify(seedDb()));
    const pre = readRaw(dbFile(dir));
    const store = loadStore(dir);
    const res = await store.createUser({ username: "bob", displayName: "Bob", password: "secret2" });
    const after = JSON.parse(readRaw(dbFile(dir)));
    check("F4 正常写入成功", res.ok === true && !!after.users.bob);
    check("F4 既有 alice 与其 appData 未丢", !!after.users.alice && !!(after.appData.aid && after.appData.aid.user.totalQuestions === 5));
    check("F4 覆盖前生成了 .bak 且等于写前内容", fs.existsSync(`${dbFile(dir)}.bak`) && readRaw(`${dbFile(dir)}.bak`) === pre);
  }

  // --- F4：文件损坏 → 拒绝写入、原样保留；随后修复可恢复（队列未毒化） ---
  {
    const dir = makeDataDir();
    const corrupt = "{ 这不是合法 JSON ";
    fs.writeFileSync(dbFile(dir), corrupt);
    const store = loadStore(dir);
    const err = await throws(() => store.createUser({ username: "eve", displayName: "Eve", password: "secret1" }));
    check("F4 损坏库时写入被拒（不静默当空库）", err !== null);
    check("F4 损坏文件未被覆盖", readRaw(dbFile(dir)) === corrupt);
    fs.writeFileSync(dbFile(dir), JSON.stringify({ users: {}, sessions: {}, appData: {} }));
    const ok = await throws(() => store.createUser({ username: "zoe", displayName: "Zoe", password: "secret1" }));
    check("F4 修复后同实例可继续写入（writeQueue 未被毒化）", ok === null && userKeys(dir).includes("zoe"));
  }

  // --- F4：结构非法（顶层数组 / users 类型错）→ 拒绝、不覆盖 ---
  {
    const dirA = makeDataDir();
    const arr = "[]";
    fs.writeFileSync(dbFile(dirA), arr);
    const sA = loadStore(dirA);
    const eA = await throws(() => sA.saveUserData("uid", { user: { name: "X", totalQuestions: 1 }, errors: [], dailyHistory: [] }));
    check("F4 顶层结构非法时写入被拒且不覆盖", eA !== null && readRaw(dbFile(dirA)) === arr);

    const dirB = makeDataDir();
    fs.writeFileSync(dbFile(dirB), JSON.stringify({ users: [], sessions: {}, appData: {} }));
    const sB = loadStore(dirB);
    const eB = await throws(() => sB.createUser({ username: "qq", displayName: "Q", password: "secret1" }));
    check("F4 users 字段类型非法时写入被拒", eB !== null);
  }

  // --- U1：usage 记录可写、可聚合，且不影响其它顶层数据 ---
  {
    const dir = makeDataDir();
    const store = loadStore(dir);
    const u = await store.createUser({ username: "tester", displayName: "Tester", password: "secret1" });
    const uid = u.ok ? u.user.id : "";
    await store.recordUsage({ userId: uid, kind: "text", model: "m1", promptTokens: 100, completionTokens: 50 });
    await store.recordUsage({ userId: uid, kind: "text", model: "m1", promptTokens: 200, completionTokens: 80 });
    await store.recordUsage({ userId: uid, kind: "image", model: "img-1" });
    const summary = await store.getUsageSummary(uid);
    check("U1 usage 累计正确（输入 300 / 输出 130）", summary.totals.prompt === 300 && summary.totals.completion === 130);
    check("U1 调用次数与缓存计数正确", summary.totals.calls === 3 && summary.totals.cached === 0);
    check("U1 按能力分开统计", sum2(summary.byKind.text) === 430 && summary.byKind.image.calls === 1);
    check("U1 按模型统计", summary.byModel.m1.calls === 2 && summary.byModel["img-1"].calls === 1);
    check("U1 近 14 天序列长度固定且含今日", summary.series.length === 14);
    check("U1 最近列表按时间倒序且最多 50 条", summary.recent.length === 3 && summary.recent[0].kind === "image");
    const onDisk = JSON.parse(readRaw(dbFile(dir)));
    check("U1 usage 已落库且未破坏 users/appData", onDisk.users.tester && onDisk.usage.length === 3);
  }

  // --- U2：别的用户看不到彼此的 usage ---
  {
    const dir = makeDataDir();
    const store = loadStore(dir);
    const a = await store.createUser({ username: "ua", displayName: "UA", password: "secret1" });
    const b = await store.createUser({ username: "ub", displayName: "UB", password: "secret1" });
    await store.recordUsage({ userId: a.ok ? a.user.id : "", kind: "text", model: "m", promptTokens: 10, completionTokens: 5 });
    const summaryB = await store.getUsageSummary(b.ok ? b.user.id : "");
    check("U2 用户 B 读不到用户 A 的用量", summaryB.totals.calls === 0 && summaryB.recent.length === 0);
  }

  // --- U3：库损坏时 recordUsage 必须拒绝写入而不是静默记空 ---
  {
    const dir = makeDataDir();
    fs.writeFileSync(dbFile(dir), "{ 坏数据 ");
    const store = loadStore(dir);
    const err = await throws(() => store.recordUsage({ userId: "x", kind: "text", model: "m", promptTokens: 1, completionTokens: 1 }));
    check("U3 损坏库时记录用量被拒（fail-closed）", err !== null);
    check("U3 损坏文件未被覆盖", readRaw(dbFile(dir)) === "{ 坏数据 ");
  }
}

main()
  .then(() => {
    console.log(`\nstore 回归测试：${pass}/${pass + fail} 通过`);
    console.log(`STORE_TEST=${fail === 0 ? "PASS" : "FAIL"}`);
    process.exit(fail === 0 ? 0 : 1);
  })
  .catch((e) => {
    console.error("测试运行异常：", e);
    process.exit(1);
  })
  .finally(() => {
    for (const dir of tmpRoots) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* 清理失败不影响结果 */
      }
    }
  });
