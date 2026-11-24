#!/usr/bin/env node
// 把 users.json（JSON 驱动的数据）导入 PostgreSQL。
// - 只读源文件，绝不删除或修改 users.json（回滚路径）。
// - 幂等：已存在的记录跳过（ON CONFLICT DO NOTHING），可重复执行。
// - 结束时核对条数，不一致则以非 0 退出。
// 运行： npm run db:import-json            （默认读 GONGKAO_DATA_DIR 或 ./data/server/users.json）
//        npm run db:import-json -- --dry-run  只统计不写入
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { runMigrations } from "./db-migrate.mjs";

const dryRun = process.argv.includes("--dry-run");
const dataDir = process.env.GONGKAO_DATA_DIR || path.join(process.cwd(), "data", "server");
const source = path.join(dataDir, "users.json");

if (!process.env.DATABASE_URL) {
  console.error("✖ 请先设置 DATABASE_URL");
  process.exit(2);
}
if (!fs.existsSync(source)) {
  console.error(`✖ 找不到源文件：${source}`);
  process.exit(2);
}

// 与 store.ts 一致：解析失败直接退出，不当作空库。
const db = JSON.parse(fs.readFileSync(source, "utf8"));
const users = Object.values(db.users || {});
const sessions = Object.entries(db.sessions || {});
const appData = Object.entries(db.appData || {});
const usage = Array.isArray(db.usage) ? db.usage : [];
const userIds = new Set(users.map((u) => u.id));

console.log(`源文件：${source}`);
console.log(`用户 ${users.length}，会话 ${sessions.length}，学习数据 ${appData.length}，用量 ${usage.length}`);

const orphanData = appData.filter(([uid]) => !userIds.has(uid)).length;
const orphanSessions = sessions.filter(([, s]) => !userIds.has(s.userId)).length;
if (orphanData || orphanSessions) console.log(`⚠ 跳过无对应用户的记录：学习数据 ${orphanData}，会话 ${orphanSessions}`);

if (dryRun) {
  console.log("--dry-run：未写入任何数据");
  process.exit(0);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await runMigrations(client);
  await client.query("BEGIN");
  for (const u of users) {
    await client.query(
      `INSERT INTO users (id, username, display_name, password_hash, salt, created_at, last_login_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
      [u.id, u.username, u.displayName, u.passwordHash, u.salt, u.createdAt, u.lastLoginAt ?? null],
    );
  }
  for (const [tokenHash, s] of sessions) {
    if (!userIds.has(s.userId)) continue;
    await client.query(
      "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
      [tokenHash, s.userId, s.expiresAt],
    );
  }
  for (const [uid, data] of appData) {
    if (!userIds.has(uid)) continue;
    await client.query(
      "INSERT INTO user_app_data (user_id, data, version) VALUES ($1,$2::jsonb,1) ON CONFLICT DO NOTHING",
      [uid, JSON.stringify(data)],
    );
  }
  for (const r of usage) {
    await client.query(
      `INSERT INTO usage_records (id, user_id, kind, model, prompt_tokens, completion_tokens, cached, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
      [r.id, r.userId, r.kind === "image" ? "image" : "text", String(r.model || "unknown"), r.promptTokens || 0, r.completionTokens || 0, Boolean(r.cached), r.createdAt],
    );
  }
  await client.query("COMMIT");

  const count = async (sql, params) => Number((await client.query(sql, params)).rows[0].n);
  const ids = [...userIds];
  const checks = [
    ["用户", users.length, await count("SELECT count(*) n FROM users WHERE id = ANY($1)", [ids])],
    ["学习数据", appData.length - orphanData, await count("SELECT count(*) n FROM user_app_data WHERE user_id = ANY($1)", [ids])],
    ["用量", usage.length, await count("SELECT count(*) n FROM usage_records WHERE id = ANY($1)", [usage.map((r) => r.id)])],
  ];
  let ok = true;
  for (const [name, expected, actual] of checks) {
    const pass = expected === actual;
    ok &&= pass;
    console.log(`${pass ? "✅" : "❌"} ${name}：源 ${expected}，库中 ${actual}`);
  }
  console.log(ok ? "导入完成，源文件未改动。" : "条数不一致，请检查后再切换 STORAGE_DRIVER=pg");
  process.exitCode = ok ? 0 : 1;
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  console.error("导入失败，已回滚：", error.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
