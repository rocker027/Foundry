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

const MIGRATION_V2_SQL = `
CREATE TABLE IF NOT EXISTS knowledge_entries (
  entry_id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  abstract TEXT NOT NULL,
  keywords TEXT,
  body_path TEXT,
  state TEXT DEFAULT 'active',
  access_count INTEGER DEFAULT 0,
  last_accessed_at TEXT,
  rubric_score INTEGER,
  source_session_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS experiences (
  experience_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  skill_slug TEXT,
  lesson_type TEXT,
  abstract TEXT NOT NULL,
  keywords TEXT,
  body_path TEXT,
  rubric_score INTEGER NOT NULL,
  state TEXT DEFAULT 'pending',
  promoted_version INTEGER,
  created_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(session_id)
);

CREATE TABLE IF NOT EXISTS skill_versions (
  slug TEXT NOT NULL,
  version INTEGER NOT NULL,
  evolution_type TEXT NOT NULL,
  session_id TEXT,
  experience_id TEXT,
  snapshot_path TEXT NOT NULL,
  summary TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (slug, version),
  FOREIGN KEY (experience_id) REFERENCES experiences(experience_id)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_state ON knowledge_entries(state);
CREATE INDEX IF NOT EXISTS idx_knowledge_category ON knowledge_entries(category);
CREATE INDEX IF NOT EXISTS idx_experiences_slug ON experiences(skill_slug);
CREATE INDEX IF NOT EXISTS idx_experiences_state ON experiences(state);
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
  dbInstance.exec(MIGRATION_V2_SQL);
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
export function endSession(db, sessionId, status = 'ended') {
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE sessions SET ended_at = ?, status = ? WHERE session_id = ?
  `).run(now, status, sessionId);
}

/** 標記 session 為失敗 */
export function markSessionFailed(db, sessionId) {
  endSession(db, sessionId, 'failed');
}

/** 取得 session 狀態 */
export function getSessionStatus(db, sessionId) {
  const row = db.prepare('SELECT status FROM sessions WHERE session_id = ?').get(sessionId);
  return row?.status ?? null;
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
  const failed = db.prepare("SELECT COUNT(*) AS c FROM sessions WHERE status = 'failed'").get().c;
  const queuePending = db.prepare("SELECT COUNT(*) AS c FROM evolution_queue WHERE status = 'pending'").get().c;
  const evolved = db.prepare("SELECT COUNT(*) AS c FROM skills WHERE state IN ('draft', 'staging', 'promoted')").get().c;
  const promoted = db.prepare("SELECT COUNT(*) AS c FROM skills WHERE state = 'promoted'").get().c;
  const knowledgeEntries = db.prepare("SELECT COUNT(*) AS c FROM knowledge_entries WHERE state = 'active'").get().c;
  const experiences = db.prepare("SELECT COUNT(*) AS c FROM experiences WHERE state = 'pending'").get().c;
  const skillVersions = db.prepare('SELECT COUNT(*) AS c FROM skill_versions').get().c;
  return {
    sessions, active, failed, queuePending, evolved, promoted, knowledgeEntries, experiences, skillVersions,
  };
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

/** 寫入 knowledge entry */
export function insertKnowledgeEntry(db, {
  entryId, category, abstract, keywords, bodyPath, state = 'active',
  rubricScore, sourceSessionId,
}) {
  const now = new Date().toISOString();
  const id = entryId || crypto.randomUUID();
  const kw = keywords ? JSON.stringify(keywords) : null;
  db.prepare(`
    INSERT INTO knowledge_entries (
      entry_id, category, abstract, keywords, body_path, state,
      rubric_score, source_session_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, category, abstract, kw, bodyPath, state, rubricScore ?? null, sourceSessionId ?? null, now);
  return id;
}

/** 查詢 knowledge entries */
export function queryKnowledgeEntries(db, { state = 'active', category, limit = 50 } = {}) {
  let sql = 'SELECT * FROM knowledge_entries WHERE 1=1';
  const params = [];
  if (state) {
    sql += ' AND state = ?';
    params.push(state);
  }
  if (category) {
    sql += ' AND category = ?';
    params.push(category);
  }
  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);
  return db.prepare(sql).all(...params).map(parseKnowledgeRow);
}

/** 取得單筆 knowledge entry */
export function getKnowledgeEntry(db, entryId) {
  const row = db.prepare('SELECT * FROM knowledge_entries WHERE entry_id = ?').get(entryId);
  return row ? parseKnowledgeRow(row) : null;
}

/** 增加 knowledge entry 存取計數 */
export function incrementKnowledgeAccess(db, entryId) {
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE knowledge_entries
    SET access_count = access_count + 1, last_accessed_at = ?
    WHERE entry_id = ?
  `).run(now, entryId);
}

function parseKnowledgeRow(row) {
  return {
    ...row,
    keywords: row.keywords ? JSON.parse(row.keywords) : [],
  };
}

/** 寫入 experience */
export function insertExperience(db, {
  experienceId, sessionId, skillSlug, lessonType, abstract, keywords, bodyPath,
  rubricScore, state = 'pending',
}) {
  const now = new Date().toISOString();
  const id = experienceId || crypto.randomUUID();
  const kw = keywords ? JSON.stringify(keywords) : null;
  db.prepare(`
    INSERT INTO experiences (
      experience_id, session_id, skill_slug, lesson_type, abstract, keywords,
      body_path, rubric_score, state, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, sessionId, skillSlug ?? null, lessonType ?? null, abstract, kw,
    bodyPath ?? null, rubricScore, state, now,
  );
  return id;
}

/** 查詢 experiences */
export function queryExperiences(db, { skillSlug, state, limit = 50 } = {}) {
  let sql = 'SELECT * FROM experiences WHERE 1=1';
  const params = [];
  if (skillSlug) {
    sql += ' AND skill_slug = ?';
    params.push(skillSlug);
  }
  if (state) {
    sql += ' AND state = ?';
    params.push(state);
  }
  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);
  return db.prepare(sql).all(...params).map(parseExperienceRow);
}

/** 取得單筆 experience */
export function getExperience(db, experienceId) {
  const row = db.prepare('SELECT * FROM experiences WHERE experience_id = ?').get(experienceId);
  return row ? parseExperienceRow(row) : null;
}

/** 查詢 session 是否已有 experience（避免 queue 重複萃取） */
export function findExperienceBySession(db, sessionId, {
  abstract = null,
  states = ['pending', 'promoted'],
} = {}) {
  let sql = `SELECT * FROM experiences WHERE session_id = ? AND state IN (${states.map(() => '?').join(',')})`;
  const params = [sessionId, ...states];
  if (abstract != null) {
    sql += ' AND abstract = ?';
    params.push(abstract);
  }
  sql += ' ORDER BY created_at ASC LIMIT 1';
  const row = db.prepare(sql).get(...params);
  return row ? parseExperienceRow(row) : null;
}

/** 查詢 session 是否已有 knowledge entry */
export function findKnowledgeEntryBySession(db, sessionId, {
  abstract = null,
  states = ['active', 'pinned', 'stale'],
} = {}) {
  let sql = `SELECT * FROM knowledge_entries WHERE source_session_id = ? AND state IN (${states.map(() => '?').join(',')})`;
  const params = [sessionId, ...states];
  if (abstract != null) {
    sql += ' AND abstract = ?';
    params.push(abstract);
  }
  sql += ' ORDER BY created_at ASC LIMIT 1';
  const row = db.prepare(sql).get(...params);
  return row ? parseKnowledgeRow(row) : null;
}

/** 更新 experience 狀態 */
export function updateExperienceState(db, experienceId, state, promotedVersion = null) {
  if (promotedVersion != null) {
    db.prepare(`
      UPDATE experiences SET state = ?, promoted_version = ? WHERE experience_id = ?
    `).run(state, promotedVersion, experienceId);
  } else {
    db.prepare('UPDATE experiences SET state = ? WHERE experience_id = ?').run(state, experienceId);
  }
}

function parseExperienceRow(row) {
  return {
    ...row,
    keywords: row.keywords ? JSON.parse(row.keywords) : [],
  };
}

/** 寫入 skill version */
export function insertSkillVersion(db, {
  slug, version, evolutionType, sessionId, experienceId, snapshotPath, summary,
}) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO skill_versions (
      slug, version, evolution_type, session_id, experience_id, snapshot_path, summary, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    slug, version, evolutionType, sessionId ?? null, experienceId ?? null,
    snapshotPath, summary ?? null, now,
  );
}

/** 查詢 skill 版本歷史 */
export function querySkillVersions(db, slug, limit = 50) {
  return db.prepare(`
    SELECT * FROM skill_versions WHERE slug = ? ORDER BY version DESC LIMIT ?
  `).all(slug, limit);
}

/** 取得最新 skill version */
export function getLatestSkillVersion(db, slug) {
  return db.prepare(`
    SELECT * FROM skill_versions WHERE slug = ? ORDER BY version DESC LIMIT 1
  `).get(slug) ?? null;
}

/** 取得特定 skill version */
export function getSkillVersion(db, slug, version) {
  return db.prepare(`
    SELECT * FROM skill_versions WHERE slug = ? AND version = ?
  `).get(slug, version) ?? null;
}

/** 依 slug 查詢 skill */
export function getSkillBySlug(db, slug) {
  return db.prepare('SELECT * FROM skills WHERE slug = ?').get(slug);
}
