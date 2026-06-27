/** @deprecated 請改用 paths.mjs；保留相容 re-export */
export {
  getFoundryRepoRoot as FOUNDRY_ROOT,
  getFoundryRepoRoot,
  getMemoryRoot,
  getSharedMemoryRoot,
  getSkillsRoot as getSkillsDest,
  getSkillsRoot,
  getProjectRunsRoot,
  PATHS,
  EVOLUTION_TYPES,
  SESSION_STATUS,
  QUEUE_STATUS,
} from './paths.mjs';
