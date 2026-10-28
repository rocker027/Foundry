import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import {
  REPO_ROOT, CURSOR_ADAPTER, DENY_READ_ADAPTER, CODEX_ADAPTER, CLAUDE_ADAPTER,
} from '../constants.mjs';
import { getMemoryRoot, getSkillsRoot } from '../../packages/hook-bridge/paths.mjs';

export function installCursorHooks(targetDir) {
  const hooksDir = join(targetDir, '.cursor');
  mkdirSync(hooksDir, { recursive: true });
  const hooksPath = join(hooksDir, 'hooks.json');
  const config = {
    version: 1,
    hooks: {
      beforeSubmitPrompt: [
        { command: `node ${CURSOR_ADAPTER} before_task`, timeout: 5 },
      ],
      afterFileEdit: [
        { command: `node ${CURSOR_ADAPTER} after_edit`, timeout: 3 },
      ],
      afterShellExecution: [
        { command: `node ${CURSOR_ADAPTER} after_command`, timeout: 3 },
      ],
      stop: [
        { command: `node ${CURSOR_ADAPTER} after_task`, timeout: 5 },
      ],
      postToolUseFailure: [
        { command: `node ${CURSOR_ADAPTER} postToolUseFailure`, timeout: 3 },
      ],
      preCompact: [
        { command: `node ${CURSOR_ADAPTER} preCompact`, timeout: 3 },
      ],
      beforeReadFile: [
        {
          command: `node ${DENY_READ_ADAPTER}`,
          timeout: 3,
          failClosed: true,
        },
      ],
    },
  };
  writeFileSync(hooksPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return hooksPath;
}

export function installCodexHooks() {
  const hooksPath = join(homedir(), '.codex', 'hooks.json');
  mkdirSync(dirname(hooksPath), { recursive: true });
  let existing = { hooks: {} };
  if (existsSync(hooksPath)) {
    try {
      existing = JSON.parse(readFileSync(hooksPath, 'utf8'));
    } catch {
      existing = { hooks: {} };
    }
  }
  const entry = (event) => ({ command: `node ${CODEX_ADAPTER} ${event}`, timeout: 5 });
  const hooks = existing.hooks || {};
  const merge = (key, ev) => {
    const list = Array.isArray(hooks[key]) ? hooks[key] : [];
    const cmd = entry(ev);
    if (!JSON.stringify(list).includes(CODEX_ADAPTER)) {
      hooks[key] = [cmd, ...list];
    }
  };
  merge('UserPromptSubmit', 'UserPromptSubmit');
  merge('Stop', 'Stop');
  merge('PostToolUse', 'PostToolUse');
  merge('SessionStart', 'SessionStart');
  writeFileSync(hooksPath, `${JSON.stringify({ ...existing, hooks }, null, 2)}\n`, 'utf8');
  return hooksPath;
}

export function installClaudeHooks() {
  const settingsPath = join(homedir(), '.claude', 'settings.json');
  mkdirSync(dirname(settingsPath), { recursive: true });
  let existing = { hooks: {} };
  if (existsSync(settingsPath)) {
    try {
      existing = JSON.parse(readFileSync(settingsPath, 'utf8'));
    } catch {
      existing = { hooks: {} };
    }
  }
  const hooks = existing.hooks || {};
  const addHook = (key, event) => {
    const list = Array.isArray(hooks[key]) ? hooks[key] : [];
    const cmd = { command: `node ${CLAUDE_ADAPTER} ${event}`, timeout: 5 };
    if (!JSON.stringify(list).includes(CLAUDE_ADAPTER)) {
      hooks[key] = [cmd, ...list];
    }
  };
  addHook('SessionStart', 'SessionStart');
  addHook('PostToolUse', 'PostToolUse');
  addHook('Stop', 'Stop');
  writeFileSync(settingsPath, `${JSON.stringify({ ...existing, hooks }, null, 2)}\n`, 'utf8');
  return settingsPath;
}

export function cmdInstallHooks(tool, target) {
  const t = tool?.toLowerCase();
  let path;
  if (t === 'cursor') {
    path = installCursorHooks(target || process.cwd());
  } else if (t === 'codex') {
    path = installCodexHooks();
  } else if (t === 'claude') {
    path = installClaudeHooks();
  } else {
    process.stderr.write('Unknown tool. Use: cursor|codex|claude\n');
    process.exit(1);
  }
  process.stdout.write(`Installed Foundry hooks: ${path}\n`);
  process.stdout.write('Superset hooks are chained automatically in adapters.\n');
}

export function cmdSetup(args) {
  const targetIdx = args.indexOf('--target');
  const target = targetIdx >= 0 ? args[targetIdx + 1] : process.cwd();
  const installLaunchd = args.includes('--install-launchd');

  const lines = [
    '# Foundry Setup',
    '',
    'Add to your shell profile:',
    '',
    `export FOUNDRY_REPO_ROOT="${REPO_ROOT}"`,
    `export FOUNDRY_MEMORY_ROOT="${getMemoryRoot()}"`,
    `export FOUNDRY_SKILLS_ROOT="${getSkillsRoot()}"`,
    '',
    'Installing hooks...',
    '',
  ];
  process.stdout.write(`${lines.join('\n')}\n`);

  cmdInstallHooks('codex');
  cmdInstallHooks('claude');
  cmdInstallHooks('cursor', target);

  if (installLaunchd) {
    const script = join(REPO_ROOT, 'scripts', 'install-launchd.sh');
    const result = spawnSync('bash', [script], { stdio: 'inherit' });
    if (result.status !== 0) {
      process.exit(result.status ?? 1);
    }
  } else {
    process.stdout.write('\nOptional: ./scripts/install-launchd.sh for background queue-worker\n');
  }

  process.stdout.write('\nSetup complete. See docs/SOP.md for weekly workflow.\n');
}
