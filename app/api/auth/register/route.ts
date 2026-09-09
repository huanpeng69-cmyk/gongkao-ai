import { NextResponse } from "next/server";
import { createSession, createUser, publicUser, sessionCookieName, validateCredentials } from "@/lib/server/store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const error = validateCredentials(body);
  if (error) return NextResponse.json({ ok: false, message: error }, { status: 400 });

  const result = await createUser({ username: body.username, displayName: body.displayName || body.username, password: body.password });
  if (!result.ok) return NextResponse.json(result, { status: 409 });

  const session = await createSession(result.user.id);
  const response = NextResponse.json({ ok: true, user: publicUser(result.user) });
  response.cookies.set(sessionCookieName, session.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: session.maxAge,
    path: "/",
  });
  return response;
}
