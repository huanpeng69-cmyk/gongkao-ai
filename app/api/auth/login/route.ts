import { NextResponse } from "next/server";
import { createSession, publicUser, sessionCookieName, verifyUser } from "@/lib/server/store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  if (typeof body.username !== "string" || typeof body.password !== "string") {
    return NextResponse.json({ ok: false, message: "请输入账号和密码" }, { status: 400 });
  }

  const user = await verifyUser(body.username, body.password);
  if (!user) return NextResponse.json({ ok: false, message: "账号或密码不正确" }, { status: 401 });

  const session = await createSession(user.id);
  const response = NextResponse.json({ ok: true, user: publicUser(user) });
  response.cookies.set(sessionCookieName, session.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: session.maxAge,
    path: "/",
  });
  return response;
}
