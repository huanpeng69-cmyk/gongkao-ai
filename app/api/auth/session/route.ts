import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/server/auth";

export const runtime = "nodejs";

export async function GET() {
  if (process.env.MOBILE_EXPORT === "1") return NextResponse.json({ ok: false }, { status: 401 });
  const auth = await getAuthenticatedUser();
  if (!auth) return NextResponse.json({ ok: false }, { status: 401 });
  return NextResponse.json({ ok: true, user: auth.publicUser });
}
