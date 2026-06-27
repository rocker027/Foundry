import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  openDb, closeDb, insertKnowledgeEntry, insertExperience, insertSkillVersion,
  queryKnowledgeEntries, queryExperiences, querySkillVersions, getStatusStats,
  upsertSession, getSessionStatus, markSessionFailed,
} from './db.mjs';

const testRoot = join(tmpdir(), `foundry-db-test-${Date.now()}`);

describe('db v2 migration', () => {
  before(() => {
    closeDb();
    process.env.FOUNDRY_MEMORY_ROOT = testRoot;
    mkdirSync(testRoot, { recursive: true });
  });

  after(() => {
    closeDb();
    rmSync(testRoot, { recursive: true, force: true });
    delete process.env.FOUNDRY_MEMORY_ROOT;
  });

  it('creates v2 tables and CRUD helpers work', () => {
    const db = openDb();
    const sessionId = crypto.randomUUID();
    upsertSession(db, { sessionId, tool: 'test', projectRoot: '/tmp', gitBranch: 'main' });

    const entryId = insertKnowledgeEntry(db, {
      entryId: 'ke-1',
      category: 'preference',
      abstract: 'Prefer TypeScript strict mode',
      keywords: ['typescript', 'strict'],
      bodyPath: join(testRoot, 'knowledge/ke-1.md'),
      rubricScore: 2,
      sourceSessionId: sessionId,
    });
    assert.equal(entryId, 'ke-1');

    const knowledge = queryKnowledgeEntries(db, { category: 'preference' });
    assert.equal(knowledge.length, 1);
    assert.deepEqual(knowledge[0].keywords, ['typescript', 'strict']);

    const expId = insertExperience(db, {
      experienceId: 'exp-1',
      sessionId,
      skillSlug: 'android-crash-fixer',
      lessonType: 'bug-fix',
      abstract: 'Fixed NPE in MainActivity',
      keywords: ['npe', 'android'],
      bodyPath: join(testRoot, 'experiences/exp-1.md'),
      rubricScore: 3,
    });
    assert.equal(expId, 'exp-1');

    const experiences = queryExperiences(db, { skillSlug: 'android-crash-fixer' });
    assert.equal(experiences.length, 1);
    assert.equal(experiences[0].lesson_type, 'bug-fix');

    insertSkillVersion(db, {
      slug: 'android-crash-fixer',
      version: 1,
      evolutionType: 'ADOPTED',
      sessionId: null,
      experienceId: expId,
      snapshotPath: join(testRoot, 'versions/v1'),
      summary: 'baseline',
    });

    const versions = querySkillVersions(db, 'android-crash-fixer');
    assert.equal(versions.length, 1);
    assert.equal(versions[0].evolution_type, 'ADOPTED');

    markSessionFailed(db, sessionId);
    assert.equal(getSessionStatus(db, sessionId), 'failed');

    const stats = getStatusStats(db);
    assert.equal(stats.knowledgeEntries, 1);
    assert.equal(stats.experiences, 1);
    assert.equal(stats.skillVersions, 1);
    assert.equal(stats.failed, 1);
  });
});
