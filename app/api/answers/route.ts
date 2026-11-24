import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/server/auth";
import { recordAnswer } from "@/lib/server/store";

export const runtime = "nodejs";

// 作答流水接口（阶段 2b，见 docs/decisions/2026-11-23-database-migration.md）：
//   POST /api/answers  → 追加一条作答记录，返回 { ok: true, id }
// 现阶段只写不读，为后续排名、估分、推荐积累原始数据；
// GET /api/data 的整包快照口径保持不变，客户端无需改造即可先接入。
//
// 约定：
// - localDate 由客户端给出（YYYY-MM-DD），服务端不按服务器时区猜测日期。
// - 流水写入失败不应拖垮答题主流程，因此这里捕获异常并返回 202 + stored:false，
//   让客户端继续答题，而不是把整道题判为失败。

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function unauthorized() {
  return NextResponse.json({ error: "未登录或登录已过期" }, { status: 401 });
}

type AnswerPayload = {
  questionId?: unknown;
  module?: unknown;
  subModule?: unknown;
  userAnswer?: unknown;
  isCorrect?: unknown;
  isReview?: unknown;
  minutesSpent?: unknown;
  localDate?: unknown;
};

export async function POST(request: Request) {
  if (process.env.MOBILE_EXPORT === "1") return unauthorized();
  const auth = await getAuthenticatedUser();
  if (!auth) return unauthorized();

  const body = (await request.json().catch(() => null)) as AnswerPayload | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "请求体格式不正确" }, { status: 400 });
  }

  const questionId = typeof body.questionId === "string" ? body.questionId.trim() : "";
  if (!questionId) return NextResponse.json({ error: "缺少 questionId" }, { status: 400 });

  const localDate = typeof body.localDate === "string" ? body.localDate : "";
  if (!DATE_RE.test(localDate)) {
    return NextResponse.json({ error: "localDate 必须是 YYYY-MM-DD" }, { status: 400 });
  }

  if (typeof body.isCorrect !== "boolean") {
    return NextResponse.json({ error: "isCorrect 必须是布尔值" }, { status: 400 });
  }

  // userAnswer 可能是字符串、字符串数组或布尔值；统一转成字符串存储。
  const rawAnswer = body.userAnswer;
  const userAnswer =
    rawAnswer == null
      ? null
      : Array.isArray(rawAnswer)
        ? rawAnswer.map((item) => String(item)).join(",")
        : String(rawAnswer);

  try {
    const saved = await recordAnswer({
      userId: auth.record.id,
      questionId: questionId.slice(0, 200),
      module: typeof body.module === "string" ? body.module : null,
      subModule: typeof body.subModule === "string" ? body.subModule : null,
      userAnswer,
      isCorrect: body.isCorrect,
      isReview: body.isReview === true,
      minutesSpent: typeof body.minutesSpent === "number" ? body.minutesSpent : null,
      localDate,
    });
    return NextResponse.json({ ok: true, id: saved.id });
  } catch (error) {
    // 流水是旁路数据：写失败不影响作答结果，返回 202 让客户端可选忽略。
    console.error("[api/answers] 写入作答流水失败", error);
    return NextResponse.json({ ok: false, stored: false, error: "作答记录暂未保存" }, { status: 202 });
  }
}
