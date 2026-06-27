import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  openDb, closeDb, insertKnowledgeEntry, insertExperience, queryKnowledgeEntries, queryExperiences,
  upsertSession,
} from './db.mjs';
import { runKnowledgeAudit, STALE_DAYS, ARCHIVE_DAYS, daysSince } from './knowledge-audit.mjs';

const testRoot = join(tmpdir(), `foundry-knowledge-audit-${Date.now()}`);

function isoDaysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

describe('knowledge audit lifecycle', () => {
  before(() => {
    closeDb();
    process.env.FOUNDRY_MEMORY_ROOT = testRoot;
    mkdirSync(join(testRoot, 'shared-agent-memory'), { recursive: true });
  });

  after(() => {
    closeDb();
    rmSync(testRoot, { recursive: true, force: true });
    delete process.env.FOUNDRY_MEMORY_ROOT;
  });

  it('daysSince computes age correctly', () => {
    const age = daysSince(isoDaysAgo(45));
    assert.ok(age >= 44 && age <= 46);
  });

  it('transitions active→stale at 60d and stale→archived at 90d', () => {
    const db = openDb();
    const sessionId = crypto.randomUUID();
    upsertSession(db, { sessionId, tool: 'test', projectRoot: '/tmp', gitBranch: 'main' });

    insertKnowledgeEntry(db, {
      entryId: 'ke-active-old',
      category: 'preference',
      abstract: 'Old active entry',
      keywords: ['old'],
      bodyPath: join(testRoot, 'knowledge/ke-active-old.md'),
      state: 'active',
      sourceSessionId: sessionId,
    });
    db.prepare('UPDATE knowledge_entries SET created_at = ? WHERE entry_id = ?')
      .run(isoDaysAgo(STALE_DAYS + 1), 'ke-active-old');

    insertKnowledgeEntry(db, {
      entryId: 'ke-stale-old',
      category: 'event',
      abstract: 'Old stale entry',
      keywords: ['stale'],
      bodyPath: join(testRoot, 'knowledge/ke-stale-old.md'),
      state: 'stale',
      sourceSessionId: sessionId,
    });
    db.prepare('UPDATE knowledge_entries SET created_at = ? WHERE entry_id = ?')
      .run(isoDaysAgo(ARCHIVE_DAYS + 1), 'ke-stale-old');

    insertKnowledgeEntry(db, {
      entryId: 'ke-pinned',
      category: 'profile',
      abstract: 'Pinned profile',
      keywords: ['pinned'],
      bodyPath: join(testRoot, 'knowledge/ke-pinned.md'),
      state: 'pinned',
      sourceSessionId: sessionId,
    });
    db.prepare('UPDATE knowledge_entries SET created_at = ? WHERE entry_id = ?')
      .run(isoDaysAgo(ARCHIVE_DAYS + 5), 'ke-pinned');

    insertExperience(db, {
      experienceId: 'exp-old-pending',
      sessionId,
      skillSlug: 'test-skill',
      lessonType: 'bug-fix',
      abstract: 'Old pending experience',
      keywords: ['bug'],
      bodyPath: join(testRoot, 'experiences/exp-old-pending.md'),
      rubricScore: 2,
      state: 'pending',
    });
    db.prepare('UPDATE experiences SET created_at = ? WHERE experience_id = ?')
      .run(isoDaysAgo(ARCHIVE_DAYS + 1), 'exp-old-pending');

    const result = runKnowledgeAudit();
    assert.equal(result.summary.knowledgeStale, 1);
    assert.equal(result.summary.knowledgeArchived, 1);
    assert.equal(result.summary.experiencesArchived, 1);
    assert.equal(result.summary.pinnedSkipped, 1);

    const activeEntry = queryKnowledgeEntries(db, { state: 'active' });
    assert.equal(activeEntry.length, 0);

    const staleEntry = db.prepare("SELECT state FROM knowledge_entries WHERE entry_id = 'ke-active-old'").get();
    assert.equal(staleEntry.state, 'stale');

    const archivedEntry = db.prepare("SELECT state FROM knowledge_entries WHERE entry_id = 'ke-stale-old'").get();
    assert.equal(archivedEntry.state, 'archived');

    const pinnedEntry = db.prepare("SELECT state FROM knowledge_entries WHERE entry_id = 'ke-pinned'").get();
    assert.equal(pinnedEntry.state, 'pinned');

    const exp = queryExperiences(db, { state: 'archived' });
    assert.equal(exp.length, 1);
    assert.equal(exp[0].experience_id, 'exp-old-pending');

    assert.ok(existsSync(result.reportPath));
    const report = readFileSync(result.reportPath, 'utf8');
    assert.match(report, /Knowledge Audit Report/);
    assert.match(report, /ke-active-old/);
  });
});
