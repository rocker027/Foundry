#!/usr/bin/env node
import {
  mkdirSync, writeFileSync, readFileSync, existsSync, cpSync, readdirSync,
} from 'node:fs';
import { join, dirname, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { openDb, getStatusStats, closeDb, upsertSkill, insertLineage, querySkillVersions, updateExperienceState, insertSkillVersion } from '../packages/hook-bridge/db.mjs';
import {
  getFoundryRepoRoot, getMemoryRoot, getSkillsRoot, PATHS,
} from '../packages/hook-bridge/paths.mjs';
import { auditMemoryStore, validateDraft } from '../agents/validator/validate.mjs';
import { analyzeSession } from '../agents/analyzer/analyze.mjs';
import { extractSession } from '../agents/extractor/extract.mjs';
import { writeEvolvedDraft } from '../agents/evolver/evolve.mjs';
import { listPendingJobFiles, claimJob, completeJob } from '../packages/hook-bridge/queue.mjs';
import { gitDiffInSkillsRoot, isGitRepo } from '../packages/hook-bridge/git.mjs';
import { recordEvent } from '../packages/hook-bridge/recorder.mjs';
import { validateSlug, assertPathWithinRoot } from '../packages/hook-bridge/security.mjs';
import { archiveRuns, DEFAULT_RETENTION_DAYS } from '../packages/hook-bridge/archive.mjs';
import {
  snapshotCurrentVersion, adoptSkill, discoverSkillSlugs, readManifest, readVersionSkillContent,
  diffSkillContent, applyDraftToSkill, restoreVersionToCurrent, writeVersionDiff, isSkillLocked,
  createInitialManifest, writeManifest, copySkillToVersionDir, versionDir,
} from '../packages/hook-bridge/version.mjs';
import { migrateMnemo, migrateAutoSkill } from '../packages/hook-bridge/migrate.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = getFoundryRepoRoot();
const CURSOR_ADAPTER = join(REPO_ROOT, 'packages/hook-bridge/adapters/cursor.mjs');
const CODEX_ADAPTER = join(REPO_ROOT, 'packages/hook-bridge/adapters/codex.mjs');
const CLAUDE_ADAPTER = join(REPO_ROOT, 'packages/hook-bridge/adapters/claude.mjs');

function usage() {
  process.stdout.write(`Foundry CLI v0.2.0

Usage:
  foundry status
  foundry audit
  foundry install-hooks <cursor|codex|claude> [--target <path>]
  foundry analyze --session <id>
  foundry apply <slug> [--type CAPTURED|FIX|DERIVED] [--draft <slug>] [--parent <slug>] [--force]
  foundry promote <slug>   (alias for apply)
  foundry adopt [--dry-run] [--slug <name>]
  foundry history <slug>
  foundry diff <slug> [--from vN] [--to current|vN]
  foundry rollback <slug> --to vN [--force]
  foundry review
  foundry migrate-mnemo [--dry-run] [--path <dir>]
  foundry migrate-auto-skill [--dry-run] [--path <dir>]
  foundry queue-worker [--once]
  foundry autopromote [--dry-run]
  foundry archive [--days 90] [--dry-run]
  foundry simulate-recorder

Environment:
  FOUNDRY_MEMORY_ROOT   (default: ~/.foundry)
  FOUNDRY_SKILLS_ROOT   (default: ~/.claude/skills)
  FOUNDRY_REPO_ROOT     (default: Foundry repo path)
`);
}

function cmdStatus() {
  mkdirSync(PATHS.runs(), { recursive: true });
  const db = openDb();
  const stats = getStatusStats(db);
  const memoryRoot = getMemoryRoot();
  const skillsRoot = getSkillsRoot();

  const lines = [
    '# Foundry Status',
    '',
    `- Memory root: ${memoryRoot}`,
    `- Skills root: ${skillsRoot}`,
    `- SQLite: ${PATHS.sqlite()}`,
    '',
    '## Sessions',
    `- Total: ${stats.sessions}`,
    `- Active: ${stats.active}`,
    '',
    '## Evolution',
    `- Queue pending: ${stats.queuePending}`,
    `- Skills (draft/staging/promoted): ${stats.evolved}`,
    `- Promoted: ${stats.promoted}`,
    '',
  ];

  const evolvedRoot = PATHS.evolved();
  if (existsSync(evolvedRoot)) {
    const drafts = [];
    for (const type of ['CAPTURED', 'DERIVED', 'FIX']) {
      const typeDir = join(evolvedRoot, type);
      if (!existsSync(typeDir)) continue;
      for (const slug of readdirSync(typeDir)) {
        drafts.push(`${type}/${slug}`);
      }
    }
    lines.push('## Evolved drafts', '');
    if (drafts.length === 0) lines.push('- (none)');
    else drafts.forEach((d) => lines.push(`- ${d}`));
    lines.push('');
  }

  process.stdout.write(`${lines.join('\n')}\n`);
}

function cmdAudit() {
  const result = auditMemoryStore();
  const lines = [
    '# Foundry Security Audit',
    '',
    `- Memory root: ${getMemoryRoot()}`,
    `- OK: ${result.ok}`,
    `- Issues: ${result.issue_count}`,
    '',
  ];
  if (result.issues.length > 0) {
    lines.push('## Issues', '');
    for (const issue of result.issues) {
      lines.push(`- [${issue.type}] ${issue.path}${issue.detail ? `: ${issue.detail}` : ''}`);
    }
  } else {
    lines.push('No security issues detected in runs store.');
  }
  lines.push('');
  process.stdout.write(`${lines.join('\n')}\n`);
  process.exit(result.ok ? 0 : 1);
}

function installCursorHooks(targetDir) {
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
          command: `node ${CURSOR_ADAPTER} deny_read`,
          timeout: 3,
          failClosed: true,
        },
      ],
    },
  };
  writeFileSync(hooksPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return hooksPath;
}

function installCodexHooks() {
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

function installClaudeHooks() {
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

function cmdInstallHooks(tool, target) {
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

function cmdAnalyze(args) {
  const sessionIdx = args.indexOf('--session');
  const sessionId = sessionIdx >= 0 ? args[sessionIdx + 1] : null;
  if (!sessionId) {
    process.stderr.write('Usage: foundry analyze --session <id>\n');
    process.exit(1);
  }
  const draft = analyzeSession(sessionId);
  const paths = writeEvolvedDraft(draft);
  const db = openDb();
  upsertSkill(db, {
    skillId: crypto.randomUUID(),
    slug: draft.slug,
    origin: `session:${sessionId}`,
    path: paths.dir,
    state: 'draft',
  });
  process.stdout.write(`Analyzed session ${sessionId}\n`);
  process.stdout.write(`Draft: ${paths.dir}\n`);
  process.stdout.write(`Slug: ${draft.slug}\n`);
}

function copyDir(src, dest) {
  mkdirSync(dest, { recursive: true });
  cpSync(src, dest, { recursive: true, force: true });
}

/** 驗證 skills 根目錄是否在允許範圍內 */
function assertSkillsRootAllowed(skillsRoot, force = false) {
  if (process.env.FOUNDRY_ALLOW_CUSTOM_SKILLS_ROOT === '1') return;

  const resolved = resolve(skillsRoot);
  const defaultRoot = resolve(join(homedir(), '.claude', 'skills'));
  const legacyRoot = resolve(
    join(homedir(), 'Documents', 'code', 'ai_coding_labs', 'skills'),
  );
  const home = resolve(homedir());
  const homePrefix = home.endsWith(sep) ? home : `${home}${sep}`;

  const isDefault = resolved === defaultRoot || resolved === legacyRoot;
  const isUnderHome = resolved === home || resolved.startsWith(homePrefix);
  const isKnownLabs = resolved.includes(`${sep}ai_coding_labs${sep}`)
    || resolved.includes(`${sep}.claude${sep}`);

  if (isDefault || (isUnderHome && isKnownLabs)) return;

  if (force) {
    process.stderr.write(`Warning: promoting to custom skills root: ${skillsRoot}\n`);
    return;
  }

  process.stderr.write(`Skills root ${skillsRoot} is outside the default path.\n`);
  process.stderr.write('Use --force or set FOUNDRY_ALLOW_CUSTOM_SKILLS_ROOT=1\n');
  process.exit(1);
}

function readProvenance(dir) {
  const path = join(dir, '.provenance.json');
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return {};
  }
}

function cmdApply(slug, type = 'CAPTURED', {
  force = false, draftSlug = null, parentSlug = null,
} = {}) {
  try {
    validateSlug(slug);
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }

  const skillsRoot = getSkillsRoot();
  assertSkillsRootAllowed(skillsRoot, force);

  const draftKey = draftSlug || slug;
  const validation = validateDraft(draftKey, type);
  if (!validation.valid) {
    process.stderr.write(`Validation failed:\n${validation.errors.join('\n')}\n`);
    process.exit(1);
  }

  const destDir = join(skillsRoot, slug);
  const destExists = existsSync(destDir);
  const manifest = destExists ? readManifest(destDir) : null;

  if (isSkillLocked(manifest, force)) {
    process.stderr.write(`Skill ${slug} is locked. Use --force to override.\n`);
    process.exit(1);
  }

  if (type === 'CAPTURED' && destExists) {
    process.stderr.write(`Target already exists: ${destDir}\n`);
    process.stderr.write('Use --type FIX for in-place updates or DERIVED for a variant.\n');
    process.exit(1);
  }

  if (type === 'FIX' && !destExists) {
    process.stderr.write(`FIX requires existing skill: ${destDir}\n`);
    process.exit(1);
  }

  if (type === 'DERIVED') {
    if (!parentSlug) {
      process.stderr.write('DERIVED requires --parent <parent-slug>\n');
      process.exit(1);
    }
    try {
      validateSlug(parentSlug);
    } catch (err) {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    }
    if (!existsSync(join(skillsRoot, parentSlug, 'SKILL.md'))) {
      process.stderr.write(`Parent skill not found: ${parentSlug}\n`);
      process.exit(1);
    }
    if (destExists) {
      process.stderr.write(`Derived slug already exists: ${slug}\n`);
      process.exit(1);
    }
  }

  const provenance = readProvenance(validation.dir);
  const sessionId = provenance.session_id || null;
  const experienceId = provenance.experience_id || null;
  const summary = provenance.summary || validation.warnings?.[0] || null;

  const db = openDb();
  let snapVersion = null;

  if (type === 'FIX') {
    const snap = snapshotCurrentVersion(slug, skillsRoot, {
      evolutionType: 'FIX',
      sessionId,
      experienceId,
      summary,
      db,
    });
    snapVersion = snap.version;
  }

  mkdirSync(skillsRoot, { recursive: true });
  applyDraftToSkill(slug, skillsRoot, validation.dir, type);
  const skillDir = join(skillsRoot, slug);

  if (type === 'CAPTURED' || type === 'DERIVED') {
    const now = new Date().toISOString();
    const initial = createInitialManifest(slug, { evolutionType: type, sessionId });
    initial.versions[0].evolution_type = type;
    initial.versions[0].session_id = sessionId;
    initial.versions[0].experience_id = experienceId;
    if (type === 'DERIVED') initial.parent_slug = parentSlug;
    writeManifest(skillDir, initial);
    const v1Dir = versionDir(skillDir, 1);
    copySkillToVersionDir(skillDir, v1Dir);
    insertSkillVersion(db, {
      slug,
      version: 1,
      evolutionType: type,
      sessionId,
      experienceId,
      snapshotPath: v1Dir,
      summary,
    });
  }

  let diff = '';
  if (isGitRepo(skillsRoot)) {
    diff = gitDiffInSkillsRoot(skillsRoot, slug);
    const manifestAfter = readManifest(join(skillsRoot, slug));
    if (manifestAfter?.current_version) {
      writeVersionDiff(skillsRoot, slug, manifestAfter.current_version, diff);
    }
  }

  const skillId = crypto.randomUUID();
  const parentSkill = type === 'DERIVED' && parentSlug
    ? db.prepare('SELECT skill_id FROM skills WHERE slug = ?').get(parentSlug)
    : null;

  upsertSkill(db, {
    skillId,
    slug,
    origin: experienceId ? `experience:${experienceId}` : `evolved:${type}`,
    path: skillDir,
    state: 'promoted',
  });
  insertLineage(db, {
    childId: skillId,
    parentId: parentSkill?.skill_id ?? null,
    evolutionType: type,
  });

  if (experienceId) {
    const currentManifest = readManifest(join(skillsRoot, slug));
    updateExperienceState(
      db,
      experienceId,
      'promoted',
      currentManifest?.current_version ?? snapVersion,
    );
  }

  process.stdout.write(`Applied ${type} ${slug} -> ${skillDir}\n`);
  if (experienceId) process.stdout.write(`Linked experience: ${experienceId}\n`);
  if (snapVersion) process.stdout.write(`Snapshot: v${snapVersion}\n`);
  if (diff) {
    process.stdout.write('\n## Git diff\n\n');
    process.stdout.write(diff);
  }
}

function cmdPromote(slug, type = 'CAPTURED', force = false) {
  cmdApply(slug, type, { force });
}

function cmdAdopt(args) {
  const dryRun = args.includes('--dry-run');
  const slugIdx = args.indexOf('--slug');
  const onlySlug = slugIdx >= 0 ? args[slugIdx + 1] : null;

  const skillsRoot = getSkillsRoot();
  const db = openDb();
  const discovered = discoverSkillSlugs(skillsRoot);
  const targets = onlySlug
    ? discovered.filter((s) => s.slug === onlySlug)
    : discovered;

  if (onlySlug && targets.length === 0) {
    try {
      validateSlug(onlySlug);
    } catch (err) {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    }
    if (!existsSync(join(skillsRoot, onlySlug, 'SKILL.md'))) {
      process.stderr.write(`SKILL.md not found for slug: ${onlySlug}\n`);
      process.exit(1);
    }
    targets.push({ slug: onlySlug, dir: join(skillsRoot, onlySlug) });
  }

  const results = { adopted: 0, skipped: 0, would: 0, errors: [] };
  for (const { slug } of targets) {
    try {
      const result = adoptSkill(slug, skillsRoot, { db: dryRun ? null : db, dryRun });
      if (result.status === 'adopted') {
        results.adopted += 1;
        if (!dryRun) {
          upsertSkill(db, {
            skillId: crypto.randomUUID(),
            slug,
            origin: 'adopted',
            path: join(skillsRoot, slug),
            state: 'promoted',
          });
        }
        process.stdout.write(`${dryRun ? '[dry-run] ' : ''}Adopted ${slug} v${result.version}\n`);
      } else if (result.status === 'would_adopt') {
        results.would += 1;
        process.stdout.write(`[dry-run] Would adopt ${slug}\n`);
      } else {
        results.skipped += 1;
        process.stdout.write(`Skip ${slug}: ${result.reason}\n`);
      }
    } catch (err) {
      results.errors.push({ slug, error: err instanceof Error ? err.message : String(err) });
      process.stderr.write(`Error ${slug}: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }

  process.stdout.write(`\nAdopt complete: ${results.adopted} adopted, ${results.skipped} skipped, ${results.would} dry-run\n`);
}

function cmdHistory(slug) {
  try {
    validateSlug(slug);
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }

  const skillsRoot = getSkillsRoot();
  const skillDir = join(skillsRoot, slug);
  const manifest = readManifest(skillDir);
  const db = openDb();
  const dbVersions = querySkillVersions(db, slug, 100).reverse();

  const lines = [`# Version history: ${slug}`, ''];
  if (manifest) {
    lines.push(`Current version: v${manifest.current_version}`);
    lines.push(`Locked: ${manifest.locked ? 'yes' : 'no'}`);
    lines.push('');
    for (const v of manifest.versions || []) {
      lines.push(`- v${v.version} ${v.evolution_type} (${v.created_at})${v.summary ? ` — ${v.summary}` : ''}`);
    }
  } else {
    lines.push('No manifest.json found. Run `foundry adopt` first.');
  }

  if (dbVersions.length > 0) {
    lines.push('', '## SQLite skill_versions', '');
    for (const v of dbVersions) {
      lines.push(`- v${v.version} ${v.evolution_type} snapshot=${v.snapshot_path}`);
    }
  }

  lines.push('');
  process.stdout.write(`${lines.join('\n')}\n`);
}

function cmdDiff(slug, args) {
  try {
    validateSlug(slug);
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }

  const fromIdx = args.indexOf('--from');
  const toIdx = args.indexOf('--to');
  const fromLabel = fromIdx >= 0 ? args[fromIdx + 1] : 'v1';
  const toLabel = toIdx >= 0 ? args[toIdx + 1] : 'current';

  const skillsRoot = getSkillsRoot();
  try {
    const fromText = readVersionSkillContent(slug, skillsRoot, fromLabel);
    const toText = readVersionSkillContent(slug, skillsRoot, toLabel);
    const diff = diffSkillContent(fromText, toText);
    process.stdout.write(`# Diff ${slug}: ${fromLabel} -> ${toLabel}\n\n${diff}\n`);
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
}

function cmdRollback(slug, args) {
  const force = args.includes('--force');
  const toIdx = args.indexOf('--to');
  const toLabel = toIdx >= 0 ? args[toIdx + 1] : null;
  if (!toLabel || !/^v\d+$/.test(toLabel)) {
    process.stderr.write('Usage: foundry rollback <slug> --to vN [--force]\n');
    process.exit(1);
  }

  try {
    validateSlug(slug);
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }

  const targetVersion = Number.parseInt(toLabel.slice(1), 10);
  const skillsRoot = getSkillsRoot();
  const skillDir = join(skillsRoot, slug);
  const manifest = readManifest(skillDir);

  if (isSkillLocked(manifest, force)) {
    process.stderr.write(`Skill ${slug} is locked. Use --force.\n`);
    process.exit(1);
  }

  const db = openDb();
  snapshotCurrentVersion(slug, skillsRoot, {
    evolutionType: 'ROLLBACK',
    summary: `Rollback to ${toLabel}`,
    db,
  });
  restoreVersionToCurrent(slug, skillsRoot, targetVersion);

  const updated = readManifest(skillDir) || createInitialManifest(slug);
  updated.current_version = targetVersion;
  updated.versions.push({
    version: targetVersion,
    created_at: new Date().toISOString(),
    evolution_type: 'ROLLBACK',
    session_id: null,
    summary: `Restored content from ${toLabel}`,
    confidence: 1.0,
  });
  writeManifest(skillDir, updated);

  process.stdout.write(`Rolled back ${slug} to ${toLabel} (current content restored)\n`);
}

function cmdReview() {
  const evolvedRoot = PATHS.evolved();
  const lines = ['# Foundry Review', '', '## Evolved drafts', ''];

  if (!existsSync(evolvedRoot)) {
    lines.push('- (no evolved directory)');
  } else {
    for (const type of ['CAPTURED', 'DERIVED', 'FIX']) {
      const typeDir = join(evolvedRoot, type);
      if (!existsSync(typeDir)) continue;
      for (const slug of readdirSync(typeDir)) {
        const validation = validateDraft(slug, type);
        const status = validation.valid ? 'valid' : 'invalid';
        const risk = validation.lowRisk ? 'low-risk' : 'needs-review';
        lines.push(`- ${type}/${slug}: ${status}, ${risk}`);
        if (!validation.valid) {
          for (const e of validation.errors.slice(0, 3)) {
            lines.push(`  - ${e}`);
          }
        }
        if (validation.warnings.length > 0) {
          lines.push(`  - warn: ${validation.warnings[0]}`);
        }
        const prov = readProvenance(join(typeDir, slug));
        if (prov.experience_id) {
          lines.push(`  - experience_id: ${prov.experience_id}`);
        }
        if (type === 'FIX') {
          lines.push(`  - apply: foundry apply ${slug} --type FIX`);
        } else if (type === 'CAPTURED') {
          lines.push(`  - apply: foundry apply ${slug} --type CAPTURED`);
        } else {
          lines.push(`  - apply: foundry apply ${slug} --type DERIVED --parent <parent>`);
        }
      }
    }
  }

  lines.push('');
  process.stdout.write(`${lines.join('\n')}\n`);
}

function cmdMigrateMnemo(args) {
  const dryRun = args.includes('--dry-run');
  const pathIdx = args.indexOf('--path');
  const mnemoDir = pathIdx >= 0 ? args[pathIdx + 1] : undefined;
  const db = openDb();
  const stats = migrateMnemo(db, { mnemoDir, dryRun });
  const lines = [
    '# Migrate skill-mnemo',
    '',
    `- Dry run: ${dryRun}`,
    `- Knowledge entries: ${stats.knowledge}`,
    `- Experiences: ${stats.experiences}`,
    `- Skipped: ${stats.skipped}`,
  ];
  if (stats.errors.length > 0) {
    lines.push('', '## Errors');
    for (const e of stats.errors) lines.push(`- ${e}`);
  }
  lines.push('');
  process.stdout.write(`${lines.join('\n')}\n`);
}

function cmdMigrateAutoSkill(args) {
  const dryRun = args.includes('--dry-run');
  const pathIdx = args.indexOf('--path');
  const autoSkillDir = pathIdx >= 0 ? args[pathIdx + 1] : undefined;
  const db = openDb();
  const stats = migrateAutoSkill(db, { autoSkillDir, dryRun });
  const lines = [
    '# Migrate auto-skill',
    '',
    `- Dry run: ${dryRun}`,
    `- Knowledge entries: ${stats.knowledge}`,
    `- Experiences: ${stats.experiences}`,
    `- Skipped: ${stats.skipped}`,
  ];
  if (stats.errors.length > 0) {
    lines.push('', '## Errors');
    for (const e of stats.errors) lines.push(`- ${e}`);
  }
  lines.push('');
  process.stdout.write(`${lines.join('\n')}\n`);
}

async function cmdQueueWorker(once = false) {
  do {
    const jobs = listPendingJobFiles();
    if (jobs.length === 0) {
      if (once) break;
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }
    for (const jobPath of jobs) {
      const job = claimJob(jobPath);
      try {
        if (job.type === 'analyze' && job.session_id) {
          const sessionId = job.session_id;

          // Phase 1: analyze
          const draft = analyzeSession(sessionId);

          // Phase 2: extract (rubric → experiences / knowledge_entries)
          const extractResult = extractSession(sessionId);

          // Phase 3: evolve
          if (extractResult.should_evolve_fix && extractResult.fix_draft) {
            // FIX draft already written by extractor
            const db = openDb();
            upsertSkill(db, {
              skillId: crypto.randomUUID(),
              slug: extractResult.fix_draft.slug,
              origin: `session:${sessionId}:fix`,
              path: extractResult.fix_draft.dir,
              state: 'draft',
            });
          } else if (!extractResult.skipped && extractResult.score >= 3 && !extractResult.should_evolve_fix) {
            const paths = writeEvolvedDraft(draft);
            const db = openDb();
            upsertSkill(db, {
              skillId: crypto.randomUUID(),
              slug: draft.slug,
              origin: `session:${sessionId}`,
              path: paths.dir,
              state: 'draft',
            });
          }

          process.stdout.write(
            `Processed ${sessionId}: analyze + extract (score=${extractResult.score ?? 'skip'}) + evolve\n`,
          );
        }
        completeJob(jobPath, { status: 'done' });
      } catch (err) {
        completeJob(jobPath, {
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
        });
        process.stderr.write(`Job failed: ${err instanceof Error ? err.message : String(err)}\n`);
      }
    }
    if (once) break;
  } while (!once);
}

function cmdAutopromote(dryRun = false) {
  const evolvedRoot = join(PATHS.evolved(), 'CAPTURED');
  if (!existsSync(evolvedRoot)) {
    process.stdout.write('No CAPTURED drafts.\n');
    return;
  }
  const staging = PATHS.staging();
  mkdirSync(staging, { recursive: true });

  for (const slug of readdirSync(evolvedRoot)) {
    try {
      validateSlug(slug);
    } catch (err) {
      process.stdout.write(`Skip ${slug}: ${err instanceof Error ? err.message : String(err)}\n`);
      continue;
    }
    const validation = validateDraft(slug, 'CAPTURED');
    if (!validation.valid || !validation.lowRisk) {
      process.stdout.write(`Skip ${slug}: ${validation.errors.join('; ') || 'not low-risk'}\n`);
      continue;
    }
    const dest = join(staging, slug);
    if (dryRun) {
      process.stdout.write(`[dry-run] Would autopromote ${slug} -> ${dest}\n`);
      continue;
    }
    copyDir(validation.dir, dest);
    const db = openDb();
    upsertSkill(db, {
      skillId: crypto.randomUUID(),
      slug,
      origin: 'autopromote',
      path: dest,
      state: 'staging',
      successRate: 0.8,
    });
    process.stdout.write(`Autopromoted ${slug} -> staging\n`);
  }
}

function cmdArchive(args) {
  const dryRun = args.includes('--dry-run');
  const daysIdx = args.indexOf('--days');
  const days = daysIdx >= 0 ? Number.parseInt(args[daysIdx + 1], 10) : DEFAULT_RETENTION_DAYS;
  if (!Number.isFinite(days) || days < 1) {
    process.stderr.write('Usage: foundry archive [--days 90] [--dry-run]\n');
    process.exit(1);
  }
  const stats = archiveRuns({ retentionDays: days, dryRun });
  const lines = [
    '# Foundry Archive',
    '',
    `- Retention: ${days} days`,
    `- Dry run: ${dryRun}`,
    `- Archived: ${stats.archived}`,
    `- Deleted (secrets): ${stats.deleted}`,
    `- Skipped (within retention): ${stats.skipped}`,
  ];
  if (stats.errors.length > 0) {
    lines.push('', '## Errors', '');
    for (const e of stats.errors) {
      lines.push(`- ${e.path}: ${e.error}`);
    }
  }
  lines.push('');
  process.stdout.write(`${lines.join('\n')}\n`);
}

function cmdSimulateRecorder() {
  const sessionId = crypto.randomUUID();
  const event = {
    v: 1,
    ts: new Date().toISOString(),
    event: 'before_task',
    tool: 'cursor',
    session_id: sessionId,
    project_root: process.cwd(),
    payload: { prompt: 'test simulate recorder', hook_name: 'beforeSubmitPrompt' },
    redacted: true,
  };
  const { jsonlPath } = recordEvent(event);
  process.stdout.write(`Simulated recorder event\n`);
  process.stdout.write(`Session: ${sessionId}\n`);
  process.stdout.write(`JSONL: ${jsonlPath}\n`);
}

function parseArgs(argv) {
  const args = [...argv];
  const cmd = args.shift();
  return { cmd, args };
}

async function main() {
  const { cmd, args } = parseArgs(process.argv.slice(2));

  if (!cmd || cmd === 'help' || cmd === '--help') {
    usage();
    return;
  }

  switch (cmd) {
    case 'status':
      cmdStatus();
      break;
    case 'audit':
      cmdAudit();
      break;
    case 'install-hooks': {
      const targetIdx = args.indexOf('--target');
      const target = targetIdx >= 0 ? args[targetIdx + 1] : undefined;
      const tool = args.find((a) => !a.startsWith('--') && a !== target);
      cmdInstallHooks(tool, target);
      break;
    }
    case 'analyze':
      cmdAnalyze(args);
      break;
    case 'apply': {
      const typeIdx = args.indexOf('--type');
      const type = typeIdx >= 0 ? args[typeIdx + 1] : 'CAPTURED';
      const draftIdx = args.indexOf('--draft');
      const parentIdx = args.indexOf('--parent');
      const draftSlug = draftIdx >= 0 ? args[draftIdx + 1] : null;
      const parentSlug = parentIdx >= 0 ? args[parentIdx + 1] : null;
      const slug = args.find((a) => !a.startsWith('--')
        && a !== type && a !== draftSlug && a !== parentSlug);
      const force = args.includes('--force');
      if (!slug) {
        process.stderr.write('Usage: foundry apply <slug> [--type CAPTURED|FIX|DERIVED] [--draft <slug>] [--parent <slug>] [--force]\n');
        process.exit(1);
      }
      cmdApply(slug, type, { force, draftSlug, parentSlug });
      break;
    }
    case 'promote': {
      const typeIdx = args.indexOf('--type');
      const type = typeIdx >= 0 ? args[typeIdx + 1] : 'CAPTURED';
      const slug = args.find((a) => !a.startsWith('--') && a !== type);
      const force = args.includes('--force');
      if (!slug) {
        process.stderr.write('Usage: foundry promote <slug> [--type CAPTURED|FIX|DERIVED] [--force]\n');
        process.exit(1);
      }
      cmdPromote(slug, type, force);
      break;
    }
    case 'adopt':
      cmdAdopt(args);
      break;
    case 'history': {
      const slug = args.find((a) => !a.startsWith('--'));
      if (!slug) {
        process.stderr.write('Usage: foundry history <slug>\n');
        process.exit(1);
      }
      cmdHistory(slug);
      break;
    }
    case 'diff': {
      const slug = args.find((a) => !a.startsWith('--') && a !== args[args.indexOf('--from') + 1] && a !== args[args.indexOf('--to') + 1]);
      if (!slug) {
        process.stderr.write('Usage: foundry diff <slug> [--from vN] [--to current|vN]\n');
        process.exit(1);
      }
      cmdDiff(slug, args);
      break;
    }
    case 'rollback': {
      const slug = args.find((a) => !a.startsWith('--') && a !== args[args.indexOf('--to') + 1]);
      if (!slug) {
        process.stderr.write('Usage: foundry rollback <slug> --to vN [--force]\n');
        process.exit(1);
      }
      cmdRollback(slug, args);
      break;
    }
    case 'review':
      cmdReview();
      break;
    case 'migrate-mnemo':
      cmdMigrateMnemo(args);
      break;
    case 'migrate-auto-skill':
      cmdMigrateAutoSkill(args);
      break;
    case 'queue-worker':
      await cmdQueueWorker(args.includes('--once'));
      break;
    case 'autopromote':
      cmdAutopromote(args.includes('--dry-run'));
      break;
    case 'archive':
      cmdArchive(args);
      break;
    case 'simulate-recorder':
      cmdSimulateRecorder();
      break;
    default:
      process.stderr.write(`Unknown command: ${cmd}\n`);
      usage();
      process.exit(1);
  }

  closeDb();
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
