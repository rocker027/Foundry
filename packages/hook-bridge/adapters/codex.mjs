import { recordEvent } from '../recorder.mjs';
import { normalizeCodexEvent } from '../normalize.mjs';
import { buildAdditionalContext } from '../retriever.mjs';
import { enqueueSessionAnalyze } from '../queue.mjs';
import { chainSupersetNotify } from './chain.mjs';

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function asString(v) {
  return typeof v === 'string' ? v : '';
}

function hookEventName(payload) {
  const raw = asString(
    payload.hook_event_name || payload.hookEventName || payload.event || payload.name,
  ).trim();
  return raw;
}

async function main() {
  const raw = (await readStdin()).trim();
  let payload = {};
  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch (err) {
      process.stderr.write(`[foundry:codex] Invalid JSON: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(0);
    }
  }
  const hookName = asString(process.argv[2]).trim() || hookEventName(payload);

  const normalized = normalizeCodexEvent(hookName, payload);
  let output = null;

  if (normalized) {
    recordEvent(normalized);

    if (normalized.event === 'before_task') {
      const prompt = normalized.payload?.prompt || '';
      const ctx = buildAdditionalContext(prompt);
      if (ctx) {
        output = {
          hookSpecificOutput: {
            hookEventName: hookName,
            additionalContext: ctx,
          },
        };
      }
    }

    if (normalized.event === 'after_task') {
      enqueueSessionAnalyze(normalized.session_id);
    }
  }

  try {
    chainSupersetNotify(raw);
  } catch {
    // Superset 可選
  }

  if (output) {
    process.stdout.write(`${JSON.stringify(output)}\n`);
  } else if (hookName === 'Stop') {
    process.stdout.write('{}\n');
  }
}

main().catch((err) => {
  process.stderr.write(`[foundry:codex] ${err instanceof Error ? err.message : String(err)}\n`);
});
