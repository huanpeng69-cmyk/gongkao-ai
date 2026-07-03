import type { Metadata, Viewport } from "next";
import "./globals.css";
import Sidebar from "@/components/Sidebar";
import BottomNav from "@/components/BottomNav";
import ToastContainer from "@/components/Toast";
import AuthGate from "@/components/AuthGate";

export const metadata: Metadata = {
  title: "公考私教",
  description: "真题题库、模考训练、错题复习、资料分析工具和 AI 讲解一体化学习应用",
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
