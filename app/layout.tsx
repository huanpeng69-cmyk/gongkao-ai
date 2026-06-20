import type { Metadata, Viewport } from "next";
import "./globals.css";
import Sidebar from "@/components/Sidebar";
import BottomNav from "@/components/BottomNav";
import ToastContainer from "@/components/Toast";
import AuthGate from "@/components/AuthGate";

export const metadata: Metadata = {
  title: "公考智学 — AI驱动的公务员考试学习系统",
  description: "错题闭环 · 笔航秒杀 · 智能刷题 · 公共基础知识",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <AuthGate>
          <div className="flex min-h-screen">
            <div className="hidden md:block"><Sidebar /></div>
            <main className="app-main flex-1 min-w-0 w-full pb-16 md:pb-0">{children}</main>
            <BottomNav />
            <ToastContainer />
          </div>
        </AuthGate>
      </body>
    </html>
  );
}
