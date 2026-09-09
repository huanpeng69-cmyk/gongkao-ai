import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { deleteSession, sessionCookieName } from "@/lib/server/store";

export const runtime = "nodejs";

export async function POST() {
  const cookieStore = await cookies();
  const token = cookieStore.get(sessionCookieName)?.value;
  if (token) await deleteSession(token);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(sessionCookieName, "", { httpOnly: true, maxAge: 0, path: "/" });
  return response;
}
