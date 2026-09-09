"use client";

type CachedUser = {
  username: string;
  displayName: string;
  createdAt?: string;
  lastLoginAt?: string;
};

const CACHED_USER_KEY = "gongkao-user-profile";
const LEGACY_USERS_KEY = "gongkao-users";
let cachedUser: CachedUser | null = null;

function normalizeUsername(value: string) {
  return value.trim().toLowerCase();
}

function readCachedUser() {
  if (cachedUser || typeof window === "undefined") return cachedUser;
  try {
    cachedUser = JSON.parse(localStorage.getItem(CACHED_USER_KEY) || "null") as CachedUser | null;
  } catch {
    cachedUser = null;
  }
  return cachedUser;
}

function setCachedUser(user: CachedUser | null) {
  cachedUser = user;
  if (typeof window === "undefined") return;
  if (user) localStorage.setItem(CACHED_USER_KEY, JSON.stringify(user));
  else localStorage.removeItem(CACHED_USER_KEY);
}

async function postJson(path: string, body: unknown) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

function readLegacyUsers(): Record<string, { username: string; displayName?: string; passwordHash?: string; password?: string; salt?: string }> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(LEGACY_USERS_KEY) || "{}") as Record<string, { username: string; displayName?: string; passwordHash?: string; password?: string; salt?: string }>;
  } catch {
    return {};
  }
}

function fallbackHash(value: string) {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  let h3 = 0x85ebca6b;
  let h4 = 0xc2b2ae35;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 0x01000193);
    h2 = Math.imul(h2 ^ code, 0x85ebca6b);
    h3 = Math.imul(h3 ^ code, 0xc2b2ae35);
    h4 = Math.imul(h4 ^ code, 0x27d4eb2f);
  }
  return [h1, h2, h3, h4].map((item) => (item >>> 0).toString(16).padStart(8, "0")).join("");
}

async function legacyHash(value: string) {
  if (globalThis.crypto?.subtle && typeof TextEncoder !== "undefined") {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest)).map((item) => item.toString(16).padStart(2, "0")).join("");
  }
  return fallbackHash(value);
}

async function migrateLegacyData(username: string) {
  if (typeof window === "undefined") return;
  const key = `gongkao-data-${normalizeUsername(username)}`;
  const legacyRaw = localStorage.getItem(key);
  if (!legacyRaw) return;

  try {
    const existingResponse = await fetch("/api/data", { credentials: "include" });
    const existing = await existingResponse.json().catch(() => ({}));
    if (existingResponse.ok && existing.data) return;

    const saveResponse = await fetch("/api/data", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: legacyRaw,
    });
    if (saveResponse.ok) localStorage.setItem(`gongkao-data-migrated-${normalizeUsername(username)}`, new Date().toISOString());
  } catch {
    // Migration can be retried after the server becomes available.
  }
}

export function getCurrentUsername() {
  return readCachedUser()?.username || "";
}

export function getCurrentUser() {
  return readCachedUser();
}

export function getCurrentDisplayName() {
  const user = readCachedUser();
  return user?.displayName || user?.username || "学员";
}

export function isAuthenticated() {
  return Boolean(readCachedUser());
}

export async function checkSession() {
  try {
    const response = await fetch("/api/auth/session", { credentials: "include", cache: "no-store" });
    if (!response.ok) {
      setCachedUser(null);
      return false;
    }
    const data = await response.json();
    setCachedUser(data.user || null);
    return Boolean(data.user);
  } catch {
    setCachedUser(null);
    return false;
  }
}

export async function registerUser(input: { username: string; displayName?: string; password: string; confirmPassword: string }) {
  const username = normalizeUsername(input.username);
  const displayName = (input.displayName || input.username).trim();
  if (!/^[\u4e00-\u9fa5a-zA-Z0-9_.@-]{2,24}$/.test(username)) return { ok: false, message: "账号需为2-24位，可用中文、字母、数字、下划线、手机号或邮箱" };
  if (!displayName || displayName.length > 16) return { ok: false, message: "昵称需为1-16位" };
  if (input.password.length < 6) return { ok: false, message: "密码至少6位" };
  if (input.password !== input.confirmPassword) return { ok: false, message: "两次输入的密码不一致" };

  const { response, data } = await postJson("/api/auth/register", { username, displayName, password: input.password });
  if (!response.ok) return { ok: false, message: data.message || "注册失败" };
  setCachedUser(data.user);
  return { ok: true, user: data.user };
}

export async function loginUser(input: { username: string; password: string }) {
  const username = normalizeUsername(input.username);
  let { response, data } = await postJson("/api/auth/login", { username, password: input.password });
  if (response.ok) {
    setCachedUser(data.user);
    await migrateLegacyData(username);
    return { ok: true, user: data.user };
  }

  const legacyUser = readLegacyUsers()[username];
  if (legacyUser && (legacyUser.password || (legacyUser.passwordHash && legacyUser.salt))) {
    const legacyHashValue = legacyUser.salt ? await legacyHash(`${legacyUser.salt}:${input.password}`) : "";
    const matches = legacyUser.password === input.password || legacyHashValue === legacyUser.passwordHash;
    if (matches) {
      ({ response, data } = await postJson("/api/auth/register", {
        username,
        displayName: legacyUser.displayName || username,
        password: input.password,
      }));
      if (response.ok) {
        setCachedUser(data.user);
        await migrateLegacyData(username);
        return { ok: true, user: data.user, migrated: true };
      }
    }
  }

  return { ok: false, message: data.message || "账号或密码不正确" };
}

export function logoutUser() {
  setCachedUser(null);
  void fetch("/api/auth/logout", { method: "POST", credentials: "include" }).catch(() => undefined);
}
