import "server-only";

import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
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
type UsageRecord = {
  id: string;
  userId: string;
  kind: "text" | "image";
  model: string;
  promptTokens: number;
  completionTokens: number;
  // true = 命中客户端缓存，本次没有真实调用上游，token 记 0 但计入「缓存节省」。
  cached: boolean;
  createdAt: string;
};

type Database = {
  users: Record<string, ServerUser>;
  sessions: Record<string, ServerSession>;
  appData: Record<string, AppData>;
  usage: UsageRecord[];
};

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const dataDirectory = process.env.GONGKAO_DATA_DIR || path.join(process.cwd(), "data", "server");
const databasePath = path.join(dataDirectory, "users.json");

// 同一进程内的写串行化队列，保证「重读磁盘 → 应用变更 → 原子落盘」在同一实例内有序。
let writeQueue = Promise.resolve();

function emptyDatabase(): Database {
  return { users: {}, sessions: {}, appData: {}, usage: [] };
}

// 读取磁盘最新库（不做进程级缓存，跨实例写后立即可见）。
// 只有「文件不存在」（首次运行）才返回空库；文件损坏 / 结构非法 / 其它 I/O 错误一律抛出，
// 绝不静默当空库——否则配合写前重读会把损坏误判成空库并整库覆盖（F4）。
async function readDatabase(): Promise<Database> {
  let raw: string;
  try {
    raw = await readFile(databasePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return emptyDatabase();
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`用户数据库解析失败（文件损坏），已拒绝任何写入以便人工恢复: ${databasePath}`);
  }

  if (
    !isPlainObject(parsed) ||
    (parsed.users !== undefined && !isPlainObject(parsed.users)) ||
    (parsed.sessions !== undefined && !isPlainObject(parsed.sessions)) ||
    (parsed.appData !== undefined && !isPlainObject(parsed.appData)) ||
    (parsed.usage !== undefined && !Array.isArray(parsed.usage))
  ) {
    throw new Error(`用户数据库结构非法，已拒绝任何写入以便人工恢复: ${databasePath}`);
  }

  return {
    users: (parsed.users as Database["users"] | undefined) ?? {},
    sessions: (parsed.sessions as Database["sessions"] | undefined) ?? {},
    appData: (parsed.appData as Database["appData"] | undefined) ?? {},
    usage: (parsed.usage as Database["usage"] | undefined) ?? [],
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// read-modify-write：写前重读磁盘最新库，把变更合并到最新状态上再原子落盘。
// 根治多实例（Vercel 多副本）间因陈旧内存快照整文件覆盖导致的静默丢数据（消融 B/C）。
// 读取失败时 readDatabase 直接抛出，mutate 不执行、也不落盘，损坏文件原样保留待人工恢复。
async function withFreshDb<T>(mutate: (database: Database) => T | Promise<T>): Promise<T> {
  let result!: T;
  const run = writeQueue.then(async () => {
    const database = await readDatabase();
    result = await mutate(database);
    await mkdir(dataDirectory, { recursive: true });
    const tempPath = `${databasePath}.${process.pid}.tmp`;
    await writeFile(tempPath, JSON.stringify(database), { encoding: "utf8", mode: 0o600 });
    // 覆盖前滚动备份一份，作为最后可恢复兜底（尽力而为，不阻断写入）。
    try {
      await copyFile(databasePath, `${databasePath}.bak`);
    } catch {
      // 备份失败（如首次运行尚无文件）不影响主流程，主防线是「读取失败即拒绝写入」。
    }
    await rename(tempPath, databasePath);
  });
  // 让队列始终以「已解决」态续接：一次失败不得把后续所有写入永久毒化。
  writeQueue = run.then(
    () => undefined,
    () => undefined,
  );
  await run;
  return result;
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
  const username = normalizeUsername(input.username);
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
  return withFreshDb<{ ok: true; user: ServerUser } | { ok: false; message: string }>((db) => {
    if (db.users[username]) return { ok: false, message: "这个账号已经注册过了" };
    db.users[username] = user;
    return { ok: true, user };
  });
}

export async function verifyUser(usernameInput: string, password: string) {
  const username = normalizeUsername(usernameInput);
  return withFreshDb<ServerUser | null>((db) => {
    const user = db.users[username];
    if (!user || !sameSecret(hashPassword(password, user.salt), user.passwordHash)) return null;
    user.lastLoginAt = new Date().toISOString();
    return user;
  });
}

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  return withFreshDb<{ token: string; maxAge: number }>((db) => {
    db.sessions[hashSessionToken(token)] = {
      userId,
      expiresAt: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
    };
    return { token, maxAge: SESSION_TTL_SECONDS };
  });
}

export async function getUserBySession(token: string) {
  const tokenHash = hashSessionToken(token);
  return withFreshDb<ServerUser | null>((db) => {
    const session = db.sessions[tokenHash];
    if (!session) return null;
    if (session.expiresAt <= Math.floor(Date.now() / 1000)) {
      delete db.sessions[tokenHash];
      return null;
    }
    return Object.values(db.users).find((user) => user.id === session.userId) || null;
  });
}

export async function deleteSession(token: string) {
  await withFreshDb<void>((db) => {
    delete db.sessions[hashSessionToken(token)];
  });
}

export async function getUserData(userId: string): Promise<AppData | null> {
  // 纯读也走磁盘最新，保证跨实例写后立即可见。
  const database = await readDatabase();
  return database.appData[userId] || null;
}

export async function saveUserData(userId: string, data: AppData) {
  await withFreshDb<void>((db) => {
    db.appData[userId] = data;
  });
}

// 单个用户最多保留多少条用量记录。超出后丢弃最旧的，防止 users.json 无限膨胀。
// 每条约 150 字节，5000 条 ≈ 750KB。
const USAGE_MAX_PER_USER = 5000;

// 追加一条用量记录。与 store 其余写路径一样走 withFreshDb（读改写 + 原子落盘），
// 因此同样具备 F4 的失败安全：库损坏时抛错、不落盘、不覆盖。
// 注意调用方必须自行 try/catch：用量统计绝不能拖垮 AI 主流程。
export async function recordUsage(input: {
  userId: string;
  kind: "text" | "image";
  model: string;
  promptTokens?: number;
  completionTokens?: number;
  cached?: boolean;
}) {
  const record: UsageRecord = {
    id: randomBytes(12).toString("hex"),
    userId: input.userId,
    kind: input.kind,
    model: input.model.slice(0, 80),
    promptTokens: Math.max(0, Math.floor(input.promptTokens || 0)),
    completionTokens: Math.max(0, Math.floor(input.completionTokens || 0)),
    cached: Boolean(input.cached),
    createdAt: new Date().toISOString(),
  };
  await withFreshDb<void>((db) => {
    if (!Array.isArray(db.usage)) db.usage = [];
    db.usage.push(record);
    if (db.usage.length > USAGE_MAX_PER_USER) {
      // 只保留每个用户最近的 N 条（整体数组按 createdAt 排序后裁剪，实现更简单）。
      const byUser = new Map<string, UsageRecord[]>();
      for (const item of db.usage) {
        const list = byUser.get(item.userId) || [];
        list.push(item);
        byUser.set(item.userId, list);
      }
      const keep: UsageRecord[] = [];
      for (const list of byUser.values()) {
        keep.push(...list.slice(Math.max(0, list.length - USAGE_MAX_PER_USER)));
      }
      keep.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      db.usage = keep;
    }
  });
}

// 聚合某个用户的用量。时间边界按 UTC+8 归日，与 lib/store.ts 的本地日期口径一致。
export async function getUsageSummary(userId: string) {
  const database = await readDatabase();
  const records = (Array.isArray(database.usage) ? database.usage : []).filter((r) => r.userId === userId);

  const TZ_OFFSET_MS = 8 * 60 * 60 * 1000;
  const dayKey = (iso: string) => new Date(new Date(iso).getTime() + TZ_OFFSET_MS).toISOString().slice(0, 10);

  const now = new Date();
  const today = new Date(now.getTime() + TZ_OFFSET_MS).toISOString().slice(0, 10);
  const thisMonth = today.slice(0, 7);

  const totals = { prompt: 0, completion: 0, calls: 0, cached: 0 };
  const todayTotals = { prompt: 0, completion: 0 };
  const monthTotals = { prompt: 0, completion: 0 };
  const byKind: Record<string, { prompt: number; completion: number; calls: number }> = {};
  const byModel: Record<string, { prompt: number; completion: number; calls: number }> = {};
  const daily: Record<string, { prompt: number; completion: number; calls: number }> = {};

  for (const r of records) {
    const p = Number(r.promptTokens) || 0;
    const c = Number(r.completionTokens) || 0;
    totals.prompt += p;
    totals.completion += c;
    totals.calls += 1;
    if (r.cached) totals.cached += 1;

    const d = dayKey(r.createdAt);
    if (d === today) {
      todayTotals.prompt += p;
      todayTotals.completion += c;
    }
    if (d.slice(0, 7) === thisMonth) {
      monthTotals.prompt += p;
      monthTotals.completion += c;
    }

    const k = r.kind === "image" ? "image" : "text";
    byKind[k] = byKind[k] || { prompt: 0, completion: 0, calls: 0 };
    byKind[k].prompt += p;
    byKind[k].completion += c;
    byKind[k].calls += 1;

    const model = String(r.model || "unknown");
    byModel[model] = byModel[model] || { prompt: 0, completion: 0, calls: 0 };
    byModel[model].prompt += p;
    byModel[model].completion += c;
    byModel[model].calls += 1;

    daily[d] = daily[d] || { prompt: 0, completion: 0, calls: 0 };
    daily[d].prompt += p;
    daily[d].completion += c;
    daily[d].calls += 1;
  }

  // 近 14 天（含今天）的连续序列，缺的日子补 0，保证前端图表不会断档。
  const series: Array<{ date: string; prompt: number; completion: number; calls: number }> = [];
  for (let i = 13; i >= 0; i -= 1) {
    const d = new Date(now.getTime() + TZ_OFFSET_MS - i * 86400000).toISOString().slice(0, 10);
    const item = daily[d] || { prompt: 0, completion: 0, calls: 0 };
    series.push({ date: d, prompt: item.prompt, completion: item.completion, calls: item.calls });
  }

  const recent = records
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 50)
    .map((r) => ({
      id: r.id,
      kind: r.kind,
      model: r.model,
      promptTokens: r.promptTokens,
      completionTokens: r.completionTokens,
      cached: Boolean(r.cached),
      createdAt: r.createdAt,
    }));

  return {
    today: todayTotals,
    thisMonth: monthTotals,
    totals,
    byKind,
    byModel,
    series,
    recent,
  };
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
