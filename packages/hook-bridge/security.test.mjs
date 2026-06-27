import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  validateSlug,
  isDeniedPath,
  assertPathWithinRoot,
} from './security.mjs';

describe('validateSlug', () => {
  it('accepts valid slugs', () => {
    assert.equal(validateSlug('my-skill'), 'my-skill');
    assert.equal(validateSlug('a'), 'a');
    assert.equal(validateSlug('skill-123'), 'skill-123');
  });

  it('rejects path traversal and invalid characters', () => {
    assert.throws(() => validateSlug('../etc/passwd'), /Invalid slug/);
    assert.throws(() => validateSlug('foo/bar'), /Invalid slug/);
    assert.throws(() => validateSlug(''), /Invalid slug/);
    assert.throws(() => validateSlug('UPPER'), /Invalid slug/);
    assert.throws(() => validateSlug('-leading-dash'), /Invalid slug/);
    assert.throws(() => validateSlug('a'.repeat(65)), /Invalid slug/);
  });
});

describe('isDeniedPath', () => {
  it('flags sensitive file names', () => {
    assert.equal(isDeniedPath('.env'), true);
    assert.equal(isDeniedPath('/path/to/.env.local'), true);
    assert.equal(isDeniedPath('credentials.json'), true);
    assert.equal(isDeniedPath('id_rsa'), true);
    assert.equal(isDeniedPath('server.pem'), true);
  });

  it('allows normal paths', () => {
    assert.equal(isDeniedPath('SKILL.md'), false);
    assert.equal(isDeniedPath('/tmp/project/src/index.ts'), false);
  });
});

describe('assertPathWithinRoot', () => {
  const root = join(tmpdir(), 'foundry-test-root');

  it('allows paths within root', () => {
    assert.doesNotThrow(() => assertPathWithinRoot(join(root, 'child'), root));
    assert.doesNotThrow(() => assertPathWithinRoot(root, root));
  });

  it('rejects paths that escape root', () => {
    assert.throws(
      () => assertPathWithinRoot(join(root, '..', 'outside'), root),
      /Path escapes root/,
    );
  });
});
