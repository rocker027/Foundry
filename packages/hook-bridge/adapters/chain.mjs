import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

const SUPERSET_CURSOR = join(homedir(), '.superset', 'hooks', 'cursor-hook.sh');
const SUPERSET_NOTIFY = join(homedir(), '.superset', 'hooks', 'notify.sh');

function asString(v) {
  return typeof v === 'string' ? v : '';
}

/** 解析 hook stdout 中的 JSON */
export function parseJsonOutput(stdout) {
  const text = asString(stdout).trim();
  if (!text) return null;
  const line = text.split(/\r?\n/).find((c) => c.trim().startsWith('{'));
  if (!line) return null;
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

/** 執行子 hook 腳本 */
export function runScript(script, args = [], { input = '', timeout = 5000 } = {}) {
  const result = spawnSync(script, args, {
    input,
    encoding: 'utf8',
    timeout,
    maxBuffer: 1024 * 1024,
    shell: false,
  });
  if (result.stderr) process.stderr.write(result.stderr);
  return result;
}

/** 執行 node adapter */
export function runNodeAdapter(adapterPath, args, input, timeout = 5000) {
  const result = spawnSync(process.execPath, [adapterPath, ...args], {
    input,
    encoding: 'utf8',
    timeout,
    maxBuffer: 1024 * 1024,
  });
  if (result.stderr) process.stderr.write(result.stderr);
  return result;
}

/** 合併 additional_context */
export function mergeHookOutputs(primary, secondary) {
  if (!primary) return secondary;
  if (!secondary) return primary;

  const pCtx = asString(primary?.additional_context || primary?.hookSpecificOutput?.additionalContext);
  const sCtx = asString(secondary?.additional_context || secondary?.hookSpecificOutput?.additionalContext);
  const merged = { ...primary };

  if (pCtx || sCtx) {
    merged.additional_context = [pCtx, sCtx].filter(Boolean).join('\n\n');
    merged.hookSpecificOutput = {
      ...(merged.hookSpecificOutput || {}),
      additionalContext: merged.additional_context,
    };
  }
  return merged;
}

/** 串接 Superset cursor hook */
export function chainSupersetCursor(eventType, input) {
  const map = { before_task: 'Start', after_task: 'Stop' };
  const supersetEvent = map[eventType];
  if (!supersetEvent) return null;
  return runScript(SUPERSET_CURSOR, [supersetEvent], { input, timeout: 2000 });
}

/** 串接 Superset notify hook（Codex/Claude） */
export function chainSupersetNotify(input) {
  return runScript(SUPERSET_NOTIFY, [], { input, timeout: 2000 });
}

export { SUPERSET_CURSOR, SUPERSET_NOTIFY };
