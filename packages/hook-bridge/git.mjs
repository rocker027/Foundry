import { spawnSync } from 'node:child_process';
import { validateSlug } from './security.mjs';

const SPAWN_OPTS = {
  encoding: 'utf8',
  shell: false,
  stdio: ['ignore', 'pipe', 'ignore'],
};

/** 取得專案 git 上下文（分支與短 commit） */
export function getGitContext(projectRoot) {
  if (!projectRoot) return { branch: null, commit: null };
  try {
    const branchResult = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      ...SPAWN_OPTS,
      cwd: projectRoot,
    });
    const commitResult = spawnSync('git', ['rev-parse', '--short', 'HEAD'], {
      ...SPAWN_OPTS,
      cwd: projectRoot,
    });
    if (branchResult.error || commitResult.error) {
      return { branch: null, commit: null };
    }
    const branch = (branchResult.stdout || '').trim();
    const commit = (commitResult.stdout || '').trim();
    return { branch: branch || null, commit: commit || null };
  } catch {
    return { branch: null, commit: null };
  }
}

/** 在 skills 目標目錄執行 git diff */
export function gitDiffInSkillsRoot(skillsRoot, targetPath) {
  validateSlug(targetPath);
  try {
    const result = spawnSync('git', ['diff', '--', targetPath], {
      ...SPAWN_OPTS,
      cwd: skillsRoot,
      maxBuffer: 4 * 1024 * 1024,
    });
    if (result.error) return '';
    return result.stdout || '';
  } catch {
    return '';
  }
}

/** 檢查路徑是否在 git 儲存庫內 */
export function isGitRepo(dir) {
  try {
    const result = spawnSync('git', ['rev-parse', '--git-dir'], {
      ...SPAWN_OPTS,
      cwd: dir,
    });
    return !result.error && result.status === 0;
  } catch {
    return false;
  }
}
