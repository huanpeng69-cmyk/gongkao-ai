"use client";

import {
  AGNES_BASE_URL,
  AGNES_IMAGE_MODEL,
  AGNES_IMAGE_SIZE,
  AGNES_NAME,
  AGNES_PROVIDER,
  AGNES_TEXT_MODEL,
  isAgnesUrl,
} from "./agnes-ai";

export type SavedAiConfig = {
  name: typeof AGNES_NAME;
  baseUrl: typeof AGNES_BASE_URL;
  apiKey: string;
  authScheme: "bearer";
  protocol: typeof AGNES_PROVIDER;
  model: string;
};

export type SavedImageConfig = {
  baseUrl: typeof AGNES_BASE_URL;
  apiKey: string;
  authScheme: "bearer";
  model: string;
  size: string;
  ratio: string;
};

const KEYS = {
  apiKey: "gongkao-agnes-api-key",
  textModel: "gongkao-agnes-text-model",
  imageModel: "gongkao-agnes-image-model",
  imageSize: "gongkao-agnes-image-size",
  imageRatio: "gongkao-agnes-image-ratio",
  version: "gongkao-ai-default-config-version",
};

const LEGACY_KEYS = {
  baseUrl: "gongkao-ai-base",
  apiKey: "gongkao-ai-key",
  imageBaseUrl: "gongkao-image-base",
  imageApiKey: "gongkao-image-key",
};

const CONFIG_VERSION = "2026-07-13-agnes-v2";

function publicKeyDefault() {
  return process.env.NEXT_PUBLIC_GONGKAO_AGNES_KEY || process.env.NEXT_PUBLIC_GONGKAO_AI_KEY || "";
}

function migrateAgnesKey() {
  const existing = localStorage.getItem(KEYS.apiKey);
  if (existing) return existing;

  const legacyBase = localStorage.getItem(LEGACY_KEYS.baseUrl) || "";
  const legacyImageBase = localStorage.getItem(LEGACY_KEYS.imageBaseUrl) || "";
  const legacyKey = isAgnesUrl(legacyBase) ? localStorage.getItem(LEGACY_KEYS.apiKey) || "" : "";
  const legacyImageKey = isAgnesUrl(legacyImageBase) ? localStorage.getItem(LEGACY_KEYS.imageApiKey) || "" : "";
  const safeKey = legacyKey || legacyImageKey || publicKeyDefault();
  if (safeKey) localStorage.setItem(KEYS.apiKey, safeKey);
  return safeKey;
}

export function ensureDefaultAiConfig() {
  if (typeof window === "undefined") return;
  if (localStorage.getItem(KEYS.version) === CONFIG_VERSION) return;

  migrateAgnesKey();
  if (!localStorage.getItem(KEYS.textModel)) {
    localStorage.setItem(KEYS.textModel, process.env.NEXT_PUBLIC_GONGKAO_AGNES_TEXT_MODEL || AGNES_TEXT_MODEL);
  }
  if (!localStorage.getItem(KEYS.imageModel)) {
    localStorage.setItem(KEYS.imageModel, process.env.NEXT_PUBLIC_GONGKAO_AGNES_IMAGE_MODEL || AGNES_IMAGE_MODEL);
  }
  if (!localStorage.getItem(KEYS.imageSize)) localStorage.setItem(KEYS.imageSize, AGNES_IMAGE_SIZE);
  if (!localStorage.getItem(KEYS.imageRatio)) localStorage.setItem(KEYS.imageRatio, "1:1");
  localStorage.setItem(KEYS.version, CONFIG_VERSION);
}

export function hasSavedAgnesKey() {
  if (typeof window === "undefined") return false;
  ensureDefaultAiConfig();
  return Boolean(localStorage.getItem(KEYS.apiKey));
}

export function readSavedAiConfig(): SavedAiConfig {
  if (typeof window === "undefined") {
    return { name: AGNES_NAME, baseUrl: AGNES_BASE_URL, apiKey: "", authScheme: "bearer", protocol: AGNES_PROVIDER, model: AGNES_TEXT_MODEL };
  }
  ensureDefaultAiConfig();
  return {
    name: AGNES_NAME,
    baseUrl: AGNES_BASE_URL,
    apiKey: localStorage.getItem(KEYS.apiKey) || "",
    authScheme: "bearer",
    protocol: AGNES_PROVIDER,
    model: localStorage.getItem(KEYS.textModel) || AGNES_TEXT_MODEL,
  };
}

export function saveAiConfig(cfg: Pick<SavedAiConfig, "apiKey" | "model">) {
  if (cfg.apiKey.trim()) localStorage.setItem(KEYS.apiKey, cfg.apiKey.trim());
  localStorage.setItem(KEYS.textModel, cfg.model.trim() || AGNES_TEXT_MODEL);
}

export function readSavedImageConfig(): SavedImageConfig {
  if (typeof window === "undefined") {
    return { baseUrl: AGNES_BASE_URL, apiKey: "", authScheme: "bearer", model: AGNES_IMAGE_MODEL, size: AGNES_IMAGE_SIZE, ratio: "1:1" };
  }
  ensureDefaultAiConfig();
  return {
    baseUrl: AGNES_BASE_URL,
    apiKey: localStorage.getItem(KEYS.apiKey) || "",
    authScheme: "bearer",
    model: localStorage.getItem(KEYS.imageModel) || AGNES_IMAGE_MODEL,
    size: localStorage.getItem(KEYS.imageSize) || AGNES_IMAGE_SIZE,
    ratio: localStorage.getItem(KEYS.imageRatio) || "1:1",
  };
}

export function saveImageConfig(cfg: Pick<SavedImageConfig, "apiKey" | "model" | "size" | "ratio">) {
  if (cfg.apiKey.trim()) localStorage.setItem(KEYS.apiKey, cfg.apiKey.trim());
  localStorage.setItem(KEYS.imageModel, cfg.model.trim() || AGNES_IMAGE_MODEL);
  localStorage.setItem(KEYS.imageSize, cfg.size || AGNES_IMAGE_SIZE);
  localStorage.setItem(KEYS.imageRatio, cfg.ratio || "1:1");
}

export function removeSavedAgnesKey() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(KEYS.apiKey);
}
