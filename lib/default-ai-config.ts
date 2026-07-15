"use client";

import { AGNES_BASE_URL, AGNES_NAME, AGNES_PROVIDER, AGNES_TEXT_MODEL, isAgnesUrl } from "./agnes-ai";

export const THIRD_PARTY_IMAGE_BASE_URL = "https://wisart.klsf.cc/v1";
export const THIRD_PARTY_IMAGE_MODEL = "gpt-image-2";
export const THIRD_PARTY_IMAGE_SIZE = "1024x1024";

export type SavedAiConfig = {
  name: typeof AGNES_NAME;
  baseUrl: typeof AGNES_BASE_URL;
  apiKey: string;
  authScheme: "bearer";
  protocol: typeof AGNES_PROVIDER;
  model: string;
};

export type SavedImageConfig = {
  baseUrl: string;
  apiKey: string;
  authScheme: "bearer" | "x-api-key";
  model: string;
  size: string;
};

const KEYS = {
  agnesApiKey: "gongkao-agnes-api-key",
  textModel: "gongkao-agnes-text-model",
  imageBaseUrl: "gongkao-image-base",
  imageApiKey: "gongkao-image-key",
  imageAuthScheme: "gongkao-image-auth",
  imageModel: "gongkao-image-model",
  imageSize: "gongkao-image-size",
  version: "gongkao-ai-default-config-version",
};

const LEGACY_AI_BASE = "gongkao-ai-base";
const LEGACY_AI_KEY = "gongkao-ai-key";
const CONFIG_VERSION = "2026-07-15-third-party-image-v1";

function imageDefault(): SavedImageConfig {
  return {
    baseUrl: process.env.NEXT_PUBLIC_GONGKAO_IMAGE_BASE || THIRD_PARTY_IMAGE_BASE_URL,
    apiKey: process.env.NEXT_PUBLIC_GONGKAO_IMAGE_KEY || "",
    authScheme: process.env.NEXT_PUBLIC_GONGKAO_IMAGE_AUTH === "x-api-key" ? "x-api-key" : "bearer",
    model: process.env.NEXT_PUBLIC_GONGKAO_IMAGE_MODEL || THIRD_PARTY_IMAGE_MODEL,
    size: process.env.NEXT_PUBLIC_GONGKAO_IMAGE_SIZE || THIRD_PARTY_IMAGE_SIZE,
  };
}

function publicAgnesKey() {
  return process.env.NEXT_PUBLIC_GONGKAO_AGNES_KEY || process.env.NEXT_PUBLIC_GONGKAO_AI_KEY || "";
}

function migrateAgnesKey() {
  const existing = localStorage.getItem(KEYS.agnesApiKey);
  if (existing) return existing;
  const legacyBase = localStorage.getItem(LEGACY_AI_BASE) || "";
  const safeKey = isAgnesUrl(legacyBase) ? localStorage.getItem(LEGACY_AI_KEY) || "" : "";
  const value = safeKey || publicAgnesKey();
  if (value) localStorage.setItem(KEYS.agnesApiKey, value);
  return value;
}

export function ensureDefaultAiConfig() {
  if (typeof window === "undefined") return;
  migrateAgnesKey();
  const image = imageDefault();
  if (!localStorage.getItem(KEYS.textModel)) {
    localStorage.setItem(KEYS.textModel, process.env.NEXT_PUBLIC_GONGKAO_AGNES_TEXT_MODEL || AGNES_TEXT_MODEL);
  }
  if (!localStorage.getItem(KEYS.imageBaseUrl)) localStorage.setItem(KEYS.imageBaseUrl, image.baseUrl);
  if (!localStorage.getItem(KEYS.imageApiKey) && image.apiKey) localStorage.setItem(KEYS.imageApiKey, image.apiKey);
  if (!localStorage.getItem(KEYS.imageAuthScheme)) localStorage.setItem(KEYS.imageAuthScheme, image.authScheme);
  if (!localStorage.getItem(KEYS.imageModel) || localStorage.getItem(KEYS.version) !== CONFIG_VERSION) {
    localStorage.setItem(KEYS.imageModel, image.model);
  }
  if (!localStorage.getItem(KEYS.imageSize)) localStorage.setItem(KEYS.imageSize, image.size);
  localStorage.setItem(KEYS.version, CONFIG_VERSION);
}

export function hasSavedAgnesKey() {
  if (typeof window === "undefined") return false;
  ensureDefaultAiConfig();
  return Boolean(localStorage.getItem(KEYS.agnesApiKey));
}

export function hasSavedImageKey() {
  if (typeof window === "undefined") return false;
  ensureDefaultAiConfig();
  return Boolean(localStorage.getItem(KEYS.imageApiKey));
}

export function readSavedAiConfig(): SavedAiConfig {
  if (typeof window === "undefined") return { name: AGNES_NAME, baseUrl: AGNES_BASE_URL, apiKey: "", authScheme: "bearer", protocol: AGNES_PROVIDER, model: AGNES_TEXT_MODEL };
  ensureDefaultAiConfig();
  return {
    name: AGNES_NAME,
    baseUrl: AGNES_BASE_URL,
    apiKey: localStorage.getItem(KEYS.agnesApiKey) || "",
    authScheme: "bearer",
    protocol: AGNES_PROVIDER,
    model: localStorage.getItem(KEYS.textModel) || AGNES_TEXT_MODEL,
  };
}

export function saveAiConfig(cfg: Pick<SavedAiConfig, "apiKey" | "model">) {
  if (cfg.apiKey.trim()) localStorage.setItem(KEYS.agnesApiKey, cfg.apiKey.trim());
  localStorage.setItem(KEYS.textModel, cfg.model.trim() || AGNES_TEXT_MODEL);
}

export function readSavedImageConfig(): SavedImageConfig {
  const fallback = imageDefault();
  if (typeof window === "undefined") return fallback;
  ensureDefaultAiConfig();
  return {
    baseUrl: localStorage.getItem(KEYS.imageBaseUrl) || fallback.baseUrl,
    apiKey: localStorage.getItem(KEYS.imageApiKey) || fallback.apiKey,
    authScheme: localStorage.getItem(KEYS.imageAuthScheme) === "x-api-key" ? "x-api-key" : "bearer",
    model: localStorage.getItem(KEYS.imageModel) || fallback.model,
    size: localStorage.getItem(KEYS.imageSize) || fallback.size,
  };
}

export function saveImageConfig(cfg: SavedImageConfig) {
  localStorage.setItem(KEYS.imageBaseUrl, cfg.baseUrl.trim() || THIRD_PARTY_IMAGE_BASE_URL);
  if (cfg.apiKey.trim()) localStorage.setItem(KEYS.imageApiKey, cfg.apiKey.trim());
  localStorage.setItem(KEYS.imageAuthScheme, cfg.authScheme);
  localStorage.setItem(KEYS.imageModel, cfg.model.trim() || THIRD_PARTY_IMAGE_MODEL);
  localStorage.setItem(KEYS.imageSize, cfg.size || THIRD_PARTY_IMAGE_SIZE);
}

export function removeSavedAgnesKey() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(KEYS.agnesApiKey);
}

export function removeSavedImageKey() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(KEYS.imageApiKey);
}
