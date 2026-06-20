import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

/**
 * GET /api/gkzhenti
 * 返回公考真题库数据，支持分页和按模块筛选
 * 查询参数:
 *   - module: 按模块筛选 (changshi/yanyu/shuliang/panduan/ziliao)
 *   - limit: 返回数量限制 (默认20)
 *   - offset: 偏移量 (默认0)
 *   - paper: 按试卷标题筛选
 *   - stats: 只返回统计信息
 */
export async function GET(req: Request) {
  if (process.env.MOBILE_EXPORT === "1") {
    return NextResponse.json({
      questions: [],
      total: 0,
      note: "Mobile builds load /mobile-data/gkzhenti_questions.min.json directly.",
    });
  }

  const url = new URL(req.url);
  const moduleFilter = url.searchParams.get("module") || "";
  const limit = parseInt(url.searchParams.get("limit") || "20", 10);
  const offset = parseInt(url.searchParams.get("offset") || "0", 10);
  const paperFilter = url.searchParams.get("paper") || "";
  const statsOnly = url.searchParams.get("stats") === "1";

  // 读取真题数据文件
  const dataPath = path.join(process.cwd(), "data", "gkzhenti_questions.json");

  if (!fs.existsSync(dataPath)) {
    return NextResponse.json({
      error: "真题数据文件不存在，请先运行抓取脚本",
      questions: [],
      total: 0,
    });
  }

  try {
    const raw = fs.readFileSync(dataPath, "utf-8");
    const data = JSON.parse(raw);
    let questions = data.questions || [];

    // 按模块筛选
    if (moduleFilter) {
      questions = questions.filter(
        (q: { moduleKey?: string }) => q.moduleKey === moduleFilter
      );
    }

    // 按试卷筛选
    if (paperFilter) {
      questions = questions.filter(
        (q: { sourceTitle?: string }) =>
          q.sourceTitle && q.sourceTitle.includes(paperFilter)
      );
    }

    const total = questions.length;

    // 只返回统计信息
    if (statsOnly) {
      const moduleCounts: Record<string, number> = {};
      const paperSet = new Set<string>();
      questions.forEach((q: { module?: string; sourceTitle?: string }) => {
        const mod = q.module || "未分类";
        moduleCounts[mod] = (moduleCounts[mod] || 0) + 1;
        if (q.sourceTitle) paperSet.add(q.sourceTitle);
      });

      return NextResponse.json({
        meta: data.meta,
        total,
        moduleCounts,
        paperCount: paperSet.size,
        papers: Array.from(paperSet),
      });
    }

    // 分页
    const paged = questions.slice(offset, offset + limit);

    return NextResponse.json({
      meta: data.meta,
      questions: paged,
      total,
      offset,
      limit,
    });
  } catch (err) {
    console.error("Failed to read gkzhenti data:", err);
    return NextResponse.json({ error: "读取真题数据失败" }, { status: 500 });
  }
}
