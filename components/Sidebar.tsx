"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { getReviewPlan } from "@/lib/store";
import { getCurrentDisplayName } from "@/lib/auth";

const navItems = [
  { href: "/", label: "学习主页", icon: "⌂", tone: "var(--primary)" },
  { href: "/quiz", label: "真题题库", icon: "✓", tone: "var(--brand-teal)" },
  { href: "/mock", label: "真题模考", icon: "90", tone: "var(--link-blue)" },
  { href: "/toolbox", label: "备考百宝箱", icon: "▣", tone: "var(--brand-orange)" },
  { href: "/review", label: "复习计划", icon: "↻", tone: "var(--link-blue)" },
  { href: "/stats", label: "数据统计", icon: "%", tone: "var(--brand-green)" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [username, setUsername] = useState("");
  const [dueToday, setDueToday] = useState(0);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setUsername(getCurrentDisplayName());
    setDueToday(getReviewPlan().dueToday);
    setCollapsed(localStorage.getItem("gongkao-sidebar-collapsed") === "1");
  }, []);

  useEffect(() => {
    document.documentElement.dataset.sidebarCollapsed = collapsed ? "1" : "0";
    localStorage.setItem("gongkao-sidebar-collapsed", collapsed ? "1" : "0");
  }, [collapsed]);

  if (pathname === "/login") return null;

  return (
    <aside
      className="app-sidebar fixed top-0 left-0 bottom-0 z-50 flex flex-col"
      style={{ width: collapsed ? 76 : 260, background: "linear-gradient(180deg, #eef8f1 0%, #f7fbf6 58%, #edf7f1 100%)", borderRight: "1px solid rgba(217,230,220,0.95)" }}
    >
      <div className="flex items-center gap-3 px-5 py-5">
        <Link href="/" className="flex items-center justify-center shrink-0" style={{ width: 34, height: 34, borderRadius: 11, background: "rgba(253,255,251,0.72)", border: "1px solid rgba(217,230,220,0.86)" }}>
          <span className="grid grid-cols-2 gap-0.5" aria-hidden="true">
            <span className="block w-2 h-2 rounded-full" style={{ background: "var(--brand-orange)" }} />
            <span className="block w-2 h-2 rounded-full" style={{ background: "var(--tint-yellow-bold)" }} />
            <span className="block w-2 h-2 rounded-full" style={{ background: "var(--link-blue)" }} />
            <span className="block w-2 h-2 rounded-full" style={{ background: "var(--primary)" }} />
          </span>
        </Link>
        {!collapsed && <div>
          <div className="text-sm font-bold" style={{ color: "var(--ink)" }}>公考私教</div>
          <div className="text-xs font-medium" style={{ color: "var(--steel)" }}>AI Study Desk</div>
        </div>}
        <button
          onClick={() => setCollapsed((value) => !value)}
          className="ml-auto w-8 h-8 rounded-lg border text-xs"
          title={collapsed ? "展开侧栏" : "收起侧栏"}
          style={{ borderColor: "rgba(183,201,189,0.7)", color: "var(--steel)", background: "rgba(253,255,251,0.72)" }}
        >
          {collapsed ? "›" : "‹"}
        </button>
      </div>

      {!collapsed && (
        <div className="mx-4 mb-3 p-4 rounded-2xl" style={{ background: "rgba(253,255,251,0.78)", border: "1px solid rgba(217,230,220,0.8)", boxShadow: "0 12px 24px rgba(55,98,78,0.06)" }}>
          <div className="mx-auto mb-3 flex items-center justify-center text-lg font-bold rounded-full" style={{ width: 54, height: 54, background: "linear-gradient(135deg, var(--primary), var(--link-blue))", color: "white" }}>
            {username.charAt(0).toUpperCase() || "学"}
          </div>
          <div className="text-center text-sm font-bold" style={{ color: "var(--ink)" }}>{username || "未登录"}</div>
          <div className="text-center text-xs mt-0.5" style={{ color: "var(--steel)" }}>今日专注刷题</div>
        </div>
      )}

      <nav className="flex-1 overflow-y-auto px-3 py-2">
        {!collapsed && <div className="px-3 pb-2 text-xs font-bold" style={{ color: "var(--stone)" }}>学习工作台</div>}
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors mb-1"
              title={item.label}
              style={{
                color: isActive ? "var(--ink)" : "var(--slate)",
                background: isActive ? "rgba(253,255,251,0.96)" : "transparent",
                boxShadow: isActive ? "0 10px 22px rgba(55,98,78,0.08)" : "none",
                border: isActive ? "1px solid rgba(217,230,220,0.92)" : "1px solid transparent",
                fontWeight: isActive ? 700 : 500,
                justifyContent: collapsed ? "center" : "flex-start",
              }}
            >
              <span className="w-7 h-7 rounded-lg flex items-center justify-center text-sm font-bold shrink-0" style={{ background: isActive ? item.tone : "rgba(253,255,251,0.68)", color: isActive ? "white" : item.tone }}>
                {item.icon}
              </span>
              {!collapsed && <span className="flex-1">{item.label}</span>}
              {!collapsed && item.href === "/review" && dueToday > 0 && (
                <span className="text-xs font-semibold px-1.5 py-0.5 rounded-full text-white" style={{ background: "var(--brand-orange)" }}>
                  {dueToday}
                </span>
              )}
            </Link>
          );
        })}

        {dueToday > 0 && (
          <>
            {!collapsed && <div className="px-3 pt-6 pb-1.5 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--stone)" }}>今日复习</div>}
            <Link
              href="/review"
              className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium"
              title={`待复习 ${dueToday} 题`}
              style={{ color: "var(--brand-orange)", background: "rgba(255,232,221,0.82)", justifyContent: collapsed ? "center" : "flex-start", border: "1px solid rgba(229,111,78,0.12)" }}
            >
              <span className="w-7 h-7 rounded-lg flex items-center justify-center text-sm font-bold" style={{ background: "var(--brand-orange)", color: "white" }}>↻</span>
              {!collapsed && <span className="flex-1">待复习 {dueToday} 题</span>}
            </Link>
          </>
        )}
      </nav>

      <div className="px-3 py-3" style={{ borderTop: "1px solid rgba(217,230,220,0.72)" }}>
        <Link href="/settings" title="系统设置" className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium" style={{ color: "var(--slate)", justifyContent: collapsed ? "center" : "flex-start", background: "rgba(253,255,251,0.54)" }}>
          <span className="w-7 h-7 rounded-lg flex items-center justify-center text-sm font-bold" style={{ background: "rgba(253,255,251,0.78)", color: "var(--steel)" }}>⚙</span>
          {!collapsed && <span>系统设置</span>}
        </Link>
      </div>

      <div className="px-4 py-4" style={{ borderTop: "1px solid rgba(217,230,220,0.72)" }}>
        {!collapsed ? (
          <div className="text-xs leading-relaxed" style={{ color: "var(--steel)" }}>
            公考学习节奏：先做题，再复盘，最后按曲线复习。
          </div>
        ) : (
          <div className="mx-auto w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold" style={{ background: "var(--tint-mint)", color: "var(--primary)" }}>
            {username.charAt(0).toUpperCase() || "学"}
          </div>
        )}
      </div>
    </aside>
  );
}
