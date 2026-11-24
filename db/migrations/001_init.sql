-- 阶段 1：账号、会话、用量、用户学习数据（整包 JSONB + 乐观锁版本号）
-- 见 docs/decisions/2026-11-23-database-migration.md

CREATE TABLE IF NOT EXISTS users (
  id             TEXT PRIMARY KEY,
  username       TEXT NOT NULL UNIQUE,
  display_name   TEXT NOT NULL,
  password_hash  TEXT NOT NULL,
  salt           TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  last_login_at  TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS user_app_data (
  user_id     TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data        JSONB NOT NULL,
  version     INTEGER NOT NULL DEFAULT 1,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS usage_records (
  id                 TEXT PRIMARY KEY,
  user_id            TEXT NOT NULL,
  kind               TEXT NOT NULL CHECK (kind IN ('text', 'image')),
  model              TEXT NOT NULL,
  prompt_tokens      INTEGER NOT NULL DEFAULT 0,
  completion_tokens  INTEGER NOT NULL DEFAULT 0,
  cached             BOOLEAN NOT NULL DEFAULT false,
  created_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS usage_records_user_created_idx ON usage_records(user_id, created_at DESC);
