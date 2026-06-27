import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { migrateMnemo } from './migrate.mjs';
import {
  openDb, closeDb, queryKnowledgeEntries, queryExperiences, getSessionStatus,
} from './db.mjs';

const testRoot = join(tmpdir(), `foundry-migrate-test-${Date.now()}`);
const mnemoDir = join(testRoot, 'skill-mnemo');

describe('migrate without existing session', () => {
  before(() => {
    closeDb();
    process.env.FOUNDRY_MEMORY_ROOT = testRoot;
    mkdirSync(join(mnemoDir, 'experience'), { recursive: true });
    writeFileSync(
      join(mnemoDir, 'MEMORY.md'),
      '2024-01-15 preference: Prefer strict TypeScript\n',
      'utf8',
    );
    writeFileSync(
      join(mnemoDir, 'experience', 'test-skill.md'),
      '# Fixed null pointer\n\n**教訓類型**: bug-fix\n',
      'utf8',
    );
  });

  after(() => {
    closeDb();
    rmSync(testRoot, { recursive: true, force: true });
    delete process.env.FOUNDRY_MEMORY_ROOT;
  });

  it('migrateMnemo upserts placeholder session and inserts rows', () => {
    const db = openDb();
    const sessionId = 'migrate-mnemo';

    const stats = migrateMnemo(db, { mnemoDir, sessionId });
    assert.equal(stats.errors.length, 0);
    assert.equal(stats.knowledge, 1);
    assert.equal(stats.experiences, 1);

    assert.equal(getSessionStatus(db, sessionId), 'ended');
    assert.equal(queryKnowledgeEntries(db).length, 1);
    assert.equal(queryExperiences(db, { state: 'promoted' }).length, 1);
  });
});
