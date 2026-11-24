"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { checkSession } from "@/lib/auth";
import { DATA_SYNCED_EVENT, hydrateData } from "@/lib/store";
import { showToast } from "@/components/Toast";

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

  // 保存时发现其它设备已更新：store 已自动合并两边进度，这里只提示一下。
  useEffect(() => {
    const onSynced = () => showToast("已同步其他设备的学习进度", "info");
    window.addEventListener(DATA_SYNCED_EVENT, onSynced);
    return () => window.removeEventListener(DATA_SYNCED_EVENT, onSynced);
  }, []);

  useEffect(() => {
    if (isLoginPage) {
      setReady(true);
      return;
    }

    let cancelled = false;

    async function validateSession() {
      const authenticated = await checkSession();
      if (cancelled) return;
      if (!authenticated) {
        const next = currentPath !== "/" ? `?next=${encodeURIComponent(currentPath)}` : "";
        router.replace(`/login${next}`);
        setReady(false);
        return;
      }
      await hydrateData();
      if (!cancelled) setReady(true);
    }

    validateSession();
    return () => {
      cancelled = true;
    };
  }, [currentPath, isLoginPage, router]);

  if (!isLoginPage && !ready) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm" style={{ color: "var(--steel)" }}>
        正在进入公考私教...
      </div>
    );
  }

  return <>{children}</>;
}
