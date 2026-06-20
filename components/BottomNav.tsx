"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { getReviewPlan } from "@/lib/store";

const tabs = [
  { href: "/", label: "学习", icon: "⌂" },
  { href: "/quiz", label: "题库", icon: "▤" },
  { href: "/mock", label: "刷题", icon: "✎", center: true },
  { href: "/toolbox", label: "宝箱", icon: "▣" },
  { href: "/review", label: "计划", icon: "□" },
  { href: "/settings", label: "我的", icon: "○" },
];

const mobileTabs = [
  { href: "/", label: "\u5b66\u4e60", icon: "\u2302" },
  { href: "/quiz", label: "\u9898\u5e93", icon: "\u2630" },
  { href: "/mock", label: "\u6a21\u8003", icon: "\u270e", center: true },
  { href: "/toolbox", label: "\u5b9d\u7bb1", icon: "\u25a3" },
  { href: "/review", label: "\u8ba1\u5212", icon: "\u25a1" },
  { href: "/settings", label: "\u6211\u7684", icon: "\u25cb" },
];

export default function BottomNav() {
  const pathname = usePathname();
  const [dueCount, setDueCount] = useState(0);

  useEffect(() => {
    const plan = getReviewPlan();
    setDueCount(plan.dueToday);
  }, [pathname]);

  if ((pathname || "").replace(/\/+$/, "") === "/login") return null;

  return (
    <nav className="mobile-bottom-nav fixed left-0 right-0 z-50 md:hidden">
      <div className="mobile-bottom-inner">
        {mobileTabs.map((tab) => {
          const active = pathname === tab.href;
          const showBadge = tab.href === "/review" && dueCount > 0;
          return (
            <Link key={tab.href} href={tab.href} className={`mobile-bottom-item ${active ? "is-active" : ""} ${tab.center ? "is-center" : ""}`}>
              <span className="mobile-bottom-icon">{tab.icon}</span>
              <span className="mobile-bottom-label">{tab.label}</span>
              {showBadge && (
                <span className="mobile-bottom-badge">{dueCount}</span>
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
