import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync, writeFileSync, rmSync, existsSync, readFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  snapshotCurrentVersion,
  adoptSkill,
  discoverSkillSlugs,
  readManifest,
  diffSkillContent,
  applyDraftToSkill,
  restoreVersionToCurrent,
} from './version.mjs';
import { validateSlug } from './security.mjs';
import { openDb, closeDb, querySkillVersions } from './db.mjs';

const testRoot = join(tmpdir(), `foundry-version-test-${Date.now()}`);
const skillsRoot = join(testRoot, 'skills');

function writeSkill(slug, content = '# Test Skill\n') {
  const dir = join(skillsRoot, slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${slug}\ndescription: test\n---\n\n${content}`, 'utf8');
  return dir;
}

function writeDraft(type, slug, content) {
  const dir = join(testRoot, 'evolved', type, slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${slug}\ndescription: draft\n---\n\n${content}`, 'utf8');
  writeFileSync(join(dir, '.provenance.json'), JSON.stringify({
    source: 'test',
    created_at: new Date().toISOString(),
    confidence: 0.8,
    author: 'test',
  }), 'utf8');
  return dir;
}

before(() => {
  mkdirSync(skillsRoot, { recursive: true });
  process.env.FOUNDRY_MEMORY_ROOT = join(testRoot, 'memory');
});

after(() => {
  closeDb();
  rmSync(testRoot, { recursive: true, force: true });
});

describe('snapshotCurrentVersion', () => {
  it('creates baseline and archives before FIX update', () => {
    writeSkill('fix-target', 'version one\n');
    const db = openDb();

    const snap = snapshotCurrentVersion('fix-target', skillsRoot, {
      evolutionType: 'FIX',
      summary: 'pre-fix archive',
      db,
    });

    assert.equal(snap.version, 2);
    const manifest = readManifest(join(skillsRoot, 'fix-target'));
    assert.equal(manifest.current_version, 2);
    assert.ok(existsSync(join(skillsRoot, 'fix-target', '.foundry', 'versions', 'v2', 'SKILL.md')));

    const versions = querySkillVersions(db, 'fix-target', 10);
    assert.ok(versions.length >= 2);
  });
});

describe('applyDraftToSkill FIX', () => {
  it('merges draft SKILL.md into existing skill', () => {
    writeSkill('merge-target', 'old content\n');
    const draftDir = writeDraft('FIX', 'merge-target', 'new content\n');

    applyDraftToSkill('merge-target', skillsRoot, draftDir, 'FIX');
    const current = readFileSync(join(skillsRoot, 'merge-target', 'SKILL.md'), 'utf8');
    assert.match(current, /new content/);
  });
});

describe('adoptSkill', () => {
  it('creates v1 manifest and snapshot', () => {
    writeSkill('adopt-me');
    const db = openDb();
    const result = adoptSkill('adopt-me', skillsRoot, { db });

    assert.equal(result.status, 'adopted');
    assert.equal(result.version, 1);
    const manifest = readManifest(join(skillsRoot, 'adopt-me'));
    assert.equal(manifest.current_version, 1);
    assert.equal(manifest.versions[0].evolution_type, 'ADOPTED');
    assert.ok(existsSync(join(skillsRoot, 'adopt-me', '.foundry', 'versions', 'v1', 'SKILL.md')));
  });

  it('skips already adopted skills', () => {
    writeSkill('already-adopted');
    adoptSkill('already-adopted', skillsRoot, {});
    const again = adoptSkill('already-adopted', skillsRoot, {});
    assert.equal(again.status, 'skipped');
  });
});

describe('discoverSkillSlugs', () => {
  it('excludes _deprecated directories', () => {
    writeSkill('visible-skill');
    const deprecatedDir = join(skillsRoot, '_deprecated', 'hidden-skill');
    mkdirSync(deprecatedDir, { recursive: true });
    writeFileSync(join(deprecatedDir, 'SKILL.md'), '# hidden\n', 'utf8');

    const slugs = discoverSkillSlugs(skillsRoot).map((s) => s.slug);
    assert.ok(slugs.includes('visible-skill'));
    assert.ok(!slugs.includes('hidden-skill'));
  });

  it('only returns valid slugs', () => {
    const badDir = join(skillsRoot, 'Bad_Slug');
    mkdirSync(badDir, { recursive: true });
    writeFileSync(join(badDir, 'SKILL.md'), '# bad\n', 'utf8');

    const slugs = discoverSkillSlugs(skillsRoot).map((s) => s.slug);
    assert.ok(!slugs.includes('Bad_Slug'));
    assert.throws(() => validateSlug('Bad_Slug'), /Invalid slug/);
  });
});

describe('diffSkillContent', () => {
  it('reports line changes', () => {
    const diff = diffSkillContent('line a\nline b\n', 'line a\nline c\n');
    assert.match(diff, /- line b/);
    assert.match(diff, /\+ line c/);
  });
});

describe('restoreVersionToCurrent', () => {
  it('restores SKILL.md from version directory', () => {
    writeSkill('rollback-target', 'current\n');
    adoptSkill('rollback-target', skillsRoot, {});
    writeFileSync(join(skillsRoot, 'rollback-target', 'SKILL.md'), 'broken\n', 'utf8');

    restoreVersionToCurrent('rollback-target', skillsRoot, 1);
    const content = readFileSync(join(skillsRoot, 'rollback-target', 'SKILL.md'), 'utf8');
    assert.match(content, /rollback-target/);
  });
});
