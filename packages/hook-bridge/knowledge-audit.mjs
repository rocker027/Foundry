import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openDb } from './db.mjs';
import { getSharedMemoryRoot } from './paths.mjs';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const STALE_DAYS = 60;
const ARCHIVE_DAYS = 90;
const REFRESH_HINT_DAYS = 30;

function daysSince(isoDate, now = Date.now()) {
  if (!isoDate) return Infinity;
  const ts = Date.parse(isoDate);
  if (Number.isNaN(ts)) return Infinity;
  return (now - ts) / MS_PER_DAY;
}

/** 規則式語意刷新提示 */
function semanticRefreshHint(row) {
  const age = daysSince(row.created_at);
  const lastAccess = row.last_accessed_at ? daysSince(row.last_accessed_at) : age;
  const hints = [];

  if (row.access_count === 0 && age >= REFRESH_HINT_DAYS) {
    hints.push('never accessed — consider reviewing or archiving');
  }
  if (row.access_count > 0 && lastAccess >= STALE_DAYS) {
    hints.push('not accessed recently — may need refresh');
  }
  if (row.category === 'event' && age >= STALE_DAYS) {
    hints.push('event entry may be outdated');
  }
  if (row.rubric_score != null && row.rubric_score <= 2 && age >= REFRESH_HINT_DAYS) {
    hints.push('low rubric score — verify still relevant');
  }

  return hints;
}

/** 執行 knowledge / experience lifecycle 稽核 */
export function runKnowledgeAudit({ now = new Date() } = {}) {
  const db = openDb();
  const nowMs = now.getTime();
  const transitions = {
    knowledge: { activeToStale: [], staleToArchived: [], skippedPinned: [] },
    experiences: { pendingToArchived: [] },
  };
  const hints = [];

  const knowledgeRows = db.prepare('SELECT * FROM knowledge_entries').all();
  for (const row of knowledgeRows) {
    if (row.state === 'pinned') {
      transitions.knowledge.skippedPinned.push(row.entry_id);
      continue;
    }

    const age = daysSince(row.created_at, nowMs);
    const refreshHints = semanticRefreshHint(row);
    if (refreshHints.length > 0) {
      hints.push({ kind: 'knowledge', id: row.entry_id, abstract: row.abstract, hints: refreshHints });
    }

    if (row.state === 'active' && age >= STALE_DAYS) {
      db.prepare('UPDATE knowledge_entries SET state = ? WHERE entry_id = ?').run('stale', row.entry_id);
      transitions.knowledge.activeToStale.push(row.entry_id);
    } else if (row.state === 'stale' && age >= ARCHIVE_DAYS) {
      db.prepare('UPDATE knowledge_entries SET state = ? WHERE entry_id = ?').run('archived', row.entry_id);
      transitions.knowledge.staleToArchived.push(row.entry_id);
    }
  }

  const experienceRows = db.prepare("SELECT * FROM experiences WHERE state = 'pending'").all();
  for (const row of experienceRows) {
    const age = daysSince(row.created_at, nowMs);
    if (age >= ARCHIVE_DAYS) {
      db.prepare('UPDATE experiences SET state = ? WHERE experience_id = ?').run('archived', row.experience_id);
      transitions.experiences.pendingToArchived.push(row.experience_id);
    } else if (age >= STALE_DAYS) {
      hints.push({
        kind: 'experience',
        id: row.experience_id,
        abstract: row.abstract,
        hints: ['pending experience older than 60d — review or apply FIX draft'],
      });
    }
  }

  const report = buildAuditReport(transitions, hints, now);
  const auditDir = join(getSharedMemoryRoot(), 'audit');
  mkdirSync(auditDir, { recursive: true });
  const reportPath = join(auditDir, 'knowledge-REPORT.md');
  writeFileSync(reportPath, report, 'utf8');

  return {
    reportPath,
    transitions,
    hints,
    summary: {
      knowledgeStale: transitions.knowledge.activeToStale.length,
      knowledgeArchived: transitions.knowledge.staleToArchived.length,
      experiencesArchived: transitions.experiences.pendingToArchived.length,
      refreshHints: hints.length,
      pinnedSkipped: transitions.knowledge.skippedPinned.length,
    },
  };
}

function buildAuditReport(transitions, hints, now) {
  const lines = [
    '# Foundry Knowledge Audit Report',
    '',
    `- Generated: ${now.toISOString()}`,
    `- Policy: active→stale (${STALE_DAYS}d), stale→archived (${ARCHIVE_DAYS}d), pinned skipped`,
    '',
    '## Transitions',
    '',
    `### Knowledge: active → stale (${transitions.knowledge.activeToStale.length})`,
  ];

  if (transitions.knowledge.activeToStale.length === 0) {
    lines.push('- (none)');
  } else {
    for (const id of transitions.knowledge.activeToStale) lines.push(`- ${id}`);
  }

  lines.push('', `### Knowledge: stale → archived (${transitions.knowledge.staleToArchived.length})`);
  if (transitions.knowledge.staleToArchived.length === 0) {
    lines.push('- (none)');
  } else {
    for (const id of transitions.knowledge.staleToArchived) lines.push(`- ${id}`);
  }

  lines.push('', `### Experiences: pending → archived (${transitions.experiences.pendingToArchived.length})`);
  if (transitions.experiences.pendingToArchived.length === 0) {
    lines.push('- (none)');
  } else {
    for (const id of transitions.experiences.pendingToArchived) lines.push(`- ${id}`);
  }

  lines.push('', `### Pinned skipped (${transitions.knowledge.skippedPinned.length})`);
  if (transitions.knowledge.skippedPinned.length === 0) {
    lines.push('- (none)');
  } else {
    for (const id of transitions.knowledge.skippedPinned) lines.push(`- ${id}`);
  }

  lines.push('', '## Semantic refresh hints', '');
  if (hints.length === 0) {
    lines.push('- (none)');
  } else {
    for (const h of hints) {
      lines.push(`- [${h.kind}] ${h.id}: ${h.abstract?.slice(0, 80) || '(no abstract)'}`);
      for (const hint of h.hints) lines.push(`  - ${hint}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

export { STALE_DAYS, ARCHIVE_DAYS, daysSince, semanticRefreshHint };
