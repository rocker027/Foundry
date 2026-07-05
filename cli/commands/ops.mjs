import { mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  openDb, getStatusStats, upsertSkill,
} from '../../packages/hook-bridge/db.mjs';
import {
  getMemoryRoot, getSkillsRoot, PATHS,
} from '../../packages/hook-bridge/paths.mjs';
import { auditMemoryStore } from '../../agents/validator/validate.mjs';
import { analyzeSession } from '../../agents/analyzer/analyze.mjs';
import { extractSession } from '../../agents/extractor/extract.mjs';
import { writeEvolvedDraft } from '../../agents/evolver/evolve.mjs';
import { listPendingJobFiles, claimJob, completeJob } from '../../packages/hook-bridge/queue.mjs';
import { recordEvent } from '../../packages/hook-bridge/recorder.mjs';
import { validateSlug } from '../../packages/hook-bridge/security.mjs';
import { archiveRuns, DEFAULT_RETENTION_DAYS } from '../../packages/hook-bridge/archive.mjs';
import { migrateMnemo, migrateAutoSkill } from '../../packages/hook-bridge/migrate.mjs';
import {
  parseFixArgs, parseDeriveArgs, parseAuditArgs, parseDeprecateLegacyArgs,
} from '../../packages/hook-bridge/cli-args.mjs';
import { createFixDraftFromSession, createDerivedDraftFromSession } from '../../packages/hook-bridge/session-draft.mjs';
import { runKnowledgeAudit } from '../../packages/hook-bridge/knowledge-audit.mjs';
import { dedupeExperiences } from '../../packages/hook-bridge/experience-dedup.mjs';
import { planDeprecateLegacy, formatDeprecateReport, archiveLegacySkillsInDb } from '../../packages/hook-bridge/deprecate-legacy.mjs';

export function cmdStatus() {
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

export function cmdAudit(args) {
  const { subcommand } = parseAuditArgs(args);
  if (subcommand === 'knowledge') {
    cmdAuditKnowledge();
    return;
  }
  cmdAuditSecurity();
}

export function cmdAuditSecurity() {
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

export function cmdAuditKnowledge() {
  const result = runKnowledgeAudit();
  const { summary } = result;
  const lines = [
    '# Foundry Knowledge Audit',
    '',
    `- Report: ${result.reportPath}`,
    `- Knowledge active→stale: ${summary.knowledgeStale}`,
    `- Knowledge stale→archived: ${summary.knowledgeArchived}`,
    `- Experiences pending→archived: ${summary.experiencesArchived}`,
    `- Refresh hints: ${summary.refreshHints}`,
    `- Pinned skipped: ${summary.pinnedSkipped}`,
    '',
    `Full report written to ${result.reportPath}`,
    '',
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
}

export function cmdDedupExperiences(args) {
  const dryRun = args.includes('--dry-run');
  const result = dedupeExperiences({ dryRun });
  const lines = [
    '# Foundry Experience Dedup',
    '',
    `- Groups scanned: ${result.groupsScanned}`,
    `- Kept: ${result.kept}`,
    `- Archived duplicates: ${result.archived}${dryRun ? ' (dry-run)' : ''}`,
    '',
  ];
  if (result.archivedIds.length > 0) {
    lines.push('## Archived', '');
    for (const row of result.archivedIds.slice(0, 20)) {
      lines.push(`- ${row.experience_id} → kept ${row.kept_id}`);
      lines.push(`  session: ${row.session_id}`);
      lines.push(`  abstract: ${row.abstract.slice(0, 80)}`);
    }
    if (result.archivedIds.length > 20) {
      lines.push(`- ... and ${result.archivedIds.length - 20} more`);
    }
    lines.push('');
  } else {
    lines.push('No duplicate experiences found.', '');
  }
  process.stdout.write(`${lines.join('\n')}\n`);
}

export function cmdFix(args) {
  const { slug, sessionId } = parseFixArgs(args);
  if (!slug || !sessionId) {
    process.stderr.write('Usage: foundry fix <slug> --from-session <id>\n');
    process.exit(1);
  }
  try {
    validateSlug(slug);
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }

  const result = createFixDraftFromSession(slug, sessionId);
  const db = openDb();
  upsertSkill(db, {
    skillId: crypto.randomUUID(),
    slug: result.slug,
    origin: result.experienceId ? `experience:${result.experienceId}` : `session:${sessionId}:fix`,
    path: result.dir,
    state: 'draft',
  });

  process.stdout.write(`FIX draft created for ${result.slug}\n`);
  process.stdout.write(`Draft: ${result.dir}\n`);
  process.stdout.write(`Session: ${result.sessionId}\n`);
  if (result.experienceId) process.stdout.write(`Experience: ${result.experienceId}\n`);
  process.stdout.write(`Apply: foundry apply ${result.slug} --type FIX\n`);
}

export function cmdDerive(args) {
  const { parentSlug, sessionId, variant } = parseDeriveArgs(args);
  if (!parentSlug || !sessionId) {
    process.stderr.write('Usage: foundry derive <parent-slug> --from-session <id> [--variant <name>]\n');
    process.exit(1);
  }
  try {
    validateSlug(parentSlug);
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }

  const result = createDerivedDraftFromSession(parentSlug, sessionId, variant);
  const db = openDb();
  upsertSkill(db, {
    skillId: crypto.randomUUID(),
    slug: result.slug,
    origin: result.experienceId ? `experience:${result.experienceId}` : `session:${sessionId}:derived`,
    path: result.dir,
    state: 'draft',
  });

  process.stdout.write(`DERIVED draft created: ${result.slug}\n`);
  process.stdout.write(`Parent: ${result.parentSlug}\n`);
  process.stdout.write(`Draft: ${result.dir}\n`);
  process.stdout.write(`Session: ${result.sessionId}\n`);
  if (result.experienceId) process.stdout.write(`Experience: ${result.experienceId}\n`);
  process.stdout.write(`Apply: foundry apply ${result.slug} --type DERIVED --parent ${result.parentSlug}\n`);
}

export function cmdDeprecateLegacy(args) {
  const { dryRun, execute } = parseDeprecateLegacyArgs(args);
  if (dryRun && execute) {
    process.stderr.write('Use either --dry-run (default) or --execute, not both.\n');
    process.exit(1);
  }
  if (args.includes('--archive-db')) {
    const archived = archiveLegacySkillsInDb();
    process.stdout.write(`Archived legacy skills in SQLite: ${archived.length ? archived.join(', ') : '(none)'}\n`);
    if (!execute) return;
  }
  const plan = planDeprecateLegacy({ execute });
  process.stdout.write(`${formatDeprecateReport(plan)}\n`);
  if (!execute) {
    process.stdout.write('Dry-run only. Re-run with --execute to move directories.\n');
  }
}

export function cmdAnalyze(args) {
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

export function cmdMigrateMnemo(args) {
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

export function cmdMigrateAutoSkill(args) {
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

export async function cmdQueueWorker(once = false) {
  do {
    const jobs = listPendingJobFiles();
    if (jobs.length === 0) {
      if (once) break;
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }
    for (const jobPath of jobs) {
      const job = claimJob(jobPath);
      if (!job) continue;
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

export function cmdArchive(args) {
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

export function cmdSimulateRecorder() {
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
