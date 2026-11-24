-- 阶段 2b：作答流水（见 docs/decisions/2026-11-23-database-migration.md）
-- 目的：每次作答/复习追加一条，为后续排名、估分、推荐积累原始数据。
-- 现阶段只写不读，不改动 GET /api/data 的整包快照口径。

CREATE TABLE IF NOT EXISTS answer_records (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id         TEXT NOT NULL,
  -- 冗余存储题目维度，避免统计时回表题库；题库入库（阶段 3）后可改为外键
  module              TEXT,
  sub_module          TEXT,
  user_answer         TEXT,
  is_correct          BOOLEAN NOT NULL,
  is_review           BOOLEAN NOT NULL DEFAULT false,
  minutes_spent       REAL,
  answered_at         TEXT NOT NULL,
  -- 客户端本地日期（YYYY-MM-DD），用于按天聚合；服务端不按服务器时区猜测
  local_date          TEXT NOT NULL
);

-- 按用户 + 时间倒序取最近作答
CREATE INDEX IF NOT EXISTS answer_records_user_answered_idx
  ON answer_records(user_id, answered_at DESC);
-- 按用户 + 本地日期聚合（日报、排名）
CREATE INDEX IF NOT EXISTS answer_records_user_date_idx
  ON answer_records(user_id, local_date);
-- 同一用户同一题的作答历史（错题重练轨迹）
CREATE INDEX IF NOT EXISTS answer_records_user_question_idx
  ON answer_records(user_id, question_id);
