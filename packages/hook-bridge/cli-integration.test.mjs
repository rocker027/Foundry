import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync, writeFileSync, rmSync, readFileSync, existsSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { openDb, closeDb, getSkillBySlug } from './db.mjs';
import {
  adoptSkill, readManifest, applyDraftToSkill, snapshotCurrentVersion, restoreVersionToCurrent,
} from './version.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const cli = join(repoRoot, 'cli/foundry.mjs');
const testRoot = join(tmpdir(), `foundry-cli-test-${Date.now()}`);
const skillsRoot = join(testRoot, 'skills');
const memoryRoot = join(testRoot, 'memory');

function runFoundry(args, env = {}) {
  return spawnSync('node', [cli, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      FOUNDRY_MEMORY_ROOT: memoryRoot,
      FOUNDRY_SKILLS_ROOT: skillsRoot,
      FOUNDRY_ALLOW_CUSTOM_SKILLS_ROOT: '1',
      ...env,
    },
  });
}

function writeSkill(slug, content = '# Test\n') {
  const dir = join(skillsRoot, slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${slug}\ndescription: test\n---\n\n${content}`, 'utf8');
  return dir;
}

function writeDraft(type, slug) {
  const dir = join(memoryRoot, 'shared-agent-memory', 'evolved', type, slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${slug}\ndescription: draft\n---\n\n# Draft\n`, 'utf8');
  writeFileSync(join(dir, '.provenance.json'), JSON.stringify({
    source: 'test',
    created_at: new Date().toISOString(),
    confidence: 0.9,
    author: 'test',
  }), 'utf8');
  return dir;
}

before(() => {
  process.env.FOUNDRY_MEMORY_ROOT = memoryRoot;
  process.env.FOUNDRY_SKILLS_ROOT = skillsRoot;
  process.env.FOUNDRY_ALLOW_CUSTOM_SKILLS_ROOT = '1';
  mkdirSync(skillsRoot, { recursive: true });
});

after(() => {
  closeDb();
  rmSync(testRoot, { recursive: true, force: true });
});

describe('foundry CLI integration', () => {
  it('diff accepts slug without flags', () => {
    writeSkill('diff-target', 'line one\n');
    adoptSkill('diff-target', skillsRoot, {});
    const result = runFoundry(['diff', 'diff-target']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /diff-target/);
  });

  it('rollback keeps monotonic version chain', () => {
    writeSkill('rollback-target', 'version one\n');
    adoptSkill('rollback-target', skillsRoot, {});
    writeFileSync(join(skillsRoot, 'rollback-target', 'SKILL.md'), 'version two\n', 'utf8');
    snapshotCurrentVersion('rollback-target', skillsRoot, { evolutionType: 'FIX', summary: 'v2' });

    const result = runFoundry(['rollback', 'rollback-target', '--to', 'v1']);
    assert.equal(result.status, 0, result.stderr);

    const manifest = readManifest(join(skillsRoot, 'rollback-target'));
    const versions = manifest.versions.map((v) => v.version);
    assert.equal(new Set(versions).size, versions.length);
    assert.ok(manifest.current_version > 2);
    assert.match(readFileSync(join(skillsRoot, 'rollback-target', 'SKILL.md'), 'utf8'), /rollback-target/);
  });

  it('apply FIX links lineage to existing skill_id', () => {
    writeSkill('lineage-target', 'before fix\n');
    adoptSkill('lineage-target', skillsRoot, {});
    writeDraft('FIX', 'lineage-target');

    const result = runFoundry(['apply', 'lineage-target', '--type', 'FIX', '--force']);
    assert.equal(result.status, 0, result.stderr);

    closeDb();
    const db = openDb();
    const skill = getSkillBySlug(db, 'lineage-target');
    assert.ok(skill);
    const lineage = db.prepare(`
      SELECT l.child_id, s.skill_id
      FROM lineage l
      JOIN skills s ON l.child_id = s.skill_id
      WHERE s.slug = ?
    `).get('lineage-target');
    assert.ok(lineage);
    assert.equal(lineage.child_id, skill.skill_id);
  });
});
