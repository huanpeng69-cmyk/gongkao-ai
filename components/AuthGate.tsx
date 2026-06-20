"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { isAuthenticated } from "@/lib/auth";

function normalizePath(value: string | null) {
  if (!value) return "/";
  const normalized = value.replace(/\/+$/, "");
  return normalized || "/";
}

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const currentPath = normalizePath(pathname);
  const isLoginPage = currentPath === "/login";

  useEffect(() => {
    if (isLoginPage) {
      setReady(true);
      return;
    }

    if (!isAuthenticated()) {
      const next = currentPath !== "/" ? `?next=${encodeURIComponent(currentPath)}` : "";
      router.replace(`/login${next}`);
      setReady(false);
      return;
    }

    setReady(true);
  }, [currentPath, isLoginPage, router]);

  if (!isLoginPage && !ready) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm" style={{ color: "var(--steel)" }}>
        正在进入学习桌...
      </div>
    );
  }

  return <>{children}</>;
}
