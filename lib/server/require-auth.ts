import "server-only";

import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "./auth";

/**
 * 会话鉴权 guard：AI / 生图这类「会消耗服务端 API Key」的接口必须已登录。
 *
 * 默认（未设 GONGKAO_ALLOW_ANON_AI）：无会话 → 401。
 * 过渡开关 GONGKAO_ALLOW_ANON_AI=1：允许匿名调用（回退到旧的开放行为）。
 *
 * 用法：handler 顶部
 *   const denied = await requireAuth();
 *   if (denied) return denied;
 *
 * 返回 null = 放行；返回 Response = 应直接 return 该响应。
 */
export async function requireAuth(): Promise<Response | null> {
  if (process.env.GONGKAO_ALLOW_ANON_AI === "1") return null;
  const auth = await getAuthenticatedUser();
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  return null;
}
