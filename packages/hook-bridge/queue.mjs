import {
  writeFileSync, mkdirSync, readFileSync, existsSync, unlinkSync, readdirSync,
} from 'node:fs';
import { join } from 'node:path';
import { openDb, enqueueAnalyzeJob, updateQueueJob } from './db.mjs';
import { PATHS } from './paths.mjs';

/** 在 after_task 時入隊分析任務 */
export function enqueueSessionAnalyze(sessionId) {
  const jobId = crypto.randomUUID();
  const db = openDb();
  enqueueAnalyzeJob(db, { jobId, sessionId });

  const queueDir = PATHS.queue();
  mkdirSync(queueDir, { recursive: true });
  const jobPath = join(queueDir, `${jobId}.json`);
  writeFileSync(jobPath, JSON.stringify({
    job_id: jobId,
    session_id: sessionId,
    type: 'analyze',
    status: 'pending',
    created_at: new Date().toISOString(),
  }, null, 2), 'utf8');

  return { jobId, jobPath };
}

/** 列出待處理任務檔案 */
export function listPendingJobFiles() {
  const queueDir = PATHS.queue();
  if (!existsSync(queueDir)) return [];
  return readdirSync(queueDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => join(queueDir, f));
}

/** 讀取並標記任務處理中 */
export function claimJob(jobPath) {
  const job = JSON.parse(readFileSync(jobPath, 'utf8'));
  job.status = 'processing';
  writeFileSync(jobPath, JSON.stringify(job, null, 2), 'utf8');
  return job;
}

/** 完成任務並刪除檔案 */
export function completeJob(jobPath, { status = 'done', error = null } = {}) {
  const db = openDb();
  const job = JSON.parse(readFileSync(jobPath, 'utf8'));
  updateQueueJob(db, job.job_id, { status, error });
  try {
    unlinkSync(jobPath);
  } catch {
    // 忽略刪除失敗
  }
}
