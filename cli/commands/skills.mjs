import {
  mkdirSync, readFileSync, existsSync, cpSync, readdirSync,
} from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import {
  openDb, upsertSkill, insertLineage, querySkillVersions, updateExperienceState, insertSkillVersion,
} from '../../packages/hook-bridge/db.mjs';
import { getSkillsRoot, PATHS } from '../../packages/hook-bridge/paths.mjs';
import { validateDraft } from '../../agents/validator/validate.mjs';
import { gitDiffInSkillsRoot, isGitRepo } from '../../packages/hook-bridge/git.mjs';
import { validateSlug } from '../../packages/hook-bridge/security.mjs';
import {
  snapshotCurrentVersion, adoptSkill, discoverSkillSlugs, readManifest, readVersionSkillContent,
  diffSkillContent, applyDraftToSkill, restoreVersionToCurrent, writeVersionDiff, isSkillLocked,
  createInitialManifest, writeManifest, copySkillToVersionDir, versionDir,
} from '../../packages/hook-bridge/version.mjs';

export function copyDir(src, dest) {
  mkdirSync(dest, { recursive: true });
  cpSync(src, dest, { recursive: true, force: true });
}

/** 驗證 skills 根目錄是否在允許範圍內 */
export function assertSkillsRootAllowed(skillsRoot, force = false) {
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

export function readProvenance(dir) {
  const path = join(dir, '.provenance.json');
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return {};
  }
}

export function cmdApply(slug, type = 'CAPTURED', {
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

  const actualSkillId = upsertSkill(db, {
    skillId,
    slug,
    origin: experienceId ? `experience:${experienceId}` : `evolved:${type}`,
    path: skillDir,
    state: 'promoted',
  });
  insertLineage(db, {
    childId: actualSkillId,
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

export function cmdPromote(slug, type = 'CAPTURED', options = {}) {
  cmdApply(slug, type, options);
}

export function cmdAdopt(args) {
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

export function cmdHistory(slug) {
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

export function cmdDiff(slug, args) {
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

export function cmdRollback(slug, args) {
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
  restoreVersionToCurrent(slug, skillsRoot, targetVersion);
  const snap = snapshotCurrentVersion(slug, skillsRoot, {
    evolutionType: 'ROLLBACK',
    summary: `Rollback to ${toLabel}`,
    db,
  });

  process.stdout.write(`Rolled back ${slug} to ${toLabel} (now v${snap.version})\n`);
}

export function cmdReview() {
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

export function cmdAutopromote(dryRun = false) {
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
