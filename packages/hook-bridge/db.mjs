import { mkdirSync, chmodSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { PATHS } from './paths.mjs';

const MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  tool TEXT NOT NULL,
  project_root TEXT,
  git_branch TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  status TEXT DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS events (
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  ts TEXT NOT NULL,
  jsonl_path TEXT,
  jsonl_offset INTEGER,
  FOREIGN KEY (session_id) REFERENCES sessions(session_id)
);

CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);

CREATE TABLE IF NOT EXISTS skills (
  skill_id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  origin TEXT,
  path TEXT,
  state TEXT DEFAULT 'draft',
  reuse_count INTEGER DEFAULT 0,
  success_rate REAL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_skills_slug ON skills(slug);

CREATE TABLE IF NOT EXISTS lineage (
  child_id TEXT NOT NULL,
  parent_id TEXT,
  evolution_type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (child_id, evolution_type),
  FOREIGN KEY (child_id) REFERENCES skills(skill_id),
  FOREIGN KEY (parent_id) REFERENCES skills(skill_id)
);

CREATE TABLE IF NOT EXISTS evolution_queue (
  job_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  created_at TEXT NOT NULL,
  processed_at TEXT,
  error TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions(session_id)
);

CREATE INDEX IF NOT EXISTS idx_queue_status ON evolution_queue(status);
`;

let dbInstance = null;

/** 將敏感檔案權限設為 600 */
function chmod600(filePath) {
  try {
    if (existsSync(filePath)) {
      chmodSync(filePath, 0o600);
    }
  } catch {
    // 權限設定失敗不阻塞主流程
  }
}

/** 開啟並遷移 sqlite 資料庫 */
export function openDb() {
  if (dbInstance) return dbInstance;
  const dbPath = PATHS.sqlite();
  mkdirSync(dirname(dbPath), { recursive: true });
  dbInstance = new Database(dbPath);
  dbInstance.pragma('journal_mode = WAL');
  dbInstance.exec(MIGRATION_SQL);
  chmod600(dbPath);
  return dbInstance;
}

/** 關閉資料庫連線 */
export function closeDb() {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

/** 確保 session 存在 */
export function upsertSession(db, { sessionId, tool, projectRoot, gitBranch, status = 'active' }) {
  const now = new Date().toISOString();
  const existing = db.prepare('SELECT session_id FROM sessions WHERE session_id = ?').get(sessionId);
  if (existing) {
    db.prepare(`
      UPDATE sessions SET git_branch = COALESCE(?, git_branch), status = ?
      WHERE session_id = ?
    `).run(gitBranch, status, sessionId);
  } else {
    db.prepare(`
      INSERT INTO sessions (session_id, tool, project_root, git_branch, started_at, status)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(sessionId, tool, projectRoot, gitBranch, now, status);
  }
}

/** 結束 session */
export function endSession(db, sessionId) {
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE sessions SET ended_at = ?, status = 'ended' WHERE session_id = ?
  `).run(now, sessionId);
}

/** 記錄事件索引 */
export function insertEventIndex(db, { sessionId, eventType, ts, jsonlPath, jsonlOffset }) {
  db.prepare(`
    INSERT INTO events (session_id, event_type, ts, jsonl_path, jsonl_offset)
    VALUES (?, ?, ?, ?, ?)
  `).run(sessionId, eventType, ts, jsonlPath, jsonlOffset);
}

/** 狀態統計 */
export function getStatusStats(db) {
  const sessions = db.prepare('SELECT COUNT(*) AS c FROM sessions').get().c;
  const active = db.prepare("SELECT COUNT(*) AS c FROM sessions WHERE status = 'active'").get().c;
  const queuePending = db.prepare("SELECT COUNT(*) AS c FROM evolution_queue WHERE status = 'pending'").get().c;
  const evolved = db.prepare("SELECT COUNT(*) AS c FROM skills WHERE state IN ('draft', 'staging', 'promoted')").get().c;
  const promoted = db.prepare("SELECT COUNT(*) AS c FROM skills WHERE state = 'promoted'").get().c;
  return { sessions, active, queuePending, evolved, promoted };
}

/** 入隊分析任務 */
export function enqueueAnalyzeJob(db, { jobId, sessionId }) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT OR IGNORE INTO evolution_queue (job_id, session_id, status, created_at)
    VALUES (?, ?, 'pending', ?)
  `).run(jobId, sessionId, now);
}

/** 取得待處理佇列任務 */
export function fetchPendingJobs(db, limit = 10) {
  return db.prepare(`
    SELECT job_id, session_id, created_at FROM evolution_queue
    WHERE status = 'pending' ORDER BY created_at ASC LIMIT ?
  `).all(limit);
}

/** 更新佇列任務狀態 */
export function updateQueueJob(db, jobId, { status, error = null }) {
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE evolution_queue SET status = ?, processed_at = ?, error = ? WHERE job_id = ?
  `).run(status, now, error, jobId);
}

/** 註冊或更新 skill */
export function upsertSkill(db, { skillId, slug, origin, path, state, reuseCount, successRate }) {
  const now = new Date().toISOString();
  const existing = db.prepare('SELECT skill_id FROM skills WHERE slug = ?').get(slug);
  if (existing) {
    db.prepare(`
      UPDATE skills SET path = ?, state = ?, origin = COALESCE(?, origin),
        reuse_count = COALESCE(?, reuse_count), success_rate = COALESCE(?, success_rate)
      WHERE slug = ?
    `).run(path, state, origin, reuseCount, successRate, slug);
    return existing.skill_id;
  }
  const id = skillId || crypto.randomUUID();
  db.prepare(`
    INSERT INTO skills (skill_id, slug, origin, path, state, reuse_count, success_rate, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, slug, origin, path, state, reuseCount ?? 0, successRate ?? 0, now);
  return id;
}

/** 記錄 lineage */
export function insertLineage(db, { childId, parentId, evolutionType }) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT OR REPLACE INTO lineage (child_id, parent_id, evolution_type, created_at)
    VALUES (?, ?, ?, ?)
  `).run(childId, parentId, evolutionType, now);
}

/** 增加 skill 重用計數 */
export function incrementReuseCount(db, slug) {
  db.prepare('UPDATE skills SET reuse_count = reuse_count + 1 WHERE slug = ?').run(slug);
}
