import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/server/auth";
import { getUsageSummary } from "@/lib/server/store";
import { requireAuth } from "@/lib/server/require-auth";

export const runtime = "nodejs";

// 仪表盘数据接口：只返回当前登录用户自己的用量聚合，不跨用户。
export async function GET() {
  if (process.env.MOBILE_EXPORT === "1") {
    return NextResponse.json({ error: "静态导出模式不支持" }, { status: 404 });
  }
  const denied = await requireAuth();
  if (denied) return denied;
  const auth = await getAuthenticatedUser();
  if (!auth) return NextResponse.json({ error: "未登录或登录已过期" }, { status: 401 });
  try {
    return NextResponse.json(await getUsageSummary(auth.record.id));
  } catch (error) {
    // 库损坏等 fail-closed 场景：如实报错，不返回空数据冒充「没有用量」。
    console.error("getUsageSummary failed:", error);
    return NextResponse.json({ error: "用量数据读取失败，数据库可能已损坏" }, { status: 500 });
  }
}
