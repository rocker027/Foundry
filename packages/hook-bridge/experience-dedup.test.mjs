import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDb, closeDb, insertExperience } from './db.mjs';
import { dedupeExperiences } from './experience-dedup.mjs';

describe('dedupeExperiences', () => {
  let tmp;
  let prevMemory;

  beforeEach(() => {
    tmp = join(tmpdir(), `foundry-dedup-${Date.now()}`);
    mkdirSync(join(tmp, 'shared-agent-memory'), { recursive: true });
    prevMemory = process.env.FOUNDRY_MEMORY_ROOT;
    process.env.FOUNDRY_MEMORY_ROOT = tmp;
  });

  afterEach(() => {
    closeDb();
    if (prevMemory === undefined) delete process.env.FOUNDRY_MEMORY_ROOT;
    else process.env.FOUNDRY_MEMORY_ROOT = prevMemory;
    rmSync(tmp, { recursive: true, force: true });
  });

  it('keeps earliest and archives duplicate pending experiences', () => {
    const db = openDb();
    db.prepare(`
      INSERT INTO sessions (session_id, tool, project_root, started_at, ended_at, status)
      VALUES ('sess-1', 'cursor', '/tmp', datetime('now'), datetime('now'), 'completed')
    `).run();

    const body1 = join(tmp, 'experiences', 'exp-a.md');
    const body2 = join(tmp, 'experiences', 'exp-b.md');
    mkdirSync(join(tmp, 'experiences'), { recursive: true });
    writeFileSync(body1, '# a', 'utf8');
    writeFileSync(body2, '# b', 'utf8');

    insertExperience(db, {
      experienceId: 'exp-a',
      sessionId: 'sess-1',
      skillSlug: 'analyze',
      lessonType: 'pattern',
      abstract: 'same abstract',
      keywords: ['sqlite'],
      bodyPath: body1,
      rubricScore: 2,
    });
    insertExperience(db, {
      experienceId: 'exp-b',
      sessionId: 'sess-1',
      skillSlug: 'analyze',
      lessonType: 'pattern',
      abstract: 'same abstract',
      keywords: ['sqlite'],
      bodyPath: body2,
      rubricScore: 2,
    });

    const result = dedupeExperiences();
    assert.equal(result.archived, 1);

    const kept = db.prepare("SELECT state FROM experiences WHERE experience_id = 'exp-a'").get();
    const dup = db.prepare("SELECT state FROM experiences WHERE experience_id = 'exp-b'").get();
    assert.equal(kept.state, 'pending');
    assert.equal(dup.state, 'archived');
  });
});
