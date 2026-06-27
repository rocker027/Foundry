import { appendFileSync, mkdirSync, readFileSync, statSync, chmodSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { openDb, upsertSession, insertEventIndex, endSession, markSessionFailed } from './db.mjs';
import { getGitContext } from './git.mjs';
import { getProjectRunsRoot, PATHS } from './paths.mjs';
import { sanitizePayload } from './redact.mjs';
import { filterAllowedPaths } from './security.mjs';
import { evaluateSessionSuccess } from './session-success.mjs';

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

/** 格式化 runs JSONL 路徑：runs/{tool}/{date}/{session-id}.jsonl */
export function resolveJsonlPath({ tool, sessionId, projectRoot }) {
  const date = new Date().toISOString().slice(0, 10);
  const runsRoot = getProjectRunsRoot(projectRoot);
  const dir = join(runsRoot, tool, date);
  mkdirSync(dir, { recursive: true });
  return join(dir, `${sessionId}.jsonl`);
}

/** 同步記錄事件：append JSONL + 輕量 sqlite 更新 */
export function recordEvent(normalizedEvent) {
  const payload = sanitizePayload(normalizedEvent.payload ?? {});
  if (payload.files) {
    payload.files = filterAllowedPaths(payload.files);
  }

  const event = {
    ...normalizedEvent,
    payload,
    redacted: true,
  };

  const git = getGitContext(event.project_root);
  event.git = git;

  const jsonlPath = resolveJsonlPath({
    tool: event.tool,
    sessionId: event.session_id,
    projectRoot: event.project_root,
  });

  const line = `${JSON.stringify(event)}\n`;
  appendFileSync(jsonlPath, line, 'utf8');
  chmod600(jsonlPath);

  let offset = 0;
  try {
    offset = statSync(jsonlPath).size - line.length;
  } catch {
    offset = 0;
  }

  const db = openDb();
  upsertSession(db, {
    sessionId: event.session_id,
    tool: event.tool,
    projectRoot: event.project_root,
    gitBranch: git.branch,
    status: event.event === 'after_task' ? 'ended' : 'active',
  });

  insertEventIndex(db, {
    sessionId: event.session_id,
    eventType: event.event,
    ts: event.ts,
    jsonlPath,
    jsonlOffset: offset,
  });

  if (event.event === 'after_task') {
    const events = readSessionEvents(jsonlPath);
    const evalResult = evaluateSessionSuccess(events);
    if (evalResult.success) {
      endSession(db, event.session_id, 'ended');
    } else {
      markSessionFailed(db, event.session_id);
    }
  }

  return { event, jsonlPath, offset };
}

/** 讀取 session 的 JSONL 事件 */
export function readSessionEvents(jsonlPath) {
  try {
    const text = readFileSync(jsonlPath, 'utf8');
    return text.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}
