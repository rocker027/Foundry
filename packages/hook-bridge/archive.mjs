import {
  mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, rmdirSync, existsSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { PATHS } from './paths.mjs';
import { openDb, closeDb } from './db.mjs';

const DEFAULT_RETENTION_DAYS = 90;

/** 偵測 JSONL 是否含未脫敏金鑰 */
const RAW_SECRET_PATTERNS = [
  /sk-[a-zA-Z0-9]{20,}/,
  /ghp_[a-zA-Z0-9]{20,}/,
  /gho_[a-zA-Z0-9]{20,}/,
  /AKIA[0-9A-Z]{16}/,
];

export function containsRawSecrets(content) {
  if (typeof content !== 'string') return false;
  return RAW_SECRET_PATTERNS.some((re) => re.test(content));
}

/** 從 runs/{tool}/{date}/{session}.jsonl 路徑解析 session id */
function sessionIdFromPath(jsonlPath) {
  const base = jsonlPath.split('/').pop() || '';
  return base.replace(/\.jsonl$/, '');
}

/** 判斷日期資料夾是否超過保留天數 */
function isOlderThan(dateStr, retentionDays) {
  const folderDate = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(folderDate.getTime())) return false;
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - retentionDays);
  return folderDate < cutoff;
}

/**
 * 封存或刪除 runs：
 * - 超過 retentionDays 的 JSONL 移至 archive/runs/
 * - 含未脫敏金鑰的 session 整批刪除
 */
export function archiveRuns({
  retentionDays = DEFAULT_RETENTION_DAYS,
  dryRun = false,
  deleteSecrets = true,
} = {}) {
  const runsRoot = PATHS.runs();
  const archiveRoot = join(dirname(runsRoot), 'archive', 'runs');
  const stats = { archived: 0, deleted: 0, skipped: 0, errors: [] };

  if (!existsSync(runsRoot)) {
    return stats;
  }

  const db = openDb();

  for (const tool of readdirSync(runsRoot, { withFileTypes: true })) {
    if (!tool.isDirectory()) continue;
    const toolDir = join(runsRoot, tool.name);

    for (const dateEnt of readdirSync(toolDir, { withFileTypes: true })) {
      if (!dateEnt.isDirectory()) continue;
      const dateDir = join(toolDir, dateEnt.name);
      const tooOld = isOlderThan(dateEnt.name, retentionDays);

      for (const fileEnt of readdirSync(dateDir, { withFileTypes: true })) {
        if (!fileEnt.isFile() || !fileEnt.name.endsWith('.jsonl')) continue;
        const jsonlPath = join(dateDir, fileEnt.name);
        const sessionId = sessionIdFromPath(jsonlPath);

        try {
          const content = readFileSync(jsonlPath, 'utf8');
          if (deleteSecrets && containsRawSecrets(content)) {
            if (!dryRun) {
              unlinkSync(jsonlPath);
              db.prepare("UPDATE sessions SET status = 'archived', ended_at = ? WHERE session_id = ?")
                .run(new Date().toISOString(), sessionId);
            }
            stats.deleted += 1;
            continue;
          }

          if (tooOld) {
            const destDir = join(archiveRoot, tool.name, dateEnt.name);
            const destPath = join(destDir, fileEnt.name);
            if (!dryRun) {
              mkdirSync(destDir, { recursive: true });
              renameSync(jsonlPath, destPath);
              db.prepare("UPDATE sessions SET status = 'archived', ended_at = ? WHERE session_id = ?")
                .run(new Date().toISOString(), sessionId);
            }
            stats.archived += 1;
          } else {
            stats.skipped += 1;
          }
        } catch (err) {
          stats.errors.push({
            path: jsonlPath,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // 清理空目錄
      if (!dryRun && existsSync(dateDir)) {
        try {
          const remaining = readdirSync(dateDir);
          if (remaining.length === 0) {
            rmdirSync(dateDir);
          }
        } catch {
          // 非空目錄略過
        }
      }
    }
  }

  return stats;
}

export { DEFAULT_RETENTION_DAYS };
