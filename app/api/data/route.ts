import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/server/auth";
import { getUserData, saveUserData } from "@/lib/server/store";
import type { AppData } from "@/lib/types";

export const runtime = "nodejs";

function unauthorized() {
  return NextResponse.json({ error: "未登录或登录已过期" }, { status: 401 });
}

export async function GET() {
  if (process.env.MOBILE_EXPORT === "1") return unauthorized();
  const auth = await getAuthenticatedUser();
  if (!auth) return unauthorized();
  return NextResponse.json({ data: await getUserData(auth.record.id) });
}

export async function PUT(request: Request) {
  if (process.env.MOBILE_EXPORT === "1") return unauthorized();
  const auth = await getAuthenticatedUser();
  if (!auth) return unauthorized();
  const data = await request.json().catch(() => null) as AppData | null;
  if (!data || typeof data !== "object" || !data.user || !Array.isArray(data.errors) || !Array.isArray(data.dailyHistory)) {
    return NextResponse.json({ error: "用户数据格式不正确" }, { status: 400 });
  }
  if (JSON.stringify(data).length > 8_000_000) return NextResponse.json({ error: "用户数据超过8MB限制" }, { status: 413 });
  data.user.name = auth.record.displayName;
  await saveUserData(auth.record.id, data);
  return NextResponse.json({ ok: true });
}
