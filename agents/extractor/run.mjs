#!/usr/bin/env node
import { extractSession } from './extract.mjs';
import { closeDb } from '../../packages/hook-bridge/db.mjs';

const sessionId = process.argv[2];
if (!sessionId) {
  process.stderr.write('Usage: node agents/extractor/run.mjs <session-id>\n');
  process.exit(1);
}

try {
  const result = extractSession(sessionId);
  process.stdout.write(`${JSON.stringify({ ok: true, ...result }, null, 2)}\n`);
} catch (err) {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
} finally {
  closeDb();
}
