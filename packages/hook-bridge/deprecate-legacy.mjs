import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { openDb } from './db.mjs';
import { isLegacySkillSlug, LEGACY_SKILL_SLUGS } from './skill-filter.mjs';

const DEPRECATE_DATE = '2026-06-27';

const LEGACY_SKILL_DIRS = [
  { name: 'auto-skill', path: () => join(homedir(), '.claude', 'skills', 'auto-skill') },
  { name: 'auto-skill-claude', path: () => join(homedir(), '.claude', 'skills', 'auto-skill-claude') },
  { name: 'skill-mnemo', path: () => join(homedir(), '.claude', 'skills', 'skill-mnemo') },
];

function deprecatedDest(skillsRoot, name) {
  return join(skillsRoot, '_deprecated', DEPRECATE_DATE, name);
}

/** 產生廢棄 legacy skills 的計畫與手動步驟 */
export function planDeprecateLegacy({ execute = false } = {}) {
  const skillsRoot = join(homedir(), '.claude', 'skills');
  const actions = [];
  const manualSteps = [
    'Remove skill-mnemo hook entries from ~/.codex/hooks.json (UserPromptSubmit / Stop mnemo wrappers)',
    'Remove skill-mnemo references from global Cursor/Claude rules if present',
    'Run `foundry migrate-mnemo` and `foundry migrate-auto-skill` before deprecating if not done',
    'Verify Foundry hooks are installed: `foundry install-hooks codex`',
  ];

  for (const legacy of LEGACY_SKILL_DIRS) {
    const src = legacy.path();
    const dest = deprecatedDest(skillsRoot, legacy.name);
    if (!existsSync(src)) {
      actions.push({ name: legacy.name, src, dest, status: 'skip_not_found' });
      continue;
    }
    if (existsSync(dest)) {
      actions.push({ name: legacy.name, src, dest, status: 'skip_dest_exists' });
      continue;
    }
    actions.push({ name: legacy.name, src, dest, status: execute ? 'moved' : 'would_move' });
    if (execute) {
      mkdirSync(join(skillsRoot, '_deprecated', DEPRECATE_DATE), { recursive: true });
      renameSync(src, dest);
    }
  }

  const dbArchived = execute ? archiveLegacySkillsInDb() : [];

  return { actions, manualSteps, skillsRoot, execute, dbArchived };
}

/** 格式化廢棄報告 */
export function formatDeprecateReport(plan) {
  const lines = [
    '# Deprecate Legacy Skills',
    '',
    `- Mode: ${plan.execute ? 'EXECUTE' : 'DRY-RUN'}`,
    `- Skills root: ${plan.skillsRoot}`,
    `- Target: _deprecated/${DEPRECATE_DATE}/`,
    '',
    '## Planned moves',
    '',
  ];

  for (const a of plan.actions) {
    if (a.status === 'skip_not_found') {
      lines.push(`- SKIP (not found): ${a.name}`);
    } else if (a.status === 'skip_dest_exists') {
      lines.push(`- SKIP (dest exists): ${a.name} → ${a.dest}`);
    } else if (a.status === 'would_move') {
      lines.push(`- WOULD MOVE: ${a.src} → ${a.dest}`);
    } else {
      lines.push(`- MOVED: ${a.src} → ${a.dest}`);
    }
  }

  lines.push('', '## Manual steps (not auto-edited)', '');
  for (const step of plan.manualSteps) {
    lines.push(`1. ${step}`);
  }

  if (plan.dbArchived?.length) {
    lines.push('', '## SQLite archived slugs', '');
    for (const slug of plan.dbArchived) {
      lines.push(`- ${slug}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

/** 將 sqlite 中 legacy skill 標記為 archived */
export function archiveLegacySkillsInDb() {
  const db = openDb();
  const archived = [];
  for (const slug of LEGACY_SKILL_SLUGS) {
    const result = db.prepare(
      "UPDATE skills SET state = 'archived' WHERE slug = ? AND state != 'archived'",
    ).run(slug);
    if (result.changes > 0) archived.push(slug);
  }
  return archived;
}
