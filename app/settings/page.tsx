"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Capacitor, CapacitorHttp } from "@capacitor/core";
import {
  AGNES_BASE_URL,
  AGNES_IMAGE_MODEL,
  AGNES_IMAGE_SIZE,
  AGNES_NAME,
  AGNES_TEXT_MODEL,
  agnesAuthHeaders,
  buildAgnesImageUrl,
  buildAgnesModelsUrl,
  buildAgnesChatUrl,
} from "@/lib/agnes-ai";
import {
  hasSavedAgnesKey,
  readSavedAiConfig,
  readSavedImageConfig,
  removeSavedAgnesKey,
  saveAiConfig,
  saveImageConfig,
} from "@/lib/default-ai-config";
import { getCurrentDisplayName, logoutUser } from "@/lib/auth";

type TestState = { status: "idle" | "testing" | "ok" | "fail"; detail: string };
type HealthPayload = { status?: string; diagnostics?: { suggestion?: string; detail?: string } };

const idleTest: TestState = { status: "idle", detail: "" };
const ratios = ["1:1", "4:3", "3:4", "16:9", "9:16"];

async function directAgnesHealth(apiKey: string): Promise<HealthPayload> {
  if (!apiKey) return { status: "misconfigured", diagnostics: { suggestion: "请先保存 Agnes API Key。" } };
  const url = buildAgnesModelsUrl();
  if (Capacitor.isNativePlatform()) {
    const result = await CapacitorHttp.get({ url, headers: agnesAuthHeaders(apiKey), connectTimeout: 15000, readTimeout: 15000 });
    return result.status >= 200 && result.status < 300
      ? { status: "ok", diagnostics: { suggestion: "Agnes 非计费连通性检测通过。" } }
      : { status: result.status === 401 || result.status === 403 ? "unauthorized" : "unreachable", diagnostics: { detail: `HTTP ${result.status}`, suggestion: "请检查 Agnes Key 或网络。" } };
  }
  const result = await fetch(url, { headers: agnesAuthHeaders(apiKey), cache: "no-store" });
  return result.ok
    ? { status: "ok", diagnostics: { suggestion: "Agnes 非计费连通性检测通过。" } }
    : { status: result.status === 401 || result.status === 403 ? "unauthorized" : "unreachable", diagnostics: { detail: `HTTP ${result.status}`, suggestion: "请检查 Agnes Key、CORS 或网络。" } };
}

export default function SettingsPage() {
  const [username, setUsername] = useState("");
  const [keyDraft, setKeyDraft] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [textModel, setTextModel] = useState(AGNES_TEXT_MODEL);
  const [imageModel, setImageModel] = useState(AGNES_IMAGE_MODEL);
  const [imageSize, setImageSize] = useState(AGNES_IMAGE_SIZE);
  const [imageRatio, setImageRatio] = useState("1:1");
  const [saved, setSaved] = useState(false);
  const [textTest, setTextTest] = useState<TestState>(idleTest);
  const [imageTest, setImageTest] = useState<TestState>(idleTest);

  useEffect(() => {
    const text = readSavedAiConfig();
    const image = readSavedImageConfig();
    setUsername(getCurrentDisplayName());
    setHasKey(hasSavedAgnesKey());
    setTextModel(text.model);
    setImageModel(image.model);
    setImageSize(image.size);
    setImageRatio(image.ratio);
  }, []);

  const save = () => {
    saveAiConfig({ apiKey: keyDraft, model: textModel });
    saveImageConfig({ apiKey: keyDraft, model: imageModel, size: imageSize, ratio: imageRatio });
    setHasKey(hasSavedAgnesKey());
    setKeyDraft("");
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  const test = async (modality: "text" | "image") => {
    const setter = modality === "text" ? setTextTest : setImageTest;
    setter({ status: "testing", detail: "正在执行非计费检测…" });
    const savedKey = readSavedAiConfig().apiKey;
    const activeKey = keyDraft.trim() || savedKey;
    try {
      const headers: Record<string, string> = modality === "image"
        ? { "x-image-key": activeKey, "x-image-model": imageModel }
        : { "x-ai-key": activeKey, "x-ai-model": textModel };
      let data: HealthPayload | null = null;
      try {
        const response = await fetch(`/api/ai/health?modality=${modality}`, { headers, cache: "no-store" });
        if ((response.headers.get("content-type") || "").includes("application/json")) data = await response.json();
      } catch {
        // Static exports and native shells do not have Next.js API routes.
      }
      data ||= await directAgnesHealth(activeKey);
      const ok = data.status === "ok";
      setter({ status: ok ? "ok" : "fail", detail: data.diagnostics?.suggestion || data.diagnostics?.detail || "检测失败" });
    } catch (error) {
      setter({ status: "fail", detail: error instanceof Error ? error.message : String(error) });
    }
  };

  const removeKey = () => {
    if (!confirm("确定删除保存在此设备上的 Agnes API Key 吗？")) return;
    removeSavedAgnesKey();
    setKeyDraft("");
    setHasKey(false);
    setTextTest(idleTest);
    setImageTest(idleTest);
  };

  return (
    <div className="min-h-screen" style={{ background: "var(--surface)" }}>
      <header className="h-14 flex items-center px-4 md:px-7 border-b" style={{ background: "var(--canvas)", borderColor: "var(--hairline)" }}>
        <div className="w-full max-w-5xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-base font-bold" style={{ color: "var(--ink)" }}>Agnes AI 接口</h1>
            <p className="text-xs" style={{ color: "var(--steel)" }}>统一配置文字讲解与漫画生图</p>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <span style={{ color: "var(--steel)" }}>{username}</span>
            <button onClick={() => { logoutUser(); window.location.href = "/login"; }} style={{ color: "var(--error)" }}>退出</button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 md:px-6 py-6 md:py-8">
        <section className="rounded-2xl p-5 md:p-6 mb-5 text-white" style={{ background: "linear-gradient(135deg, #18181b 0%, #3f3f46 52%, #166534 100%)" }}>
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-5">
            <div>
              <div className="text-xs font-semibold tracking-[0.18em] uppercase opacity-70">Single Provider</div>
              <h2 className="text-2xl font-bold mt-2">全部由 {AGNES_NAME} 驱动</h2>
              <p className="text-sm mt-2 opacity-80 max-w-2xl">固定 Agnes 官方网关与 Bearer 鉴权，不再向其他供应商发送 Key、题目或图片。</p>
            </div>
            <div className="rounded-xl px-4 py-3 bg-white/10 border border-white/15 min-w-56">
              <div className="text-xs opacity-70">连接状态</div>
              <div className="font-semibold mt-1">{hasKey ? "设备已保存 Key" : "使用服务端 Key / 尚未保存"}</div>
            </div>
          </div>
        </section>

        <section className="rounded-xl p-5 mb-5" style={{ background: "var(--canvas)", border: "1px solid var(--hairline)" }}>
          <div className="flex items-start justify-between gap-4 mb-5">
            <div>
              <h3 className="font-semibold" style={{ color: "var(--ink)" }}>连接与密钥</h3>
              <p className="text-xs mt-1" style={{ color: "var(--steel)" }}>同一 Agnes Key 同时用于文字和图片；留空保存不会覆盖已存 Key。</p>
            </div>
            <span className="text-xs px-2.5 py-1 rounded-full" style={{ background: "var(--tint-mint)", color: "var(--brand-green)" }}>Bearer</span>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <ReadOnlyField label="供应商" value={AGNES_NAME} />
            <ReadOnlyField label="Base URL" value={AGNES_BASE_URL} mono />
            <div className="md:col-span-2">
              <label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--slate)" }}>Agnes API Key</label>
              <div className="flex gap-2">
                <input type={showKey ? "text" : "password"} value={keyDraft} onChange={(event) => setKeyDraft(event.target.value)} placeholder={hasKey ? "已保存；留空表示保留" : "粘贴 Agnes API Key"} autoComplete="off" className="flex-1 h-10 px-3.5 rounded-lg text-sm border outline-none" style={{ borderColor: "var(--hairline-strong)", background: "var(--surface)", color: "var(--ink)" }} />
                <button onClick={() => setShowKey((value) => !value)} className="px-3 rounded-lg border text-xs" style={{ borderColor: "var(--hairline-strong)", color: "var(--slate)" }}>{showKey ? "隐藏" : "显示"}</button>
                {hasKey && <button onClick={removeKey} className="px-3 rounded-lg border text-xs" style={{ borderColor: "var(--error)", color: "var(--error)" }}>删除</button>}
              </div>
              <p className="text-xs mt-2" style={{ color: "var(--stone)" }}>公开网站建议只配置服务端 <code>AGNES_API_KEY</code>。设备保存用于静态站点或 Capacitor，浏览器存储并非加密保险箱。</p>
            </div>
          </div>
        </section>

        <div className="grid lg:grid-cols-2 gap-5 mb-5">
          <ConfigCard title="文字讲解" subtitle="错因分析、题目解析与私教问答" endpoint={buildAgnesChatUrl()} test={textTest} onTest={() => test("text")}>
            <TextInput label="文字模型" value={textModel} onChange={setTextModel} placeholder={AGNES_TEXT_MODEL} />
          </ConfigCard>
          <ConfigCard title="漫画生图" subtitle="Agnes Image 2.1 Flash 教学分镜" endpoint={buildAgnesImageUrl()} test={imageTest} onTest={() => test("image")}>
            <TextInput label="图片模型" value={imageModel} onChange={setImageModel} placeholder={AGNES_IMAGE_MODEL} />
            <div className="grid grid-cols-2 gap-3 mt-3">
              <SelectField label="清晰度" value={imageSize} values={["1K", "2K", "4K"]} onChange={setImageSize} />
              <SelectField label="画面比例" value={imageRatio} values={ratios} onChange={setImageRatio} />
            </div>
          </ConfigCard>
        </div>

        <section className="rounded-xl p-5 mb-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4" style={{ background: "var(--canvas)", border: "1px solid var(--hairline)" }}>
          <div>
            <h3 className="font-semibold" style={{ color: "var(--ink)" }}>保存 Agnes 配置</h3>
            <p className="text-xs mt-1" style={{ color: "var(--steel)" }}>保存模型参数；只有填写新 Key 时才更新设备密钥。</p>
          </div>
          <button onClick={save} className="px-6 py-2.5 rounded-lg text-sm font-semibold text-white" style={{ background: saved ? "var(--brand-green)" : "var(--primary)" }}>{saved ? "已保存" : "保存配置"}</button>
        </section>

        <section className="rounded-xl p-5 mb-6" style={{ background: "var(--canvas)", border: "1px solid var(--hairline)" }}>
          <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--ink)" }}>应用内代理</h3>
          <ApiRow method="POST" path="/api/ai" desc="Agnes 文字讲解" />
          <ApiRow method="POST" path="/api/image" desc="Agnes 漫画生图" />
          <ApiRow method="GET" path="/api/ai/health" desc="非计费连通性检查" />
        </section>

        <div className="text-center"><Link href="/" className="text-sm" style={{ color: "var(--primary)" }}>返回首页</Link></div>
      </main>
    </div>
  );
}

function ReadOnlyField({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div><label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--slate)" }}>{label}</label><div className={`h-10 px-3.5 rounded-lg border flex items-center text-sm ${mono ? "font-mono" : ""}`} style={{ borderColor: "var(--hairline)", background: "var(--surface)", color: "var(--steel)" }}>{value}</div></div>;
}

function TextInput({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder: string }) {
  return <div><label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--slate)" }}>{label}</label><input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="w-full h-10 px-3.5 rounded-lg text-sm border outline-none" style={{ borderColor: "var(--hairline-strong)", background: "var(--surface)", color: "var(--ink)" }} /></div>;
}

function SelectField({ label, value, values, onChange }: { label: string; value: string; values: string[]; onChange: (value: string) => void }) {
  return <div><label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--slate)" }}>{label}</label><select value={value} onChange={(event) => onChange(event.target.value)} className="w-full h-10 px-3 rounded-lg text-sm border" style={{ borderColor: "var(--hairline-strong)", background: "var(--surface)", color: "var(--ink)" }}>{values.map((item) => <option key={item}>{item}</option>)}</select></div>;
}

function ConfigCard({ title, subtitle, endpoint, test, onTest, children }: { title: string; subtitle: string; endpoint: string; test: TestState; onTest: () => void; children: React.ReactNode }) {
  const color = test.status === "ok" ? "var(--brand-green)" : test.status === "fail" ? "var(--error)" : "var(--steel)";
  return <section className="rounded-xl p-5" style={{ background: "var(--canvas)", border: "1px solid var(--hairline)" }}><div className="flex items-start justify-between gap-3 mb-4"><div><h3 className="font-semibold" style={{ color: "var(--ink)" }}>{title}</h3><p className="text-xs mt-1" style={{ color: "var(--steel)" }}>{subtitle}</p></div><button onClick={onTest} disabled={test.status === "testing"} className="px-3 py-1.5 rounded-lg text-xs font-semibold border disabled:opacity-60" style={{ borderColor: color, color }}>{test.status === "testing" ? "检测中" : "测试连接"}</button></div>{children}<div className="mt-4 p-3 rounded-lg font-mono text-[11px] break-all" style={{ background: "var(--surface)", color: "var(--steel)" }}>POST {endpoint}</div>{test.detail && <p className="text-xs mt-3" style={{ color }}>{test.detail}</p>}</section>;
}

function ApiRow({ method, path, desc }: { method: string; path: string; desc: string }) {
  return <div className="flex items-center gap-3 px-3 py-2.5 mt-2 rounded-lg" style={{ background: "var(--surface)" }}><span className="text-xs font-bold" style={{ color: "var(--brand-green)" }}>{method}</span><code className="text-xs font-semibold" style={{ color: "var(--ink)" }}>{path}</code><span className="text-xs ml-auto" style={{ color: "var(--steel)" }}>{desc}</span></div>;
}
