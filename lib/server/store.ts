import "server-only";

import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AppData } from "@/lib/types";

type ServerUser = {
  id: string;
  username: string;
  displayName: string;
  passwordHash: string;
  salt: string;
  createdAt: string;
  lastLoginAt?: string;
};

type ServerSession = {
  userId: string;
  expiresAt: number;
};

type Database = {
  users: Record<string, ServerUser>;
  sessions: Record<string, ServerSession>;
  appData: Record<string, AppData>;
};

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const dataDirectory = process.env.GONGKAO_DATA_DIR || path.join(process.cwd(), "data", "server");
const databasePath = path.join(dataDirectory, "users.json");

let databasePromise: Promise<Database> | null = null;
let writeQueue = Promise.resolve();

function emptyDatabase(): Database {
  return { users: {}, sessions: {}, appData: {} };
}

async function readDatabase(): Promise<Database> {
  try {
    const raw = await readFile(databasePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<Database>;
    return {
      users: parsed.users || {},
      sessions: parsed.sessions || {},
      appData: parsed.appData || {},
    };
  } catch {
    return emptyDatabase();
  }
}

async function getDatabase() {
  if (!databasePromise) databasePromise = readDatabase();
  return databasePromise;
}

async function persistDatabase(database: Database) {
  writeQueue = writeQueue.then(async () => {
    await mkdir(dataDirectory, { recursive: true });
    const tempPath = `${databasePath}.${process.pid}.tmp`;
    await writeFile(tempPath, JSON.stringify(database), { encoding: "utf8", mode: 0o600 });
    await rename(tempPath, databasePath);
  });
  return writeQueue;
}

function normalizeUsername(value: string) {
  return value.trim().toLowerCase();
}

function hashPassword(password: string, salt: string) {
  return scryptSync(password, salt, 32).toString("hex");
}

function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function sameSecret(left: string, right: string) {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function validateCredentials(input: { username?: string; displayName?: string; password?: string }) {
  const username = normalizeUsername(input.username || "");
  const displayName = (input.displayName || input.username || "").trim();
  const password = input.password || "";

  if (!/^[\u4e00-\u9fa5a-zA-Z0-9_.@-]{2,24}$/.test(username)) return "账号需为2-24位，可用中文、字母、数字、下划线、手机号或邮箱";
  if (!displayName || displayName.length > 16) return "昵称需为1-16位";
  if (password.length < 6) return "密码至少6位";
  return null;
}

export async function createUser(input: { username: string; displayName: string; password: string }) {
  const database = await getDatabase();
  const username = normalizeUsername(input.username);
  if (database.users[username]) return { ok: false as const, message: "这个账号已经注册过了" };

  const now = new Date().toISOString();
  const salt = randomBytes(16).toString("hex");
  const user: ServerUser = {
    id: randomBytes(16).toString("hex"),
    username,
    displayName: input.displayName.trim(),
    passwordHash: hashPassword(input.password, salt),
    salt,
    createdAt: now,
    lastLoginAt: now,
  };
  database.users[username] = user;
  await persistDatabase(database);
  return { ok: true as const, user };
}

export async function verifyUser(usernameInput: string, password: string) {
  const database = await getDatabase();
  const username = normalizeUsername(usernameInput);
  const user = database.users[username];
  if (!user || !sameSecret(hashPassword(password, user.salt), user.passwordHash)) return null;
  user.lastLoginAt = new Date().toISOString();
  await persistDatabase(database);
  return user;
}

export async function createSession(userId: string) {
  const database = await getDatabase();
  const token = randomBytes(32).toString("base64url");
  database.sessions[hashSessionToken(token)] = {
    userId,
    expiresAt: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
  await persistDatabase(database);
  return { token, maxAge: SESSION_TTL_SECONDS };
}

export async function getUserBySession(token: string) {
  const database = await getDatabase();
  const tokenHash = hashSessionToken(token);
  const session = database.sessions[tokenHash];
  if (!session) return null;
  if (session.expiresAt <= Math.floor(Date.now() / 1000)) {
    delete database.sessions[tokenHash];
    await persistDatabase(database);
    return null;
  }
  return Object.values(database.users).find((user) => user.id === session.userId) || null;
}

export async function deleteSession(token: string) {
  const database = await getDatabase();
  delete database.sessions[hashSessionToken(token)];
  await persistDatabase(database);
}

export async function getUserData(userId: string): Promise<AppData | null> {
  const database = await getDatabase();
  return database.appData[userId] || null;
}

export async function saveUserData(userId: string, data: AppData) {
  const database = await getDatabase();
  database.appData[userId] = data;
  await persistDatabase(database);
}

export function publicUser(user: ServerUser) {
  return {
    username: user.username,
    displayName: user.displayName,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
  };
}

export const sessionCookieName = "gongkao_session";
