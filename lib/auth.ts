"use client";

export type LocalUser = {
  username: string;
  displayName: string;
  passwordHash?: string;
  password?: string;
  salt?: string;
  createdAt: string;
  lastLoginAt?: string;
};

type UsersMap = Record<string, LocalUser>;

const USERS_KEY = "gongkao-users";
const CURRENT_USER_KEY = "gongkao-current-user";

function normalizeUsername(value: string) {
  return value.trim().toLowerCase();
}

function getUsers(): UsersMap {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(USERS_KEY) || "{}") as UsersMap;
  } catch {
    return {};
  }
}

function saveUsers(users: UsersMap) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

function randomSalt() {
  const bytes = new Uint8Array(16);
  const cryptoSource = globalThis.crypto;
  if (cryptoSource?.getRandomValues) {
    cryptoSource.getRandomValues(bytes);
    return Array.from(bytes).map((item) => item.toString(16).padStart(2, "0")).join("");
  }

  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes).map((item) => item.toString(16).padStart(2, "0")).join("");
}

async function sha256(value: string) {
  const cryptoSource = globalThis.crypto;
  if (cryptoSource?.subtle?.digest && typeof TextEncoder !== "undefined") {
    const data = new TextEncoder().encode(value);
    const digest = await cryptoSource.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(digest)).map((item) => item.toString(16).padStart(2, "0")).join("");
  }

  // GitHub Pages may be opened over HTTP before HTTPS is issued; Web Crypto is unavailable there.
  return fallbackHash(value);
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

  return [h1, h2, h3, h4]
    .map((item) => (item >>> 0).toString(16).padStart(8, "0"))
    .join("");
}

async function hashPassword(password: string, salt: string) {
  return sha256(`${salt}:${password}`);
}

function isValidUsername(value: string) {
  return /^[\u4e00-\u9fa5a-zA-Z0-9_.@-]{2,24}$/.test(value.trim());
}

export function getCurrentUsername() {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(CURRENT_USER_KEY) || "";
}

export function getCurrentUser() {
  const username = getCurrentUsername();
  if (!username) return null;
  return getUsers()[username] || null;
}

export function getCurrentDisplayName() {
  const user = getCurrentUser();
  return user?.displayName || user?.username || getCurrentUsername() || "学员";
}

export function isAuthenticated() {
  return Boolean(getCurrentUsername());
}

export async function registerUser(input: { username: string; displayName?: string; password: string; confirmPassword: string }) {
  const username = normalizeUsername(input.username);
  const displayName = (input.displayName || input.username).trim();

  if (!isValidUsername(input.username)) {
    return { ok: false, message: "账号需为2-24位，可用中文、字母、数字、下划线、手机号或邮箱" };
  }
  if (!displayName || displayName.length > 16) {
    return { ok: false, message: "昵称需为1-16位" };
  }
  if (input.password.length < 6) {
    return { ok: false, message: "密码至少6位" };
  }
  if (input.password !== input.confirmPassword) {
    return { ok: false, message: "两次输入的密码不一致" };
  }

  const users = getUsers();
  if (users[username]) {
    return { ok: false, message: "这个账号已经注册过了" };
  }

  const salt = randomSalt();
  users[username] = {
    username,
    displayName,
    salt,
    passwordHash: await hashPassword(input.password, salt),
    createdAt: new Date().toISOString(),
    lastLoginAt: new Date().toISOString(),
  };
  saveUsers(users);
  localStorage.setItem(CURRENT_USER_KEY, username);
  return { ok: true, user: users[username] };
}

export async function loginUser(input: { username: string; password: string }) {
  const username = normalizeUsername(input.username);
  const users = getUsers();
  const user = users[username];

  if (!user) return { ok: false, message: "账号不存在，请先注册" };

  const matchesHash = user.passwordHash && user.salt
    ? (await hashPassword(input.password, user.salt)) === user.passwordHash
    : false;
  const matchesLegacy = user.password ? user.password === input.password : false;

  if (!matchesHash && !matchesLegacy) {
    return { ok: false, message: "账号或密码不正确" };
  }

  if (matchesLegacy || !user.passwordHash || !user.salt) {
    const salt = randomSalt();
    user.salt = salt;
    user.passwordHash = await hashPassword(input.password, salt);
    delete user.password;
  }
  user.displayName = user.displayName || user.username;
  user.lastLoginAt = new Date().toISOString();
  users[username] = user;
  saveUsers(users);
  localStorage.setItem(CURRENT_USER_KEY, username);
  return { ok: true, user };
}

export function logoutUser() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(CURRENT_USER_KEY);
}
