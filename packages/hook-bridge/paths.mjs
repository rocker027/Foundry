import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

/** Foundry 儲存庫根目錄 */
export function getFoundryRepoRoot() {
  return process.env.FOUNDRY_REPO_ROOT || resolve(__dirname, '..', '..');
}

/** 記憶資料根目錄，預設 ~/.foundry */
export function getMemoryRoot() {
  return process.env.FOUNDRY_MEMORY_ROOT || join(homedir(), '.foundry');
}

/** 全域共用記憶目錄 */
export function getSharedMemoryRoot() {
  return join(getMemoryRoot(), 'shared-agent-memory');
}

/** 正式 skills 目的地 */
export function getSkillsRoot() {
  return process.env.FOUNDRY_SKILLS_ROOT
    || join(homedir(), 'Documents', 'code', 'ai_coding_labs', 'skills');
}

/** 專案級 runs overlay */
export function getProjectRunsRoot(projectRoot) {
  if (process.env.FOUNDRY_PROJECT_RUNS) {
    return resolve(process.env.FOUNDRY_PROJECT_RUNS);
  }
  if (projectRoot) {
    return join(resolve(projectRoot), '.foundry', 'runs');
  }
  return join(getSharedMemoryRoot(), 'runs');
}

export const PATHS = {
  skills: () => join(getSharedMemoryRoot(), 'skills'),
  runs: () => join(getSharedMemoryRoot(), 'runs'),
  evolved: () => join(getSharedMemoryRoot(), 'evolved'),
  queue: () => join(getSharedMemoryRoot(), 'queue'),
  agents: () => join(getSharedMemoryRoot(), 'agents'),
  sqlite: () => join(getSharedMemoryRoot(), 'skill_store.sqlite'),
  staging: () => join(getMemoryRoot(), 'skills-staging'),
};

export const EVOLUTION_TYPES = ['FIX', 'DERIVED', 'CAPTURED'];
export const SESSION_STATUS = ['active', 'ended', 'archived'];
export const QUEUE_STATUS = ['pending', 'processing', 'done', 'failed'];
