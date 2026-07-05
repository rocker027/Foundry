import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = join(dirname(fileURLToPath(import.meta.url)), 'adapters/deny-read.mjs');

function runDenyRead(stdin = '') {
  return spawnSync('node', [script], {
    input: stdin,
    encoding: 'utf8',
  });
}

describe('deny-read adapter', () => {
  it('allows normal paths', () => {
    const result = runDenyRead(JSON.stringify({ file_path: '/tmp/project/src/index.ts' }));
    assert.equal(result.status, 0);
    assert.match(result.stdout, /"permission":"allow"/);
  });

  it('denies sensitive paths with exit 2', () => {
    const result = runDenyRead(JSON.stringify({ file_path: '/tmp/.env' }));
    assert.equal(result.status, 2);
    assert.match(result.stdout, /"permission":"deny"/);
  });

  it('fails closed on invalid JSON', () => {
    const result = runDenyRead('{not-json');
    assert.equal(result.status, 2);
    assert.match(result.stdout, /"permission":"deny"/);
  });
});
