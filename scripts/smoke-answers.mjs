// POST /api/answers 端到端冒烟：注册 → 作答 → 校验落库 → 校验 400/401
const base = process.argv[2] || "http://localhost:3000";
let cookie = "";
let pass = 0, fail = 0;
const check = (name, cond, extra = "") => {
  console.log(`${cond ? "OK  " : "FAIL"} ${name}${extra ? "  " + extra : ""}`);
  cond ? pass++ : fail++;
};

async function call(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { "Content-Type": "application/json; charset=utf-8", ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

const stamp = Date.now().toString().slice(-8);
const username = `ans${stamp}`;
const localDate = "2026-11-24";

// 未登录必须先被拒
let r = await call("POST", "/api/answers", { questionId: "q1", isCorrect: true, localDate });
check("未登录返回 401", r.status === 401, `status=${r.status}`);

r = await call("POST", "/api/auth/register", { username, displayName: "答题测试", password: "test123456" });
check("注册", r.status === 200 && r.json.ok, `status=${r.status}`);
if (r.status !== 200) process.exit(1);

// 正常作答
r = await call("POST", "/api/answers", {
  questionId: "yanyu-001",
  module: "言语理解与表达",
  subModule: "主旨概括",
  userAnswer: "A",
  isCorrect: true,
  minutesSpent: 0.75,
  localDate,
});
check("首次作答返回 ok 且带 id", r.status === 200 && r.json.ok === true && typeof r.json.id === "string", `status=${r.status}`);

// 复习作答（多选题数组答案）
r = await call("POST", "/api/answers", {
  questionId: "yanyu-001",
  module: "言语理解与表达",
  userAnswer: ["A", "C"],
  isCorrect: false,
  isReview: true,
  localDate,
});
check("复习作答（数组答案）成功", r.status === 200 && r.json.ok === true, `status=${r.status}`);

// 校验分支
r = await call("POST", "/api/answers", { isCorrect: true, localDate });
check("缺少 questionId 返回 400", r.status === 400, `status=${r.status}`);

r = await call("POST", "/api/answers", { questionId: "q2", isCorrect: true, localDate: "2026/11/24" });
check("localDate 格式错误返回 400", r.status === 400, `status=${r.status}`);

r = await call("POST", "/api/answers", { questionId: "q3", isCorrect: "yes", localDate });
check("isCorrect 非布尔返回 400", r.status === 400, `status=${r.status}`);

// 缺省 isReview / minutesSpent 也应能写入
r = await call("POST", "/api/answers", { questionId: "q4", isCorrect: false, localDate });
check("最小字段作答成功", r.status === 200 && r.json.ok === true, `status=${r.status}`);

console.log(`\n测试账号：${username}`);
console.log(`接口冒烟（answers）：${pass}/${pass + fail} 通过`);
console.log(`SMOKE_ANSWERS=${fail === 0 ? "PASS" : "FAIL"}`);
process.exit(fail === 0 ? 0 : 1);
