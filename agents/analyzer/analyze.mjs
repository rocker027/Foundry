import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { PATHS, getMemoryRoot } from '../../packages/hook-bridge/paths.mjs';
import { openDb } from '../../packages/hook-bridge/db.mjs';
import { readSessionEvents } from '../../packages/hook-bridge/recorder.mjs';

/** 從 sqlite 索引查找 JSONL 路徑 */
function findJsonlFromDb(sessionId) {
  const db = openDb();
  const row = db.prepare(`
    SELECT jsonl_path FROM events
    WHERE session_id = ? AND jsonl_path IS NOT NULL
    ORDER BY event_id DESC LIMIT 1
  `).get(sessionId);
  if (row?.jsonl_path && existsSync(row.jsonl_path)) {
    return row.jsonl_path;
  }
  return null;
}

/** 遞迴搜尋 runs 目錄 */
function walkRunsForSession(dir, sessionId, depth = 0) {
  if (depth > 8 || !existsSync(dir)) return null;
  const target = `${sessionId}.jsonl`;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const ent of entries) {
    const full = join(dir, ent.name);
    if (ent.isFile() && ent.name === target) return full;
    if (ent.isDirectory()) {
      const found = walkRunsForSession(full, sessionId, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/** 查找 session 對應的 JSONL 檔案 */
export function findSessionJsonl(sessionId) {
  const fromDb = findJsonlFromDb(sessionId);
  if (fromDb) return fromDb;

  const roots = [
    PATHS.runs(),
    join(getMemoryRoot(), 'shared-agent-memory', 'runs'),
  ];

  for (const root of roots) {
    const found = walkRunsForSession(root, sessionId);
    if (found) return found;
  }

  // 搜尋專案目錄下的 .foundry/runs（從 sqlite sessions 取得 project_root）
  const db = openDb();
  const session = db.prepare('SELECT project_root FROM sessions WHERE session_id = ?').get(sessionId);
  if (session?.project_root) {
    const overlay = join(session.project_root, '.foundry', 'runs');
    const found = walkRunsForSession(overlay, sessionId);
    if (found) return found;
  }

  return null;
}

/** 從事件列表萃取 workflow 摘要 */
export function summarizeSession(events) {
  const edits = events.filter((e) => e.event === 'after_edit');
  const commands = events.filter((e) => e.event === 'after_command');
  const files = new Set();
  const cmds = [];

  for (const e of edits) {
    for (const f of e.payload?.files || []) files.add(f);
  }
  for (const e of commands) {
    if (e.payload?.command) cmds.push(e.payload.command.slice(0, 200));
    for (const f of e.payload?.files || []) files.add(f);
  }

  const first = events[0];
  return {
    tool: first?.tool || 'unknown',
    project_root: first?.project_root,
    git: first?.git,
    file_count: files.size,
    files: [...files].slice(0, 20),
    commands: cmds.slice(0, 10),
    event_count: events.length,
    prompt: events.find((e) => e.event === 'before_task')?.payload?.prompt,
  };
}

/** 產生 slug */
export function slugify(text) {
  return String(text || 'captured-workflow')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'captured-workflow';
}

/** 分析 session 並回傳草稿後設資料 */
export function analyzeSession(sessionId) {
  const jsonlPath = findSessionJsonl(sessionId);
  if (!jsonlPath) {
    throw new Error(`Session not found: ${sessionId}`);
  }
  const events = readSessionEvents(jsonlPath);
  if (events.length === 0) {
    throw new Error(`No events for session: ${sessionId}`);
  }

  const summary = summarizeSession(events);
  const baseSlug = slugify(summary.prompt || summary.files[0] || sessionId.slice(0, 8));
  const slug = `captured-${baseSlug}`;

  return {
    slug,
    evolution_type: 'CAPTURED',
    session_id: sessionId,
    jsonl_path: jsonlPath,
    summary,
    created_at: new Date().toISOString(),
  };
}
