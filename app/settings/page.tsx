"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { buildAnthropicMessagesUrl, buildOpenAIChatCompletionsUrl, buildOpenAIImageGenerationsUrl } from "@/lib/ai-endpoints";
import { readSavedAiConfig, readSavedImageConfig, saveAiConfig, saveImageConfig } from "@/lib/default-ai-config";
import { getCurrentDisplayName, logoutUser } from "@/lib/auth";

interface ProviderConfig {
  name: string;
  baseUrl: string;
  apiKey: string;
  authScheme: "bearer" | "x-api-key";
  protocol: "openai" | "anthropic";
  model: string;
}

interface ImageConfig {
  baseUrl: string;
  apiKey: string;
  authScheme: "bearer" | "x-api-key";
  model: string;
  size: string;
}

type ApiHealthResponse = {
  status?: string;
  diagnostics?: {
    suggestion?: string;
    tests?: Array<{ name: string; status: string; detail: string }>;
  };
};

const PRESETS: Record<string, Partial<ProviderConfig>> = {
  openai: { name: "OpenAI", baseUrl: "https://api.openai.com/v1", authScheme: "bearer", protocol: "openai", model: "gpt-4o-mini" },
  anthropic: { name: "Anthropic", baseUrl: "https://api.anthropic.com", authScheme: "x-api-key", protocol: "anthropic", model: "claude-sonnet-4-20250514" },
  deepseek: { name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", authScheme: "bearer", protocol: "openai", model: "deepseek-chat" },
  qwen: { name: "通义千问", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", authScheme: "bearer", protocol: "openai", model: "qwen-plus" },
  xiaomi: { name: "小米MiMo", baseUrl: "https://token-plan-cn.xiaomimimo.com", authScheme: "bearer", protocol: "openai", model: "mimo-v2.5" },
};

const IMAGE_SIZE_OPTIONS = ["1024x1024", "1024x1536", "1536x1024"];

function getDefaultConfig(): ProviderConfig {
  if (typeof window === "undefined") {
    return { name: "", baseUrl: "", apiKey: "", authScheme: "bearer", protocol: "openai", model: "" };
  }
  return readSavedAiConfig();
}

function getDefaultImageConfig(): ImageConfig {
  if (typeof window === "undefined") {
    return { baseUrl: "", apiKey: "", authScheme: "bearer", model: "gpt-image-1", size: "1024x1024" };
  }

  return readSavedImageConfig();
}

function getHealthDetail(data: ApiHealthResponse) {
  const failed = data.diagnostics?.tests?.find((item) => item.status === "fail");
  const last = data.diagnostics?.tests?.at(-1);
  return data.diagnostics?.suggestion || failed?.detail || last?.detail || "";
}

export default function SettingsPage() {
  const [cfg, setCfg] = useState<ProviderConfig>({ name: "", baseUrl: "", apiKey: "", authScheme: "bearer", protocol: "openai", model: "" });
  const [imageCfg, setImageCfg] = useState<ImageConfig>({ baseUrl: "", apiKey: "", authScheme: "bearer", model: "gpt-image-1", size: "1024x1024" });
  const [username, setUsername] = useState("");
  const [saved, setSaved] = useState(false);
  const [apiStatus, setApiStatus] = useState<"idle" | "testing" | "ok" | "fail">("idle");
  const [apiDetail, setApiDetail] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [showImageKey, setShowImageKey] = useState(false);

  useEffect(() => {
    setUsername(getCurrentDisplayName());
    setCfg(getDefaultConfig());
    setImageCfg(getDefaultImageConfig());
  }, []);

  const update = (field: keyof ProviderConfig, value: string) => {
    setCfg((prev) => ({ ...prev, [field]: value }));
  };

  const updateImage = (field: keyof ImageConfig, value: string) => {
    setImageCfg((prev) => ({ ...prev, [field]: value }));
  };

  const applyPreset = (key: string) => {
    const preset = PRESETS[key];
    if (preset) setCfg((prev) => ({ ...prev, ...preset }));
  };

  const handleSave = () => {
    saveAiConfig(cfg);
    saveImageConfig(imageCfg);
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  const testApi = async () => {
    setApiStatus("testing");
    setApiDetail("");
    try {
      const res = await fetch("/api/ai/health", {
        headers: {
          "x-ai-provider": cfg.protocol,
          "x-ai-key": cfg.apiKey,
          "x-ai-base": cfg.baseUrl,
          "x-ai-model": cfg.model,
          "x-ai-auth": cfg.authScheme,
        },
      });
      const data = (await res.json()) as ApiHealthResponse;
      setApiStatus(data.status === "ok" ? "ok" : "fail");
      setApiDetail(getHealthDetail(data));
    } catch (err) {
      setApiStatus("fail");
      setApiDetail(err instanceof Error ? err.message : String(err));
    }
  };

  const applyChatConfigToImage = () => {
    setImageCfg((prev) => ({
      ...prev,
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      authScheme: cfg.authScheme,
    }));
  };

  const chatPreviewUrl = cfg.baseUrl
    ? cfg.protocol === "anthropic"
      ? buildAnthropicMessagesUrl(cfg.baseUrl)
      : buildOpenAIChatCompletionsUrl(cfg.baseUrl)
    : "https://.../v1/chat/completions";
  const imagePreviewUrl = imageCfg.baseUrl ? buildOpenAIImageGenerationsUrl(imageCfg.baseUrl) : "https://.../v1/images/generations";

  const handleLogout = () => {
    logoutUser();
    window.location.href = "/login";
  };

  return (
    <div className="animate-in study-page settings-page">
      <div className="topbar sticky top-0 z-40 flex items-center px-8 h-14">
        <span className="text-sm font-bold" style={{ color: "var(--ink)" }}>系统设置</span>
      </div>

      <div className="settings-content p-8 max-w-[840px]">
        <div className="rounded-xl p-5 mb-6" style={{ background: "var(--canvas)", border: "1px solid var(--hairline)" }}>
          <h3 className="text-sm font-semibold mb-4" style={{ color: "var(--ink)" }}>用户信息</h3>
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold" style={{ background: "var(--tint-mint)", color: "var(--primary)" }}>
              {username.charAt(0).toUpperCase() || "?"}
            </div>
            <div className="flex-1">
              <div className="text-sm font-semibold" style={{ color: "var(--ink)" }}>{username || "未登录"}</div>
              <div className="text-xs" style={{ color: "var(--steel)" }}>数据保存在本地浏览器中</div>
            </div>
            <button onClick={handleLogout} className="px-3 py-1.5 text-xs font-medium rounded-md border" style={{ borderColor: "var(--hairline-strong)", color: "var(--error)" }}>
              退出登录
            </button>
          </div>
        </div>

        <div className="rounded-xl p-5 mb-6" style={{ background: "var(--canvas)", border: "1px solid var(--hairline)" }}>
          <h3 className="text-sm font-semibold mb-1" style={{ color: "var(--ink)" }}>AI 接口配置</h3>
          <p className="text-xs mb-5" style={{ color: "var(--steel)" }}>配置好 AI 接口后，错因分析和题库讲解会优先使用真实模型。</p>

          <div className="mb-5">
            <label className="text-xs font-semibold uppercase tracking-wider mb-2 block" style={{ color: "var(--stone)" }}>快速选择提供商</label>
            <div className="flex flex-wrap gap-2">
              {Object.entries(PRESETS).map(([key, preset]) => (
                <button
                  key={key}
                  onClick={() => applyPreset(key)}
                  className="px-3 py-1.5 text-xs font-medium rounded-md border transition-all"
                  style={{
                    borderColor: cfg.name === preset.name ? "var(--primary)" : "var(--hairline)",
                    background: cfg.name === preset.name ? "var(--tint-lavender)" : "var(--canvas)",
                    color: cfg.name === preset.name ? "var(--brand-navy)" : "var(--slate)",
                  }}
                >
                  {preset.name}
                </button>
              ))}
            </div>
          </div>

          <div className="mb-4">
            <label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--slate)" }}>提供商名称</label>
            <input
              type="text"
              value={cfg.name}
              onChange={(e) => update("name", e.target.value)}
              placeholder="例如：DeepSeek、OpenAI"
              className="w-full h-10 px-3.5 rounded-lg text-sm border outline-none focus:ring-2"
              style={{ borderColor: "var(--hairline-strong)", background: "var(--canvas)", color: "var(--ink)" }}
            />
          </div>

          <div className="mb-4">
            <label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--slate)" }}>API Base URL</label>
            <input
              type="url"
              value={cfg.baseUrl}
              onChange={(e) => update("baseUrl", e.target.value)}
              placeholder="https://api.deepseek.com/v1"
              className="w-full h-10 px-3.5 rounded-lg text-sm border outline-none focus:ring-2"
              style={{ borderColor: "var(--hairline-strong)", background: "var(--canvas)", color: "var(--ink)" }}
            />
          </div>

          <div className="mb-4">
            <label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--slate)" }}>API Key</label>
            <div className="relative">
              <input
                type={showKey ? "text" : "password"}
                value={cfg.apiKey}
                onChange={(e) => update("apiKey", e.target.value)}
                placeholder="sk-..."
                className="w-full h-10 px-3.5 pr-16 rounded-lg text-sm border outline-none focus:ring-2"
                style={{ borderColor: "var(--hairline-strong)", background: "var(--canvas)", color: "var(--ink)" }}
              />
              <button
                onClick={() => setShowKey(!showKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-1 text-xs rounded"
                style={{ color: "var(--steel)" }}
              >
                {showKey ? "隐藏" : "显示"}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--slate)" }}>认证方式</label>
              <select
                value={cfg.authScheme}
                onChange={(e) => update("authScheme", e.target.value as "bearer" | "x-api-key")}
                className="w-full h-10 px-3.5 rounded-lg text-sm border outline-none"
                style={{ borderColor: "var(--hairline-strong)", background: "var(--canvas)", color: "var(--ink)" }}
              >
                <option value="bearer">Bearer Token</option>
                <option value="x-api-key">x-api-key (Anthropic)</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--slate)" }}>接口协议</label>
              <select
                value={cfg.protocol}
                onChange={(e) => update("protocol", e.target.value as "openai" | "anthropic")}
                className="w-full h-10 px-3.5 rounded-lg text-sm border outline-none"
                style={{ borderColor: "var(--hairline-strong)", background: "var(--canvas)", color: "var(--ink)" }}
              >
                <option value="openai">OpenAI Chat (兼容)</option>
                <option value="anthropic">Anthropic Messages</option>
              </select>
            </div>
          </div>

          <div className="mb-5">
            <label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--slate)" }}>模型名称</label>
            <input
              type="text"
              value={cfg.model}
              onChange={(e) => update("model", e.target.value)}
              placeholder="例如：deepseek-chat、gpt-4o-mini"
              className="w-full h-10 px-3.5 rounded-lg text-sm border outline-none focus:ring-2"
              style={{ borderColor: "var(--hairline-strong)", background: "var(--canvas)", color: "var(--ink)" }}
            />
          </div>

          <div className="rounded-lg p-3.5 mb-5 font-mono text-xs leading-relaxed" style={{ background: "var(--surface)", color: "var(--steel)" }}>
            <div style={{ color: "var(--stone)" }}>请求预览</div>
            <div className="mt-1">
              <span style={{ color: "var(--brand-green)" }}>POST</span>{" "}
              <span style={{ color: "var(--ink)" }}>{chatPreviewUrl}</span>
            </div>
            <div>
              <span style={{ color: "var(--primary)" }}>Authorization</span>: {cfg.authScheme === "bearer" ? `Bearer ${cfg.apiKey ? "***" : ""}` : `x-api-key: ${cfg.apiKey ? "***" : ""}`}
            </div>
            <div>
              <span style={{ color: "var(--primary)" }}>model</span>: {cfg.model || "(未设置)"}
            </div>
          </div>

          <div className="settings-action-row flex gap-2">
            <button onClick={handleSave} className="px-5 py-2.5 text-sm font-medium rounded-lg text-white" style={{ background: saved ? "var(--brand-green)" : "var(--primary)" }}>
              {saved ? "已保存" : "保存配置"}
            </button>
            <button
              onClick={testApi}
              disabled={!cfg.apiKey || !cfg.baseUrl}
              className="px-5 py-2.5 text-sm font-medium rounded-lg border disabled:opacity-40"
              style={{
                borderColor: "var(--hairline-strong)",
                color: apiStatus === "ok" ? "var(--brand-green)" : apiStatus === "fail" ? "var(--error)" : "var(--ink)",
              }}
            >
              {apiStatus === "testing" ? "测试中..." : apiStatus === "ok" ? "连接正常" : apiStatus === "fail" ? "连接失败" : "测试连接"}
            </button>
          </div>
          {apiDetail && (
            <div className="mt-3 text-xs leading-relaxed rounded-lg px-3 py-2" style={{ background: apiStatus === "ok" ? "var(--tint-mint)" : "var(--tint-peach)", color: apiStatus === "ok" ? "var(--brand-green)" : "var(--brand-orange)" }}>
              {apiDetail}
            </div>
          )}
        </div>

        <div className="rounded-xl p-5 mb-6" style={{ background: "var(--canvas)", border: "1px solid var(--hairline)" }}>
          <div className="flex items-start gap-3 mb-5">
            <div>
              <h3 className="text-sm font-semibold mb-1" style={{ color: "var(--ink)" }}>漫画生图接口</h3>
              <p className="text-xs" style={{ color: "var(--steel)" }}>题库解析页会用这里的图片模型生成教学分镜漫画。</p>
            </div>
            <button
              onClick={applyChatConfigToImage}
              className="ml-auto px-3 py-1.5 text-xs font-medium rounded-md border"
              style={{ borderColor: "var(--hairline-strong)", color: "var(--slate)" }}
            >
              沿用文字接口
            </button>
          </div>

          <div className="mb-4">
            <label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--slate)" }}>Image Base URL</label>
            <input
              type="url"
              value={imageCfg.baseUrl}
              onChange={(e) => updateImage("baseUrl", e.target.value)}
              placeholder="https://api.openai.com/v1"
              className="w-full h-10 px-3.5 rounded-lg text-sm border outline-none focus:ring-2"
              style={{ borderColor: "var(--hairline-strong)", background: "var(--canvas)", color: "var(--ink)" }}
            />
          </div>

          <div className="mb-4">
            <label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--slate)" }}>Image API Key</label>
            <div className="relative">
              <input
                type={showImageKey ? "text" : "password"}
                value={imageCfg.apiKey}
                onChange={(e) => updateImage("apiKey", e.target.value)}
                placeholder="sk-..."
                className="w-full h-10 px-3.5 pr-16 rounded-lg text-sm border outline-none focus:ring-2"
                style={{ borderColor: "var(--hairline-strong)", background: "var(--canvas)", color: "var(--ink)" }}
              />
              <button
                onClick={() => setShowImageKey(!showImageKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-1 text-xs rounded"
                style={{ color: "var(--steel)" }}
              >
                {showImageKey ? "隐藏" : "显示"}
              </button>
            </div>
          </div>

          <div className="settings-image-grid grid grid-cols-3 gap-4 mb-5">
            <div>
              <label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--slate)" }}>认证方式</label>
              <select
                value={imageCfg.authScheme}
                onChange={(e) => updateImage("authScheme", e.target.value as "bearer" | "x-api-key")}
                className="w-full h-10 px-3.5 rounded-lg text-sm border outline-none"
                style={{ borderColor: "var(--hairline-strong)", background: "var(--canvas)", color: "var(--ink)" }}
              >
                <option value="bearer">Bearer Token</option>
                <option value="x-api-key">x-api-key</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--slate)" }}>图片模型</label>
              <input
                type="text"
                value={imageCfg.model}
                onChange={(e) => updateImage("model", e.target.value)}
                placeholder="gpt-image-1"
                className="w-full h-10 px-3.5 rounded-lg text-sm border outline-none focus:ring-2"
                style={{ borderColor: "var(--hairline-strong)", background: "var(--canvas)", color: "var(--ink)" }}
              />
            </div>
            <div>
              <label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--slate)" }}>尺寸</label>
              <select
                value={imageCfg.size}
                onChange={(e) => updateImage("size", e.target.value)}
                className="w-full h-10 px-3.5 rounded-lg text-sm border outline-none"
                style={{ borderColor: "var(--hairline-strong)", background: "var(--canvas)", color: "var(--ink)" }}
              >
                {IMAGE_SIZE_OPTIONS.map((size) => (
                  <option key={size} value={size}>{size}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="rounded-lg p-3.5 font-mono text-xs leading-relaxed" style={{ background: "var(--surface)", color: "var(--steel)" }}>
            <div style={{ color: "var(--stone)" }}>请求预览</div>
            <div className="mt-1">
              <span style={{ color: "var(--brand-green)" }}>POST</span>{" "}
              <span style={{ color: "var(--ink)" }}>{imagePreviewUrl}</span>
            </div>
            <div>
              <span style={{ color: "var(--primary)" }}>Authorization</span>: {imageCfg.authScheme === "bearer" ? `Bearer ${imageCfg.apiKey ? "***" : ""}` : `x-api-key: ${imageCfg.apiKey ? "***" : ""}`}
            </div>
            <div>
              <span style={{ color: "var(--primary)" }}>model</span>: {imageCfg.model || "(未设置)"}
            </div>
          </div>

          <button onClick={handleSave} className="mt-4 px-5 py-2.5 text-sm font-medium rounded-lg text-white" style={{ background: saved ? "var(--brand-green)" : "var(--primary)" }}>
            {saved ? "已保存" : "保存配置"}
          </button>
        </div>

        <div className="rounded-xl p-5 mb-6" style={{ background: "var(--canvas)", border: "1px solid var(--hairline)" }}>
          <h3 className="text-sm font-semibold mb-4" style={{ color: "var(--ink)" }}>API 接口列表</h3>
          <div className="flex flex-col gap-3">
            <ApiRow method="POST" path="/api/ai" desc="AI 错因分析与题库讲解" />
            <ApiRow method="POST" path="/api/image" desc="教学漫画分镜生成" />
            <ApiRow method="GET" path="/api/gkzhenti" desc="内置真题题库读取" />
          </div>
        </div>

        <div className="rounded-xl p-5 mb-6" style={{ background: "var(--canvas)", border: "1px solid var(--hairline)" }}>
          <h3 className="text-sm font-semibold mb-4" style={{ color: "var(--ink)" }}>数据管理</h3>
          <div className="flex gap-2">
            <button
              onClick={() => {
                const user = localStorage.getItem("gongkao-current-user") || "default";
                if (confirm("确定要清空当前用户的全部学习数据吗？此操作不可撤销。")) {
                  localStorage.removeItem(`gongkao-data-${user}`);
                  window.location.reload();
                }
              }}
              className="px-4 py-2 text-sm font-medium rounded-lg border"
              style={{ borderColor: "var(--error)", color: "var(--error)" }}
            >
              清空学习数据
            </button>
          </div>
        </div>

        <div className="text-center">
          <Link href="/" className="text-xs" style={{ color: "var(--primary)" }}>返回首页</Link>
        </div>
      </div>
    </div>
  );
}

function ApiRow({ method, path, desc }: { method: string; path: string; desc: string }) {
  return (
    <div className="flex items-center gap-3 px-3.5 py-3 rounded-lg" style={{ background: "var(--surface)" }}>
      <span className="px-2 py-0.5 rounded text-xs font-bold" style={{ background: "var(--tint-mint)", color: "var(--brand-green)" }}>
        {method}
      </span>
      <code className="text-xs font-mono font-semibold" style={{ color: "var(--ink)" }}>{path}</code>
      <span className="text-xs ml-auto" style={{ color: "var(--steel)" }}>{desc}</span>
    </div>
  );
}
