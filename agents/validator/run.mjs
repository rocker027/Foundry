#!/usr/bin/env node
import { validateDraft, auditMemoryStore } from './validate.mjs';

const cmd = process.argv[2];
if (cmd === 'audit') {
  const result = auditMemoryStore();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(result.ok ? 0 : 1);
}

const slug = cmd;
const type = process.argv[3] || 'CAPTURED';
if (!slug) {
  process.stderr.write('Usage: node agents/validator/run.mjs <slug> [FIX|DERIVED|CAPTURED]\n');
  process.stderr.write('       node agents/validator/run.mjs audit\n');
  process.exit(1);
}

const result = validateDraft(slug, type);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
process.exit(result.valid ? 0 : 1);
