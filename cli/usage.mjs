export function usage() {
  process.stdout.write(`Foundry CLI v0.2.0

Usage:
  foundry status
  foundry audit [knowledge]
  foundry dedup experiences [--dry-run]
  foundry fix <slug> --from-session <id>
  foundry derive <parent-slug> --from-session <id> [--variant <name>]
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
  foundry deprecate-legacy [--dry-run] [--execute] [--archive-db]
  foundry setup [--target <path>] [--install-launchd]
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
