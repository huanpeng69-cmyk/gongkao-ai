"use client";

import { useState, useEffect, useCallback } from "react";

interface ToastMessage {
  id: number;
  text: string;
  type: "success" | "error" | "info";
}

let toastId = 0;
let listeners: ((msg: ToastMessage) => void)[] = [];

export function showToast(text: string, type: "success" | "error" | "info" = "success") {
  const msg = { id: ++toastId, text, type };
  listeners.forEach((fn) => fn(msg));
}

export default function ToastContainer() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const addToast = useCallback((msg: ToastMessage) => {
    setToasts((prev) => [...prev, msg]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== msg.id)), 3000);
  }, []);

  useEffect(() => {
    listeners.push(addToast);
    return () => { listeners = listeners.filter((fn) => fn !== addToast); };
  }, [addToast]);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 md:right-4 right-4" style={{ maxWidth: 320 }}>
      {toasts.map((t) => (
        <div key={t.id} className="toast-enter px-4 py-3 rounded-lg shadow-lg text-sm font-medium flex items-center gap-2"
          style={{
            background: t.type === "success" ? "var(--brand-green)" : t.type === "error" ? "var(--error)" : "var(--ink)",
            color: "white",
          }}>
          <span>{t.type === "success" ? "✓" : t.type === "error" ? "✕" : "ℹ"}</span>
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}
