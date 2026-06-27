import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gitDiffInSkillsRoot } from './git.mjs';

describe('gitDiffInSkillsRoot', () => {
  it('rejects malicious slug before invoking git', () => {
    const malicious = 'foo; rm -rf /';
    assert.throws(
      () => gitDiffInSkillsRoot(tmpdir(), malicious),
      /Invalid slug/,
    );
  });

  it('rejects path traversal slug', () => {
    assert.throws(
      () => gitDiffInSkillsRoot(tmpdir(), '../etc/passwd'),
      /Invalid slug/,
    );
  });

  it('returns empty string for valid slug in non-git directory', () => {
    const result = gitDiffInSkillsRoot(tmpdir(), 'my-skill');
    assert.equal(result, '');
  });

  it('accepts valid slug without shell injection side effects', () => {
    const skillsRoot = join(tmpdir(), 'foundry-git-test');
    const slug = 'safe-skill-name';
    const result = gitDiffInSkillsRoot(skillsRoot, slug);
    assert.equal(typeof result, 'string');
  });
});
