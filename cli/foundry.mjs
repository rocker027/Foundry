#!/usr/bin/env node
import { closeDb } from '../packages/hook-bridge/db.mjs';
import { parseApplyArgs, parseDiffArgs, parseRollbackArgs } from '../packages/hook-bridge/cli-args.mjs';
import { usage } from './usage.mjs';
import { cmdInstallHooks, cmdSetup } from './commands/hooks.mjs';
import {
  cmdApply, cmdPromote, cmdAdopt, cmdHistory, cmdDiff, cmdRollback, cmdReview, cmdAutopromote,
} from './commands/skills.mjs';
import {
  cmdStatus, cmdAudit, cmdDedupExperiences, cmdFix, cmdDerive, cmdDeprecateLegacy,
  cmdAnalyze, cmdMigrateMnemo, cmdMigrateAutoSkill, cmdQueueWorker, cmdArchive, cmdSimulateRecorder,
} from './commands/ops.mjs';

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
      cmdAudit(args);
      break;
    case 'dedup':
      if (args[0] === 'experiences') {
        cmdDedupExperiences(args.slice(1));
      } else {
        process.stderr.write('Usage: foundry dedup experiences [--dry-run]\n');
        process.exit(1);
      }
      break;
    case 'fix':
      cmdFix(args);
      break;
    case 'derive':
      cmdDerive(args);
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
      const { slug, type, draftSlug, parentSlug, force } = parseApplyArgs(args);
      if (!slug) {
        process.stderr.write('Usage: foundry apply <slug> [--type CAPTURED|FIX|DERIVED] [--draft <slug>] [--parent <slug>] [--force]\n');
        process.exit(1);
      }
      cmdApply(slug, type, { force, draftSlug, parentSlug });
      break;
    }
    case 'promote': {
      const { slug, type, draftSlug, parentSlug, force } = parseApplyArgs(args);
      if (!slug) {
        process.stderr.write('Usage: foundry promote <slug> [--type CAPTURED|FIX|DERIVED] [--draft <slug>] [--parent <slug>] [--force]\n');
        process.exit(1);
      }
      cmdPromote(slug, type, { force, draftSlug, parentSlug });
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
      const { slug } = parseDiffArgs(args);
      if (!slug) {
        process.stderr.write('Usage: foundry diff <slug> [--from vN] [--to current|vN]\n');
        process.exit(1);
      }
      cmdDiff(slug, args);
      break;
    }
    case 'rollback': {
      const { slug } = parseRollbackArgs(args);
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
    case 'deprecate-legacy':
      cmdDeprecateLegacy(args);
      break;
    case 'setup':
      cmdSetup(args);
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
