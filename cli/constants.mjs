import { join } from 'node:path';
import { getFoundryRepoRoot } from '../packages/hook-bridge/paths.mjs';

export const REPO_ROOT = getFoundryRepoRoot();
export const CURSOR_ADAPTER = join(REPO_ROOT, 'packages/hook-bridge/adapters/cursor.mjs');
export const DENY_READ_ADAPTER = join(REPO_ROOT, 'packages/hook-bridge/adapters/deny-read.mjs');
export const CODEX_ADAPTER = join(REPO_ROOT, 'packages/hook-bridge/adapters/codex.mjs');
export const CLAUDE_ADAPTER = join(REPO_ROOT, 'packages/hook-bridge/adapters/claude.mjs');
