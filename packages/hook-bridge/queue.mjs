import {
  writeFileSync, mkdirSync, readFileSync, existsSync, unlinkSync, readdirSync, chmodSync,
} from 'node:fs';
import { join } from 'node:path';
import { openDb, enqueueAnalyzeJob, updateQueueJob, getSessionStatus } from './db.mjs';
import { PATHS } from './paths.mjs';
import { findSessionJsonl } from '../../agents/analyzer/analyze.mjs';
import { readSessionEvents } from './recorder.mjs';
import { shouldSkipExtractQueue } from './session-success.mjs';

const STALE_PROCESSING_MS = 30 * 60 * 1000;
const MAX_RETRIES = 1;

/** 在 after_task 時入隊分析任務（失敗 session 跳過） */
export function enqueueSessionAnalyze(sessionId) {
  const db = openDb();
  const status = getSessionStatus(db, sessionId);
  if (status === 'failed') {
    return { skipped: true, reason: 'failed_session', sessionId };
  }

  const jsonlPath = findSessionJsonl(sessionId);
  if (jsonlPath) {
    const events = readSessionEvents(jsonlPath);
    if (shouldSkipExtractQueue(events)) {
      return { skipped: true, reason: 'session_not_successful', sessionId };
    }
  }

  const jobId = crypto.randomUUID();
  enqueueAnalyzeJob(db, { jobId, sessionId });

  const queueDir = PATHS.queue();
  mkdirSync(queueDir, { recursive: true });
  const jobPath = join(queueDir, `${jobId}.json`);
  writeFileSync(jobPath, JSON.stringify({
    job_id: jobId,
    session_id: sessionId,
    type: 'analyze',
    status: 'pending',
    retry_count: 0,
    created_at: new Date().toISOString(),
  }, null, 2), 'utf8');
  chmodSync(jobPath, 0o600);

  return { jobId, jobPath };
}

function chmod600(filePath) {
  try {
    if (existsSync(filePath)) chmodSync(filePath, 0o600);
  } catch {
    // 權限設定失敗不阻塞主流程
  }
}

/** 讀取任務檔案 */
export function readJobFile(jobPath) {
  return JSON.parse(readFileSync(jobPath, 'utf8'));
}

function isStaleProcessing(job) {
  if (job.status !== 'processing') return false;
  if (!job.claimed_at) return true;
  return Date.now() - Date.parse(job.claimed_at) > STALE_PROCESSING_MS;
}

/** 列出可處理的任務檔案（pending 或逾時 processing） */
export function listPendingJobFiles() {
  const queueDir = PATHS.queue();
  if (!existsSync(queueDir)) return [];
  return readdirSync(queueDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => join(queueDir, f))
    .filter((jobPath) => {
      try {
        const job = readJobFile(jobPath);
        return job.status === 'pending' || isStaleProcessing(job);
      } catch {
        return false;
      }
    });
}

/** 讀取並標記任務處理中；若已在處理且未逾時則回傳 null */
export function claimJob(jobPath) {
  const job = readJobFile(jobPath);
  if (job.status === 'processing' && !isStaleProcessing(job)) {
    return null;
  }
  job.status = 'processing';
  job.claimed_at = new Date().toISOString();
  writeFileSync(jobPath, JSON.stringify(job, null, 2), 'utf8');
  chmod600(jobPath);
  return job;
}

/** 完成任務；失敗時可重試一次 */
export function completeJob(jobPath, { status = 'done', error = null } = {}) {
  const db = openDb();
  const job = readJobFile(jobPath);
  const retries = job.retry_count ?? 0;

  if (status === 'failed' && retries < MAX_RETRIES) {
    job.status = 'pending';
    job.retry_count = retries + 1;
    job.last_error = error;
    delete job.claimed_at;
    writeFileSync(jobPath, JSON.stringify(job, null, 2), 'utf8');
    chmod600(jobPath);
    updateQueueJob(db, job.job_id, { status: 'pending', error });
    return { retried: true };
  }

  updateQueueJob(db, job.job_id, { status, error });
  try {
    unlinkSync(jobPath);
  } catch {
    // 忽略刪除失敗
  }
  return { retried: false };
}
