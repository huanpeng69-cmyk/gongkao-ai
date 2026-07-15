"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { AGNES_BASE_URL, AGNES_NAME, AGNES_TEXT_MODEL, agnesAuthHeaders, buildAgnesChatUrl, buildAgnesModelsUrl } from "@/lib/agnes-ai";
import { buildOpenAIImageGenerationsUrl } from "@/lib/ai-endpoints";
import {
  THIRD_PARTY_IMAGE_BASE_URL,
  THIRD_PARTY_IMAGE_MODEL,
  THIRD_PARTY_IMAGE_SIZE,
  hasSavedAgnesKey,
  hasSavedImageKey,
  readSavedAiConfig,
  readSavedImageConfig,
  removeSavedAgnesKey,
  removeSavedImageKey,
  saveAiConfig,
  saveImageConfig,
} from "@/lib/default-ai-config";
import { getCurrentDisplayName, logoutUser } from "@/lib/auth";

type TestState = { status: "idle" | "testing" | "ok" | "fail"; detail: string };
const idleTest: TestState = { status: "idle", detail: "" };
const imageSizes = ["1024x1024", "1024x1536", "1536x1024"];

async function directAgnesHealth(apiKey: string) {
  if (!apiKey) throw new Error("请先保存 Agnes API Key。");
  const url = buildAgnesModelsUrl();
  if (Capacitor.isNativePlatform()) {
    const result = await CapacitorHttp.get({ url, headers: agnesAuthHeaders(apiKey), connectTimeout: 15000, readTimeout: 15000 });
    if (result.status < 200 || result.status >= 300) throw new Error(`HTTP ${result.status}，请检查 Agnes Key 或网络。`);
    return;
  }
  const result = await fetch(url, { headers: agnesAuthHeaders(apiKey), cache: "no-store" });
  if (!result.ok) throw new Error(`HTTP ${result.status}，请检查 Agnes Key、CORS 或网络。`);
}

export default function SettingsPage() {
  const [username, setUsername] = useState("");
  const [textKeyDraft, setTextKeyDraft] = useState("");
  const [hasTextKey, setHasTextKey] = useState(false);
  const [showTextKey, setShowTextKey] = useState(false);
  const [textModel, setTextModel] = useState(AGNES_TEXT_MODEL);
  const [imageBaseUrl, setImageBaseUrl] = useState(THIRD_PARTY_IMAGE_BASE_URL);
  const [imageKeyDraft, setImageKeyDraft] = useState("");
  const [hasImageKey, setHasImageKey] = useState(false);
  const [showImageKey, setShowImageKey] = useState(false);
  const [imageAuthScheme, setImageAuthScheme] = useState<"bearer" | "x-api-key">("bearer");
  const [imageModel, setImageModel] = useState(THIRD_PARTY_IMAGE_MODEL);
  const [imageSize, setImageSize] = useState(THIRD_PARTY_IMAGE_SIZE);
  const [saved, setSaved] = useState(false);
  const [textTest, setTextTest] = useState<TestState>(idleTest);
  const [imageTest, setImageTest] = useState<TestState>(idleTest);

  useEffect(() => {
    const text = readSavedAiConfig();
    const image = readSavedImageConfig();
    setUsername(getCurrentDisplayName());
    setHasTextKey(hasSavedAgnesKey());
    setTextModel(text.model);
    setImageBaseUrl(image.baseUrl);
    setHasImageKey(hasSavedImageKey());
    setImageAuthScheme(image.authScheme);
    setImageModel(image.model);
    setImageSize(image.size);
  }, []);

  const save = () => {
    saveAiConfig({ apiKey: textKeyDraft, model: textModel });
    saveImageConfig({ baseUrl: imageBaseUrl, apiKey: imageKeyDraft, authScheme: imageAuthScheme, model: imageModel, size: imageSize });
    setHasTextKey(hasSavedAgnesKey());
    setHasImageKey(hasSavedImageKey());
    setTextKeyDraft("");
    setImageKeyDraft("");
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  const testText = async () => {
    setTextTest({ status: "testing", detail: "正在执行非计费检测…" });
    try {
      await directAgnesHealth(textKeyDraft.trim() || readSavedAiConfig().apiKey);
      setTextTest({ status: "ok", detail: "Agnes 文字接口连接正常。" });
    } catch (error) {
      setTextTest({ status: "fail", detail: error instanceof Error ? error.message : String(error) });
    }
  };

  const testImage = () => {
    const image = readSavedImageConfig();
    const activeKey = imageKeyDraft.trim() || image.apiKey;
    if (!imageBaseUrl.trim() || !imageModel.trim() || !activeKey) {
      setImageTest({ status: "fail", detail: "请填写第三方图片 Base URL、API Key 和图片模型。" });
      return;
    }
    setImageTest({ status: "ok", detail: "图片接口配置完整；为避免扣费，未实际生成测试图片。" });
  };

  const deleteTextKey = () => {
    if (!confirm("确定删除保存在此设备上的 Agnes API Key 吗？")) return;
    removeSavedAgnesKey();
    setHasTextKey(false);
    setTextTest(idleTest);
  };

  const deleteImageKey = () => {
    if (!confirm("确定删除保存在此设备上的图片 API Key 吗？")) return;
    removeSavedImageKey();
    setHasImageKey(false);
    setImageTest(idleTest);
  };

  const handleLogout = () => {
    logoutUser();
    window.location.href = "/login";
  };

  return (
    <div className="min-h-screen" style={{ background: "var(--surface)" }}>
      <header className="h-14 flex items-center px-4 md:px-7 border-b" style={{ background: "var(--canvas)", borderColor: "var(--hairline)" }}>
        <Link href="/" className="font-bold" style={{ color: "var(--primary)" }}>公考AI私教</Link>
        <div className="ml-auto flex items-center gap-3 text-sm" style={{ color: "var(--steel)" }}><span>{username}</span><button onClick={handleLogout}>退出</button></div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-7">
        <section className="rounded-2xl p-6 mb-5 text-white" style={{ background: "linear-gradient(135deg, #315efb, #5b7cfa)" }}>
          <h1 className="text-2xl font-bold">AI 接口设置</h1>
          <p className="text-sm mt-2 opacity-85">文字讲解继续使用 Agnes；漫画生图已恢复原来的第三方 OpenAI 兼容接口。</p>
        </section>

        <div className="grid lg:grid-cols-2 gap-5 mb-5">
          <ConfigCard title="文字讲解" subtitle="Agnes 错因分析、题目解析与私教问答" endpoint={buildAgnesChatUrl()} test={textTest} onTest={testText}>
            <ReadOnlyField label="供应商" value={AGNES_NAME} />
            <ReadOnlyField label="Base URL" value={AGNES_BASE_URL} mono />
            <TextInput label="文字模型" value={textModel} onChange={setTextModel} placeholder={AGNES_TEXT_MODEL} />
            <SecretInput label="Agnes API Key" value={textKeyDraft} onChange={setTextKeyDraft} show={showTextKey} onToggle={() => setShowTextKey((v) => !v)} hasSaved={hasTextKey} onDelete={deleteTextKey} />
          </ConfigCard>

          <ConfigCard title="漫画生图" subtitle="原第三方图片接口 · OpenAI 兼容协议" endpoint={buildOpenAIImageGenerationsUrl(imageBaseUrl)} test={imageTest} onTest={testImage}>
            <TextInput label="图片 Base URL" value={imageBaseUrl} onChange={setImageBaseUrl} placeholder={THIRD_PARTY_IMAGE_BASE_URL} />
            <SecretInput label="图片 API Key" value={imageKeyDraft} onChange={setImageKeyDraft} show={showImageKey} onToggle={() => setShowImageKey((v) => !v)} hasSaved={hasImageKey} onDelete={deleteImageKey} />
            <div className="grid grid-cols-3 gap-3">
              <SelectField label="认证" value={imageAuthScheme} values={["bearer", "x-api-key"]} onChange={(v) => setImageAuthScheme(v as "bearer" | "x-api-key")} />
              <TextInput label="图片模型" value={imageModel} onChange={setImageModel} placeholder={THIRD_PARTY_IMAGE_MODEL} />
              <SelectField label="尺寸" value={imageSize} values={imageSizes} onChange={setImageSize} />
            </div>
          </ConfigCard>
        </div>

        <section className="rounded-xl p-5 mb-5 flex items-center justify-between gap-4" style={{ background: "var(--canvas)", border: "1px solid var(--hairline)" }}>
          <div><h3 className="font-semibold" style={{ color: "var(--ink)" }}>保存接口配置</h3><p className="text-xs mt-1" style={{ color: "var(--steel)" }}>文字和图片密钥分别保存；密钥输入留空不会覆盖已有值。</p></div>
          <button onClick={save} className="px-6 py-2.5 rounded-lg text-sm font-semibold text-white" style={{ background: saved ? "var(--brand-green)" : "var(--primary)" }}>{saved ? "已保存" : "保存配置"}</button>
        </section>

        <section className="rounded-xl p-5 mb-6" style={{ background: "var(--canvas)", border: "1px solid var(--hairline)" }}>
          <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--ink)" }}>应用内代理</h3>
          <ApiRow method="POST" route="/api/ai" desc="Agnes 文字讲解" />
          <ApiRow method="POST" route="/api/image" desc="第三方漫画生图" />
        </section>
        <div className="text-center"><Link href="/" className="text-sm" style={{ color: "var(--primary)" }}>返回首页</Link></div>
      </main>
    </div>
  );
}

function ReadOnlyField({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div className="mb-3"><label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--slate)" }}>{label}</label><div className={`h-10 px-3.5 rounded-lg border flex items-center text-sm ${mono ? "font-mono" : ""}`} style={{ borderColor: "var(--hairline)", background: "var(--surface)", color: "var(--steel)" }}>{value}</div></div>;
}
function TextInput({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder: string }) {
  return <div className="mb-3"><label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--slate)" }}>{label}</label><input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="w-full h-10 px-3.5 rounded-lg text-sm border outline-none" style={{ borderColor: "var(--hairline-strong)", background: "var(--surface)", color: "var(--ink)" }} /></div>;
}
function SecretInput({ label, value, onChange, show, onToggle, hasSaved, onDelete }: { label: string; value: string; onChange: (value: string) => void; show: boolean; onToggle: () => void; hasSaved: boolean; onDelete: () => void }) {
  return <div className="mb-3"><label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--slate)" }}>{label}</label><div className="flex gap-2"><input type={show ? "text" : "password"} value={value} onChange={(e) => onChange(e.target.value)} placeholder={hasSaved ? "已保存；留空表示保留" : "粘贴 API Key"} autoComplete="off" className="min-w-0 flex-1 h-10 px-3.5 rounded-lg text-sm border outline-none" style={{ borderColor: "var(--hairline-strong)", background: "var(--surface)", color: "var(--ink)" }} /><button onClick={onToggle} className="px-3 rounded-lg border text-xs" style={{ borderColor: "var(--hairline-strong)", color: "var(--slate)" }}>{show ? "隐藏" : "显示"}</button>{hasSaved && <button onClick={onDelete} className="px-3 rounded-lg border text-xs" style={{ borderColor: "var(--error)", color: "var(--error)" }}>删除</button>}</div></div>;
}
function SelectField({ label, value, values, onChange }: { label: string; value: string; values: string[]; onChange: (value: string) => void }) {
  return <div className="mb-3"><label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--slate)" }}>{label}</label><select value={value} onChange={(e) => onChange(e.target.value)} className="w-full h-10 px-3 rounded-lg text-sm border" style={{ borderColor: "var(--hairline-strong)", background: "var(--surface)", color: "var(--ink)" }}>{values.map((item) => <option key={item} value={item}>{item}</option>)}</select></div>;
}
function ConfigCard({ title, subtitle, endpoint, test, onTest, children }: { title: string; subtitle: string; endpoint: string; test: TestState; onTest: () => void; children: React.ReactNode }) {
  const color = test.status === "ok" ? "var(--brand-green)" : test.status === "fail" ? "var(--error)" : "var(--steel)";
  return <section className="rounded-xl p-5" style={{ background: "var(--canvas)", border: "1px solid var(--hairline)" }}><div className="flex items-start justify-between gap-3 mb-4"><div><h3 className="font-semibold" style={{ color: "var(--ink)" }}>{title}</h3><p className="text-xs mt-1" style={{ color: "var(--steel)" }}>{subtitle}</p></div><button onClick={onTest} className="px-3 py-1.5 rounded-lg text-xs font-semibold border" style={{ borderColor: color, color }}>测试连接</button></div>{children}<div className="mt-3 p-3 rounded-lg font-mono text-[11px] break-all" style={{ background: "var(--surface)", color: "var(--steel)" }}>POST {endpoint}</div>{test.detail && <p className="text-xs mt-3" style={{ color }}>{test.detail}</p>}</section>;
}
function ApiRow({ method, route, desc }: { method: string; route: string; desc: string }) {
  return <div className="flex items-center gap-3 px-3 py-2.5 mt-2 rounded-lg" style={{ background: "var(--surface)" }}><span className="text-xs font-bold" style={{ color: "var(--brand-green)" }}>{method}</span><code className="text-xs font-semibold" style={{ color: "var(--ink)" }}>{route}</code><span className="text-xs ml-auto" style={{ color: "var(--steel)" }}>{desc}</span></div>;
}
