import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/server/auth";
import { getUserDataWithVersion, saveUserData, saveUserDataVersioned } from "@/lib/server/store";
import type { AppData } from "@/lib/types";

export const runtime = "nodejs";

// 学习数据接口契约（阶段 2a，见 docs/decisions/2026-11-23-database-migration.md）：
//   GET                    → { data: AppData | null, version }（无数据时 version=0）
//   PUT + If-Match: <版本>  → 版本一致才保存，返回 { ok: true, version }；
//                             不一致返回 409 { error, data, version }（附服务端最新数据，客户端据此重放本机操作）
//   PUT 不带 If-Match       → 兼容旧客户端（如已安装的 APK），无条件保存；版本照样 +1，让其它设备感知到变化

function unauthorized() {
  return NextResponse.json({ error: "未登录或登录已过期" }, { status: 401 });
}

function parseIfMatch(value: string | null): number | null | "invalid" {
  if (value === null) return null;
  const match = /^\s*(?:W\/)?"?(\d{1,10})"?\s*$/.exec(value);
  return match ? Number(match[1]) : "invalid";
}

export async function GET() {
  if (process.env.MOBILE_EXPORT === "1") return unauthorized();
  const auth = await getAuthenticatedUser();
  if (!auth) return unauthorized();
  const current = await getUserDataWithVersion(auth.record.id);
  return NextResponse.json({ data: current?.data ?? null, version: current?.version ?? 0 });
}

export async function PUT(request: Request) {
  if (process.env.MOBILE_EXPORT === "1") return unauthorized();
  const auth = await getAuthenticatedUser();
  if (!auth) return unauthorized();
  const expectedVersion = parseIfMatch(request.headers.get("if-match"));
  if (expectedVersion === "invalid") return NextResponse.json({ error: "If-Match 版本号格式不正确" }, { status: 400 });
  const data = await request.json().catch(() => null) as AppData | null;
  if (!data || typeof data !== "object" || !data.user || !Array.isArray(data.errors) || !Array.isArray(data.dailyHistory)) {
    return NextResponse.json({ error: "用户数据格式不正确" }, { status: 400 });
  }
  if (JSON.stringify(data).length > 8_000_000) return NextResponse.json({ error: "用户数据超过8MB限制" }, { status: 413 });
  data.user.name = auth.record.displayName;

  if (expectedVersion === null) {
    const version = await saveUserData(auth.record.id, data);
    return NextResponse.json({ ok: true, version });
  }

  const result = await saveUserDataVersioned(auth.record.id, data, expectedVersion);
  if (!result.ok) {
    const current = await getUserDataWithVersion(auth.record.id);
    return NextResponse.json(
      { error: "学习数据已在其他设备更新", data: current?.data ?? null, version: current?.version ?? 0 },
      { status: 409 },
    );
  }
  return NextResponse.json({ ok: true, version: result.version });
}
