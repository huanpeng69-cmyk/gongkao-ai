import "server-only";

// PostgreSQL 数据访问层（阶段 1）。只做 SQL，不做业务规则：
// 密码哈希、会话 token 哈希、用量聚合仍在 store.ts，两种驱动共用，保证口径一致。
// 不变量（沿用 F4）：任何查询错误一律抛出，绝不返回空值冒充「没有数据」。
import { Pool } from "pg";
import type { AppData } from "@/lib/types";

export type PgUser = {
  id: string;
  username: string;
  displayName: string;
  passwordHash: string;
  salt: string;
  createdAt: string;
  lastLoginAt?: string;
};

export type PgUsageRecord = {
  id: string;
  userId: string;
  kind: "text" | "image";
  model: string;
  promptTokens: number;
  completionTokens: number;
  cached: boolean;
  createdAt: string;
};

const globalForPg = globalThis as unknown as { __gongkaoPgPool?: Pool };

function pool() {
  if (!globalForPg.__gongkaoPgPool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("STORAGE_DRIVER=pg 但未设置 DATABASE_URL");
    globalForPg.__gongkaoPgPool = new Pool({ connectionString, max: Number(process.env.PG_POOL_MAX || 10) });
  }
  return globalForPg.__gongkaoPgPool;
}

type UserRow = {
  id: string;
  username: string;
  display_name: string;
  password_hash: string;
  salt: string;
  created_at: string;
  last_login_at: string | null;
};

function toUser(row: UserRow): PgUser {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    passwordHash: row.password_hash,
    salt: row.salt,
    createdAt: row.created_at,
    ...(row.last_login_at ? { lastLoginAt: row.last_login_at } : {}),
  };
}

/** 插入用户；用户名已存在返回 false。 */
export async function insertUser(user: PgUser): Promise<boolean> {
  const result = await pool().query(
    `INSERT INTO users (id, username, display_name, password_hash, salt, created_at, last_login_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (username) DO NOTHING`,
    [user.id, user.username, user.displayName, user.passwordHash, user.salt, user.createdAt, user.lastLoginAt ?? null],
  );
  return result.rowCount === 1;
}

export async function findUserByUsername(username: string): Promise<PgUser | null> {
  const result = await pool().query<UserRow>("SELECT * FROM users WHERE username = $1", [username]);
  return result.rows[0] ? toUser(result.rows[0]) : null;
}

export async function touchLastLogin(userId: string, iso: string) {
  await pool().query("UPDATE users SET last_login_at = $2 WHERE id = $1", [userId, iso]);
}

export async function insertSession(tokenHash: string, userId: string, expiresAt: number) {
  await pool().query("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)", [tokenHash, userId, expiresAt]);
}

/** 按会话取用户；过期会话顺手删除并返回 null。 */
export async function findUserBySession(tokenHash: string, nowSeconds: number): Promise<PgUser | null> {
  const result = await pool().query<UserRow & { expires_at: string }>(
    `SELECT u.*, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1`,
    [tokenHash],
  );
  const row = result.rows[0];
  if (!row) return null;
  if (Number(row.expires_at) <= nowSeconds) {
    await pool().query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash]);
    return null;
  }
  return toUser(row);
}

export async function removeSession(tokenHash: string) {
  await pool().query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash]);
}

export async function readAppData(userId: string): Promise<{ data: AppData; version: number } | null> {
  const result = await pool().query<{ data: AppData; version: number }>(
    "SELECT data, version FROM user_app_data WHERE user_id = $1",
    [userId],
  );
  return result.rows[0] ?? null;
}

/**
 * 保存整包学习数据。
 * - expectedVersion 省略：无条件写入（兼容现有 PUT /api/data，行为与 JSON 驱动一致）。
 * - expectedVersion 给定：仅当版本一致才写入，否则返回 conflict，绝不静默覆盖。
 */
export async function writeAppData(
  userId: string,
  data: AppData,
  expectedVersion?: number,
): Promise<{ ok: true; version: number } | { ok: false; conflict: true; currentVersion: number | null }> {
  const json = JSON.stringify(data);
  if (expectedVersion === undefined) {
    const result = await pool().query<{ version: number }>(
      `INSERT INTO user_app_data (user_id, data, version, updated_at) VALUES ($1, $2::jsonb, 1, now())
       ON CONFLICT (user_id) DO UPDATE SET data = EXCLUDED.data, version = user_app_data.version + 1, updated_at = now()
       RETURNING version`,
      [userId, json],
    );
    return { ok: true, version: result.rows[0].version };
  }

  if (expectedVersion === 0) {
    const inserted = await pool().query<{ version: number }>(
      `INSERT INTO user_app_data (user_id, data, version, updated_at) VALUES ($1, $2::jsonb, 1, now())
       ON CONFLICT (user_id) DO NOTHING RETURNING version`,
      [userId, json],
    );
    if (inserted.rows[0]) return { ok: true, version: inserted.rows[0].version };
  } else {
    const updated = await pool().query<{ version: number }>(
      `UPDATE user_app_data SET data = $2::jsonb, version = version + 1, updated_at = now()
       WHERE user_id = $1 AND version = $3 RETURNING version`,
      [userId, json, expectedVersion],
    );
    if (updated.rows[0]) return { ok: true, version: updated.rows[0].version };
  }
  const current = await readAppData(userId);
  return { ok: false, conflict: true, currentVersion: current ? current.version : null };
}

export async function insertUsage(record: PgUsageRecord, maxPerUser: number) {
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO usage_records (id, user_id, kind, model, prompt_tokens, completion_tokens, cached, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [record.id, record.userId, record.kind, record.model, record.promptTokens, record.completionTokens, record.cached, record.createdAt],
    );
    // 每个用户只保留最近 maxPerUser 条，与 JSON 驱动口径一致。
    await client.query(
      `DELETE FROM usage_records WHERE id IN (
         SELECT id FROM usage_records WHERE user_id = $1 ORDER BY created_at DESC OFFSET $2
       )`,
      [record.userId, maxPerUser],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function listUsage(userId: string): Promise<PgUsageRecord[]> {
  const result = await pool().query<{
    id: string;
    user_id: string;
    kind: "text" | "image";
    model: string;
    prompt_tokens: number;
    completion_tokens: number;
    cached: boolean;
    created_at: string;
  }>("SELECT * FROM usage_records WHERE user_id = $1 ORDER BY created_at ASC", [userId]);
  return result.rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    kind: row.kind,
    model: row.model,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    cached: row.cached,
    createdAt: row.created_at,
  }));
}

/** 测试与运维用：关闭连接池。 */
export async function closePool() {
  if (globalForPg.__gongkaoPgPool) {
    await globalForPg.__gongkaoPgPool.end();
    globalForPg.__gongkaoPgPool = undefined;
  }
}
