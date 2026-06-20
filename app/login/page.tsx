"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getCurrentDisplayName, isAuthenticated, loginUser, logoutUser, registerUser } from "@/lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [loggedInName, setLoggedInName] = useState("");

  useEffect(() => {
    if (isAuthenticated()) setLoggedInName(getCurrentDisplayName());
  }, []);

  const goNext = () => {
    const params = new URLSearchParams(window.location.search);
    router.replace(params.get("next") || "/");
  };

  const switchMode = (nextMode: "login" | "register") => {
    setMode(nextMode);
    setError("");
    setPassword("");
    setConfirmPassword("");
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      const result = mode === "register"
        ? await registerUser({ username, displayName, password, confirmPassword })
        : await loginUser({ username, password });

      if (!result.ok) {
        setError(result.message || "操作失败");
        return;
      }

      goNext();
    } finally {
      setSubmitting(false);
    }
  };

  const handleSwitchAccount = () => {
    logoutUser();
    setLoggedInName("");
    setUsername("");
    setPassword("");
    setConfirmPassword("");
    setError("");
  };

  if (loggedInName) {
    return (
      <div className="login-screen">
        <div className="login-card">
          <BrandBlock />
          <div className="rounded-2xl p-4 mb-4" style={{ background: "var(--tint-mint)", color: "var(--brand-green)" }}>
            <div className="text-sm font-bold">已登录：{loggedInName}</div>
            <div className="text-xs mt-1">可以直接继续学习，也可以切换到另一个账号。</div>
          </div>
          <button onClick={goNext} className="primary-button w-full h-11 rounded-xl text-sm font-semibold">进入学习桌</button>
          <button onClick={handleSwitchAccount} className="ghost-button w-full h-11 rounded-xl text-sm font-semibold mt-3">切换账号</button>
        </div>
      </div>
    );
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <BrandBlock />

        <div className="login-tabs">
          <button type="button" onClick={() => switchMode("login")} className={mode === "login" ? "is-active" : ""}>登录</button>
          <button type="button" onClick={() => switchMode("register")} className={mode === "register" ? "is-active" : ""}>注册</button>
        </div>

        <form onSubmit={handleSubmit}>
          <label className="login-label">账号</label>
          <input
            type="text"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="用户名、手机号或邮箱"
            autoComplete="username"
            className="login-input"
          />

          {mode === "register" && (
            <>
              <label className="login-label">昵称</label>
              <input
                type="text"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="显示在首页的名字"
                autoComplete="nickname"
                className="login-input"
              />
            </>
          )}

          <label className="login-label">密码</label>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="至少6位"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            className="login-input"
          />

          {mode === "register" && (
            <>
              <label className="login-label">确认密码</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="再输入一次密码"
                autoComplete="new-password"
                className="login-input"
              />
            </>
          )}

          {error && <div className="login-error">{error}</div>}

          <button type="submit" disabled={submitting} className="primary-button w-full h-11 rounded-xl text-sm font-semibold disabled:opacity-60">
            {submitting ? "处理中..." : mode === "login" ? "登录" : "注册并开始学习"}
          </button>
        </form>

        <p className="text-center text-xs mt-4" style={{ color: "var(--stone)" }}>
          {mode === "login" ? "还没有账号？" : "已经注册过？"}
          <button type="button" onClick={() => switchMode(mode === "login" ? "register" : "login")} className="ml-1 font-bold" style={{ color: "var(--primary)" }}>
            {mode === "login" ? "创建新账号" : "返回登录"}
          </button>
        </p>
      </div>
    </div>
  );
}

function BrandBlock() {
  return (
    <div className="text-center mb-7">
      <div className="login-logo">书</div>
      <h1 className="text-2xl font-black" style={{ color: "var(--ink)" }}>公考私教</h1>
      <p className="text-sm mt-1" style={{ color: "var(--steel)" }}>每个人一套独立错题本和复习计划</p>
    </div>
  );
}
