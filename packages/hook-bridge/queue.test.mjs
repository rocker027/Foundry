import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync, writeFileSync, rmSync, existsSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  listPendingJobFiles, claimJob, completeJob, readJobFile,
} from './queue.mjs';
import { closeDb } from './db.mjs';

const testRoot = join(tmpdir(), `foundry-queue-test-${Date.now()}`);

before(() => {
  process.env.FOUNDRY_MEMORY_ROOT = testRoot;
  mkdirSync(join(testRoot, 'shared-agent-memory', 'queue'), { recursive: true });
});

after(() => {
  closeDb();
  rmSync(testRoot, { recursive: true, force: true });
});

function writeJob(name, body) {
  const path = join(testRoot, 'shared-agent-memory', 'queue', name);
  writeFileSync(path, JSON.stringify(body, null, 2), 'utf8');
  return path;
}

describe('queue reliability', () => {
  it('skips active processing jobs', () => {
    const path = writeJob('active.json', {
      job_id: 'active-1',
      session_id: 'sess-1',
      type: 'analyze',
      status: 'processing',
      claimed_at: new Date().toISOString(),
      retry_count: 0,
      created_at: new Date().toISOString(),
    });
    assert.equal(claimJob(path), null);
  });

  it('retries failed jobs once before deleting', () => {
    const path = writeJob('retry.json', {
      job_id: 'retry-1',
      session_id: 'sess-2',
      type: 'analyze',
      status: 'pending',
      retry_count: 0,
      created_at: new Date().toISOString(),
    });
    const claimed = claimJob(path);
    assert.ok(claimed);
    const first = completeJob(path, { status: 'failed', error: 'boom' });
    assert.equal(first.retried, true);
    const job = readJobFile(path);
    assert.equal(job.status, 'pending');
    assert.equal(job.retry_count, 1);

    claimJob(path);
    completeJob(path, { status: 'failed', error: 'boom again' });
    assert.equal(existsSync(path), false);
  });

  it('lists pending jobs only', () => {
    writeJob('pending.json', {
      job_id: 'pending-1',
      session_id: 'sess-3',
      status: 'pending',
      retry_count: 0,
      created_at: new Date().toISOString(),
    });
    writeJob('busy.json', {
      job_id: 'busy-1',
      session_id: 'sess-4',
      status: 'processing',
      claimed_at: new Date().toISOString(),
      retry_count: 0,
      created_at: new Date().toISOString(),
    });
    const pending = listPendingJobFiles();
    assert.equal(pending.length, 1);
    assert.match(pending[0], /pending\.json$/);
  });
});
