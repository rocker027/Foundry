import { recordEvent } from '../recorder.mjs';
import { normalizeCursorEvent } from '../normalize.mjs';
import { buildAdditionalContext } from '../retriever.mjs';
import { enqueueSessionAnalyze } from '../queue.mjs';
import { isDeniedPath } from '../security.mjs';
import { chainSupersetCursor } from './chain.mjs';

const HOOK_ARG_MAP = {
  before_task: 'beforeSubmitPrompt',
  after_edit: 'afterFileEdit',
  after_command: 'afterShellExecution',
  after_task: 'stop',
  postToolUseFailure: 'postToolUseFailure',
  preCompact: 'preCompact',
  deny_read: 'beforeReadFile',
};

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

/** beforeReadFile：fail-closed 拒絕敏感路徑，不寫入 recorder */
function handleBeforeReadFile(payload) {
  const filePath = asString(
    payload.file_path || payload.filePath || payload.path || payload.file,
  );
  if (filePath && isDeniedPath(filePath)) {
    process.stdout.write(`${JSON.stringify({
      permission: 'deny',
      user_message: 'Foundry blocked read of sensitive path (security denylist).',
      agent_message: 'Cannot read sensitive file per Foundry security policy.',
    })}\n`);
    process.exit(2);
  }
  process.stdout.write(`${JSON.stringify({ permission: 'allow' })}\n`);
}

async function main() {
  const normalizedArg = asString(process.argv[2]).trim();
  const hookName = HOOK_ARG_MAP[normalizedArg] || asString(process.argv[2]).trim();
  const raw = (await readStdin()).trim();
  let payload = {};
  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch (err) {
      process.stderr.write(`[foundry:cursor] Invalid JSON: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(0);
    }
  }

  if (hookName === 'beforeReadFile') {
    handleBeforeReadFile(payload);
    return;
  }

  const normalized = normalizeCursorEvent(hookName, payload);
  let output = {};

  if (normalized) {
    recordEvent(normalized);

    if (normalized.event === 'before_task') {
      const prompt = normalized.payload?.prompt || '';
      const ctx = buildAdditionalContext(prompt);
      if (ctx) {
        output = { additional_context: ctx };
      }
    }

    if (normalized.event === 'after_task') {
      enqueueSessionAnalyze(normalized.session_id);
      output = { ...output, session_summary: { session_id: normalized.session_id, status: 'ended' } };
    }
  }

  // chain Superset（不阻塞主流程）
  try {
    const eventKey = normalized?.event || normalizedArg;
    chainSupersetCursor(eventKey, raw);
  } catch {
    // Superset 可選，失敗不影響 Foundry
  }

  if (Object.keys(output).length > 0) {
    process.stdout.write(`${JSON.stringify(output)}\n`);
  }
}

main().catch((err) => {
  process.stderr.write(`[foundry:cursor] ${err instanceof Error ? err.message : String(err)}\n`);
});
