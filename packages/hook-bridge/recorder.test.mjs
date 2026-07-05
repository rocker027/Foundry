import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { recordEvent, readSessionEvents } from './recorder.mjs';
import { closeDb } from './db.mjs';

const testRoot = join(tmpdir(), `foundry-recorder-test-${Date.now()}`);

before(() => {
  process.env.FOUNDRY_MEMORY_ROOT = testRoot;
  process.env.FOUNDRY_PROJECT_RUNS = join(testRoot, 'runs');
  mkdirSync(join(testRoot, 'runs'), { recursive: true });
});

after(() => {
  closeDb();
  rmSync(testRoot, { recursive: true, force: true });
});

describe('recorder', () => {
  it('writes redacted JSONL events', () => {
    const sessionId = crypto.randomUUID();
    const { jsonlPath } = recordEvent({
      tool: 'cursor',
      session_id: sessionId,
      event: 'after_edit',
      ts: new Date().toISOString(),
      project_root: testRoot,
      payload: {
        command: 'export api_key=supersecretvalue12345',
        files: ['src/index.ts', '.env'],
      },
    });

    assert.ok(existsSync(jsonlPath));
    const text = readFileSync(jsonlPath, 'utf8');
    assert.ok(text.includes('[REDACTED]'));
    assert.ok(!text.includes('supersecretvalue12345'));
    assert.ok(!text.includes('.env'));

    const events = readSessionEvents(jsonlPath);
    assert.equal(events.length, 1);
    assert.equal(events[0].session_id, sessionId);
  });
});
