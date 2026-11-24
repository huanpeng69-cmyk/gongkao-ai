#!/usr/bin/env node
// 接口冒烟测试：注册 → 会话 → 保存/读回数据 → 用量 → 登出 → 重新登录 → 再读回。
// 用 Node 自带 fetch 发 UTF-8 JSON，避免 Windows 下 curl/PowerShell 中文编码问题。
// 用法：先 npm run dev，再 node scripts/smoke-api.mjs [http://localhost:3000]
const base = process.argv[2] || "http://localhost:3000";
let cookie = "";
let pass = 0, fail = 0;
const check = (name, cond, extra = "") => { console.log(`${cond ? "✅" : "❌"} ${name}${extra ? "  " + extra : ""}`); cond ? pass++ : fail++; };

async function call(method, path, body, extraHeaders = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { "Content-Type": "application/json; charset=utf-8", ...(cookie ? { Cookie: cookie } : {}), ...extraHeaders },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

const stamp = Date.now().toString().slice(-8);
const username = `smokepg${stamp}`;
const password = "test123456";
const appData = (n) => ({
  user: { name: "PG测试", streak: 0, totalQuestions: n, totalCorrect: 0, dailyGoal: 20, todayDone: 0, todayCorrect: 0, errorBook: [], knowledgeProfile: {} },
  errors: [], answeredIds: ["smoke-q1"], dailyHistory: [], studySessions: [],
});

let r = await call("POST", "/api/auth/register", { username, displayName: "PG测试", password });
check("注册", r.status === 200 && r.json.ok, `status=${r.status} ${r.json.message || ""}`);
if (r.status !== 200) { console.log("注册失败，停止"); process.exit(1); }
r = await call("GET", "/api/auth/session");
check("会话有效", r.status === 200 && JSON.stringify(r.json).includes(username), `status=${r.status}`);
r = await call("PUT", "/api/data", appData(7));
check("保存数据(第1次)", r.status === 200, `status=${r.status}`);
r = await call("PUT", "/api/data", appData(8));
check("保存数据(第2次)", r.status === 200, `status=${r.status}`);
r = await call("GET", "/api/data");
check("读回数据", r.status === 200 && r.json.data?.user?.totalQuestions === 8, `status=${r.status}`);
r = await call("GET", "/api/data");
const version = r.json.version;
check("读取返回版本号", typeof version === "number" && version >= 2, `version=${version}`);
r = await call("PUT", "/api/data", appData(9), { "If-Match": String(version) });
check("带正确版本保存成功且版本 +1", r.status === 200 && r.json.version === version + 1, `status=${r.status} version=${r.json.version}`);
r = await call("PUT", "/api/data", appData(1), { "If-Match": String(version) });
check("带旧版本保存返回 409 且附最新数据", r.status === 409 && r.json.data?.user?.totalQuestions === 9 && r.json.version === version + 1, `status=${r.status}`);
r = await call("PUT", "/api/data", appData(1), { "If-Match": "abc" });
check("版本号格式错误返回 400", r.status === 400, `status=${r.status}`);
r = await call("GET", "/api/usage");
check("用量接口", r.status === 200 && r.json.totals !== undefined, `status=${r.status}`);
r = await call("POST", "/api/auth/logout");
check("登出", r.status === 200, `status=${r.status}`);
cookie = "";
r = await call("GET", "/api/data");
check("登出后读数据被拒", r.status === 401, `status=${r.status}`);
r = await call("POST", "/api/auth/login", { username, password });
check("重新登录", r.status === 200 && r.json.ok, `status=${r.status}`);
r = await call("GET", "/api/data");
check("重新登录后数据仍在", r.status === 200 && r.json.data?.user?.totalQuestions === 9, `status=${r.status}`);

console.log(`\n测试账号：${username}`);
console.log(`接口冒烟：${pass}/${pass + fail} 通过`);
console.log(`SMOKE_API=${fail === 0 ? "PASS" : "FAIL"}`);
process.exit(fail === 0 ? 0 : 1);
