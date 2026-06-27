#!/usr/bin/env node
import { analyzeSession } from './analyze.mjs';
import { writeEvolvedDraft } from '../evolver/evolve.mjs';
import { openDb, upsertSkill } from '../../packages/hook-bridge/db.mjs';

const sessionId = process.argv[2];
if (!sessionId) {
  process.stderr.write('Usage: node agents/analyzer/run.mjs <session-id>\n');
  process.exit(1);
}

try {
  const draft = analyzeSession(sessionId);
  const paths = writeEvolvedDraft(draft);
  const db = openDb();
  upsertSkill(db, {
    skillId: crypto.randomUUID(),
    slug: draft.slug,
    origin: `session:${sessionId}`,
    path: paths.dir,
    state: 'draft',
  });
  process.stdout.write(JSON.stringify({ ok: true, slug: draft.slug, ...paths }, null, 2));
  process.stdout.write('\n');
} catch (err) {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}
