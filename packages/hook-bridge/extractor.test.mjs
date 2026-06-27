import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { closeDb, openDb, queryExperiences, queryKnowledgeEntries } from './db.mjs';
import { scoreSessionRubric, extractSession } from '../../agents/extractor/extract.mjs';
import { evaluateSessionSuccess } from './session-success.mjs';

const testRoot = join(tmpdir(), `foundry-extractor-test-${Date.now()}`);

function makeEvents({ sessionId, prompt, files = [], commands = [], failed = false }) {
  const events = [
    {
      event: 'before_task',
      tool: 'cursor',
      session_id: sessionId,
      project_root: '/tmp/project',
      payload: { prompt },
    },
  ];
  for (const f of files) {
    events.push({
      event: 'after_edit',
      tool: 'cursor',
      session_id: sessionId,
      project_root: '/tmp/project',
      payload: { files: [f] },
    });
  }
  for (const cmd of commands) {
    events.push({
      event: 'after_command',
      tool: 'cursor',
      session_id: sessionId,
      project_root: '/tmp/project',
      payload: {
        command: cmd,
        exit_code: failed ? 1 : 0,
      },
    });
  }
  events.push({
    event: 'after_task',
    tool: 'cursor',
    session_id: sessionId,
    project_root: '/tmp/project',
    payload: {},
  });
  return events;
}

describe('session success filter', () => {
  it('marks failed commands as unsuccessful', () => {
    const events = makeEvents({
      sessionId: 's1',
      prompt: 'fix bug',
      files: ['a.ts'],
      commands: ['npm test'],
      failed: true,
    });
    const result = evaluateSessionSuccess(events);
    assert.equal(result.success, false);
    assert.equal(result.reason, 'command_failed');
  });

  it('accepts successful workflow sessions', () => {
    const events = makeEvents({
      sessionId: 's2',
      prompt: 'implement feature with tests',
      files: ['a.ts', 'b.ts', 'c.ts'],
      commands: ['npm test', 'npm run build'],
    });
    const result = evaluateSessionSuccess(events);
    assert.equal(result.success, true);
  });
});

describe('extractor rubric', () => {
  it('scores high-value workflow as 3', () => {
    const summary = {
      file_count: 4,
      files: ['a.ts', 'b.ts', 'c.ts', 'd.ts'],
      commands: ['npm test', 'npm run lint'],
      prompt: 'Refactor auth module with comprehensive tests',
      event_count: 10,
    };
    const rubric = scoreSessionRubric(summary, []);
    assert.equal(rubric.score, 3);
    assert.equal(rubric.workflowSignals, true);
  });

  it('scores trivial session as 0-1', () => {
    const summary = {
      file_count: 0,
      files: [],
      commands: [],
      prompt: 'hi',
      event_count: 2,
    };
    const rubric = scoreSessionRubric(summary, []);
    assert.ok(rubric.score <= 1);
  });
});

describe('extractSession integration', () => {
  before(() => {
    closeDb();
    process.env.FOUNDRY_MEMORY_ROOT = testRoot;
    mkdirSync(join(testRoot, 'shared-agent-memory', 'runs', 'cursor', '2026-06-27'), { recursive: true });
  });

  after(() => {
    closeDb();
    rmSync(testRoot, { recursive: true, force: true });
    delete process.env.FOUNDRY_MEMORY_ROOT;
  });

  it('writes experience for score>=2 successful session', () => {
    const sessionId = crypto.randomUUID();
    const jsonlPath = join(testRoot, 'shared-agent-memory', 'runs', 'cursor', '2026-06-27', `${sessionId}.jsonl`);
    const events = makeEvents({
      sessionId,
      prompt: 'Fix null pointer exception in service layer',
      files: ['src/service.ts', 'src/util.ts'],
      commands: ['npm test'],
    });
    writeFileSync(jsonlPath, events.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');

    const db = openDb();
    db.prepare(`
      INSERT INTO sessions (session_id, tool, project_root, git_branch, started_at, status)
      VALUES (?, 'cursor', '/tmp/project', 'main', ?, 'ended')
    `).run(sessionId, new Date().toISOString());
    db.prepare(`
      INSERT INTO events (session_id, event_type, ts, jsonl_path, jsonl_offset)
      VALUES (?, 'after_task', ?, ?, 0)
    `).run(sessionId, new Date().toISOString(), jsonlPath);

    const result = extractSession(sessionId);
    assert.equal(result.skipped, undefined);
    assert.ok(result.score >= 2);
    assert.ok(result.writes.length >= 1);

    const hasExperience = result.writes.some((w) => w.type === 'experience')
      || queryExperiences(db).some((e) => e.session_id === sessionId);
    const knowledge = queryKnowledgeEntries(db);
    assert.ok(hasExperience || knowledge.length > 0);
  });

  it('skips failed sessions', () => {
    const sessionId = crypto.randomUUID();
    const jsonlPath = join(testRoot, 'shared-agent-memory', 'runs', 'cursor', '2026-06-27', `${sessionId}-fail.jsonl`);
    const events = makeEvents({
      sessionId,
      prompt: 'run tests',
      files: ['a.ts'],
      commands: ['npm test'],
      failed: true,
    });
    writeFileSync(jsonlPath, events.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');

    const db = openDb();
    db.prepare(`
      INSERT INTO sessions (session_id, tool, project_root, git_branch, started_at, status)
      VALUES (?, 'cursor', '/tmp/project', 'main', ?, 'ended')
    `).run(sessionId, new Date().toISOString());
    db.prepare(`
      INSERT INTO events (session_id, event_type, ts, jsonl_path, jsonl_offset)
      VALUES (?, 'after_task', ?, ?, 0)
    `).run(sessionId, new Date().toISOString(), jsonlPath);

    const result = extractSession(sessionId);
    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'command_failed');
  });
});
