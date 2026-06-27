import { mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { openDb, updateExperienceState } from './db.mjs';
import { getMemoryRoot } from './paths.mjs';

/** 依 session_id + abstract 分組，保留最早一筆 */
export function dedupeExperiences({ dryRun = false } = {}) {
  const db = openDb();
  const rows = db.prepare(`
    SELECT experience_id, session_id, skill_slug, abstract, body_path, state, created_at
    FROM experiences
    WHERE state IN ('pending', 'promoted')
    ORDER BY created_at ASC
  `).all();

  const groups = new Map();
  for (const row of rows) {
    const key = `${row.session_id}\0${row.skill_slug ?? ''}\0${row.abstract}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const kept = [];
  const archived = [];
  const archiveDir = join(getMemoryRoot(), 'experiences', '_dedup-archived');

  for (const [, group] of groups) {
    if (group.length <= 1) {
      kept.push(group[0].experience_id);
      continue;
    }
    kept.push(group[0].experience_id);
    for (const dup of group.slice(1)) {
      archived.push({
        experience_id: dup.experience_id,
        session_id: dup.session_id,
        abstract: dup.abstract,
        kept_id: group[0].experience_id,
      });
      if (!dryRun) {
        updateExperienceState(db, dup.experience_id, 'archived');
        if (dup.body_path) {
          mkdirSync(archiveDir, { recursive: true });
          const dest = join(archiveDir, `${dup.experience_id}.md`);
          try {
            renameSync(dup.body_path, dest);
          } catch {
            // body 可能已不存在，略過
          }
        }
      }
    }
  }

  return {
    groupsScanned: groups.size,
    kept: kept.length,
    archived: archived.length,
    archivedIds: archived,
    dryRun,
  };
}
