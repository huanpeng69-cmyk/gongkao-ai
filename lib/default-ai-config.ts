"use client";

export type SavedAiConfig = {
  name: string;
  baseUrl: string;
  apiKey: string;
  authScheme: "bearer" | "x-api-key";
  protocol: "openai" | "anthropic";
  model: string;
};

export type SavedImageConfig = {
  baseUrl: string;
  apiKey: string;
  authScheme: "bearer" | "x-api-key";
  model: string;
  size: string;
};

const AI_KEYS = {
  name: "gongkao-ai-provider-name",
  baseUrl: "gongkao-ai-base",
  apiKey: "gongkao-ai-key",
  authScheme: "gongkao-ai-auth",
  protocol: "gongkao-ai-protocol",
  model: "gongkao-ai-model",
};

const IMAGE_KEYS = {
  baseUrl: "gongkao-image-base",
  apiKey: "gongkao-image-key",
  authScheme: "gongkao-image-auth",
  model: "gongkao-image-model",
  size: "gongkao-image-size",
};

const DEFAULT_CONFIG_VERSION_KEY = "gongkao-ai-default-config-version";
const DEFAULT_CONFIG_VERSION = "2026-06-20-xiaomi-v1";

function asAuth(value: string | undefined): "bearer" | "x-api-key" {
  return value === "x-api-key" ? "x-api-key" : "bearer";
}

function asProtocol(value: string | undefined): "openai" | "anthropic" {
  return value === "anthropic" ? "anthropic" : "openai";
}

function textDefault(): SavedAiConfig {
  return {
    name: process.env.NEXT_PUBLIC_GONGKAO_AI_NAME || "",
    baseUrl: process.env.NEXT_PUBLIC_GONGKAO_AI_BASE || "",
    apiKey: process.env.NEXT_PUBLIC_GONGKAO_AI_KEY || "",
    authScheme: asAuth(process.env.NEXT_PUBLIC_GONGKAO_AI_AUTH),
    protocol: asProtocol(process.env.NEXT_PUBLIC_GONGKAO_AI_PROTOCOL),
    model: process.env.NEXT_PUBLIC_GONGKAO_AI_MODEL || "",
  };
}

function imageDefault(): SavedImageConfig {
  const text = textDefault();
  return {
    baseUrl: process.env.NEXT_PUBLIC_GONGKAO_IMAGE_BASE || text.baseUrl,
    apiKey: process.env.NEXT_PUBLIC_GONGKAO_IMAGE_KEY || text.apiKey,
    authScheme: asAuth(process.env.NEXT_PUBLIC_GONGKAO_IMAGE_AUTH || text.authScheme),
    model: process.env.NEXT_PUBLIC_GONGKAO_IMAGE_MODEL || "gpt-image-1",
    size: process.env.NEXT_PUBLIC_GONGKAO_IMAGE_SIZE || "1024x1024",
  };
}

function setMissing(key: string, value: string) {
  if (!value) return;
  if (!localStorage.getItem(key)) localStorage.setItem(key, value);
}

function writeValue(key: string, value: string) {
  if (value) localStorage.setItem(key, value);
  else localStorage.removeItem(key);
}

function isLegacyPublicBase(value: string) {
  const legacyHost = String.fromCharCode(109, 117, 121, 117, 97, 110, 46, 100, 111);
  return value.toLowerCase().includes(legacyHost);
}

function hasLegacyTextConfig() {
  const baseUrl = localStorage.getItem(AI_KEYS.baseUrl) || "";
  return isLegacyPublicBase(baseUrl);
}

function hasLegacyImageConfig() {
  const baseUrl = localStorage.getItem(IMAGE_KEYS.baseUrl) || "";
  return isLegacyPublicBase(baseUrl);
}

function writeTextDefault(text: SavedAiConfig) {
  writeValue(AI_KEYS.name, text.name);
  writeValue(AI_KEYS.baseUrl, text.baseUrl);
  writeValue(AI_KEYS.apiKey, text.apiKey);
  writeValue(AI_KEYS.authScheme, text.authScheme);
  writeValue(AI_KEYS.protocol, text.protocol);
  writeValue(AI_KEYS.model, text.model);
}

function writeImageDefault(image: SavedImageConfig) {
  writeValue(IMAGE_KEYS.baseUrl, image.baseUrl);
  writeValue(IMAGE_KEYS.apiKey, image.apiKey);
  writeValue(IMAGE_KEYS.authScheme, image.authScheme);
  writeValue(IMAGE_KEYS.model, image.model);
  writeValue(IMAGE_KEYS.size, image.size);
}

function imageMigrationDefault(image: SavedImageConfig, useSavedTextConfig: boolean): SavedImageConfig {
  if (!useSavedTextConfig) return image;

  const savedTextBase = localStorage.getItem(AI_KEYS.baseUrl) || "";
  if (!savedTextBase || isLegacyPublicBase(savedTextBase)) return image;

  return {
    ...image,
    baseUrl: savedTextBase,
    apiKey: localStorage.getItem(AI_KEYS.apiKey) || image.apiKey,
    authScheme: asAuth(localStorage.getItem(AI_KEYS.authScheme) || image.authScheme),
  };
}

export function ensureDefaultAiConfig() {
  if (typeof window === "undefined") return;

  const text = textDefault();
  const image = imageDefault();
  const shouldCheckLegacy = localStorage.getItem(DEFAULT_CONFIG_VERSION_KEY) !== DEFAULT_CONFIG_VERSION;
  const textLegacy = shouldCheckLegacy && hasLegacyTextConfig();
  const imageLegacy = shouldCheckLegacy && hasLegacyImageConfig();

  if (textLegacy) {
    writeTextDefault(text);
  } else {
    setMissing(AI_KEYS.name, text.name);
    setMissing(AI_KEYS.baseUrl, text.baseUrl);
    setMissing(AI_KEYS.apiKey, text.apiKey);
    setMissing(AI_KEYS.authScheme, text.authScheme);
    setMissing(AI_KEYS.protocol, text.protocol);
    setMissing(AI_KEYS.model, text.model);
  }

  if (imageLegacy) {
    writeImageDefault(imageMigrationDefault(image, !textLegacy));
  } else {
    setMissing(IMAGE_KEYS.baseUrl, image.baseUrl);
    setMissing(IMAGE_KEYS.apiKey, image.apiKey);
    setMissing(IMAGE_KEYS.authScheme, image.authScheme);
    setMissing(IMAGE_KEYS.model, image.model);
    setMissing(IMAGE_KEYS.size, image.size);
  }

  localStorage.setItem(DEFAULT_CONFIG_VERSION_KEY, DEFAULT_CONFIG_VERSION);
}

export function readSavedAiConfig(): SavedAiConfig {
  if (typeof window === "undefined") {
    return { name: "", baseUrl: "", apiKey: "", authScheme: "bearer", protocol: "openai", model: "" };
  }

  ensureDefaultAiConfig();
  const fallback = textDefault();
  return {
    name: localStorage.getItem(AI_KEYS.name) || fallback.name,
    baseUrl: localStorage.getItem(AI_KEYS.baseUrl) || fallback.baseUrl,
    apiKey: localStorage.getItem(AI_KEYS.apiKey) || fallback.apiKey,
    authScheme: asAuth(localStorage.getItem(AI_KEYS.authScheme) || fallback.authScheme),
    protocol: asProtocol(localStorage.getItem(AI_KEYS.protocol) || fallback.protocol),
    model: localStorage.getItem(AI_KEYS.model) || fallback.model,
  };
}

export function saveAiConfig(cfg: SavedAiConfig) {
  localStorage.setItem(AI_KEYS.name, cfg.name);
  localStorage.setItem(AI_KEYS.baseUrl, cfg.baseUrl);
  localStorage.setItem(AI_KEYS.apiKey, cfg.apiKey);
  localStorage.setItem(AI_KEYS.authScheme, cfg.authScheme);
  localStorage.setItem(AI_KEYS.protocol, cfg.protocol);
  localStorage.setItem(AI_KEYS.model, cfg.model);
}

export function readSavedImageConfig(): SavedImageConfig {
  if (typeof window === "undefined") {
    return { baseUrl: "", apiKey: "", authScheme: "bearer", model: "gpt-image-1", size: "1024x1024" };
  }

  ensureDefaultAiConfig();
  const fallback = imageDefault();
  return {
    baseUrl: localStorage.getItem(IMAGE_KEYS.baseUrl) || localStorage.getItem(AI_KEYS.baseUrl) || fallback.baseUrl,
    apiKey: localStorage.getItem(IMAGE_KEYS.apiKey) || localStorage.getItem(AI_KEYS.apiKey) || fallback.apiKey,
    authScheme: asAuth(localStorage.getItem(IMAGE_KEYS.authScheme) || fallback.authScheme),
    model: localStorage.getItem(IMAGE_KEYS.model) || fallback.model,
    size: localStorage.getItem(IMAGE_KEYS.size) || fallback.size,
  };
}

export function saveImageConfig(cfg: SavedImageConfig) {
  localStorage.setItem(IMAGE_KEYS.baseUrl, cfg.baseUrl);
  localStorage.setItem(IMAGE_KEYS.apiKey, cfg.apiKey);
  localStorage.setItem(IMAGE_KEYS.authScheme, cfg.authScheme);
  localStorage.setItem(IMAGE_KEYS.model, cfg.model);
  localStorage.setItem(IMAGE_KEYS.size, cfg.size);
}
