#!/usr/bin/env node
// 在 .env.local 末尾追加 STORAGE_DRIVER=pg 与 DATABASE_URL；已存在同名键则不重复写入，不改动其它行。
import fs from "node:fs";
const file = ".env.local";
const url = process.argv[2];
if (!url) { console.error("用法: node scripts/switch-env-to-pg.mjs <DATABASE_URL>"); process.exit(2); }
let text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
const has = (k) => new RegExp(`^\\uFEFF?${k}=`, "m").test(text);
if (has("STORAGE_DRIVER")) { console.error("✖ .env.local 已有 STORAGE_DRIVER，请手动修改后再试"); process.exit(1); }
const lines = ["", "# 2026-11-23 切换到 PostgreSQL；回滚改成 STORAGE_DRIVER=json 后重启", "STORAGE_DRIVER=pg"];
if (!has("DATABASE_URL")) lines.push(`DATABASE_URL=${url}`);
if (text && !text.endsWith("\n")) text += "\n";
fs.writeFileSync(file, text + lines.join("\n") + "\n", "utf8");
console.log("✅ 已写入 .env.local：STORAGE_DRIVER=pg" + (has("DATABASE_URL") ? "（DATABASE_URL 已存在，未改）" : " 与 DATABASE_URL"));
