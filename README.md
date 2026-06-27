# Foundry

Cross-tool hook-driven **skill evolution layer** for Cursor, Codex, and Claude Code.

[繁體中文](README.zh-TW.md)

Foundry records agent sessions via hooks, analyzes successful runs offline, produces CAPTURED/FIX/DERIVED skill drafts, and promotes validated skills to your canonical skills directory.

## Quick Start

```bash
cd /path/to/Foundry
npm install

# Check status (works with empty store)
node cli/foundry.mjs status

# Install Cursor hooks in current project
node cli/foundry.mjs install-hooks cursor

# Install Codex / Claude Code hooks (user-level)
node cli/foundry.mjs install-hooks codex
node cli/foundry.mjs install-hooks claude

# Simulate a recorder event (verify JSONL write)
node cli/foundry.mjs simulate-recorder

# Analyze a session into evolved/CAPTURED/
node cli/foundry.mjs analyze --session <session-id>

# Promote a validated draft
node cli/foundry.mjs promote <slug> [--type CAPTURED|FIX|DERIVED] [--force]

# Security audit
node cli/foundry.mjs audit

# Archive runs older than 90 days
node cli/foundry.mjs archive --days 90 --dry-run

# Process async analyze queue (after session ends)
node cli/foundry.mjs queue-worker --once

# Run security unit tests (16 tests)
npm test
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `FOUNDRY_MEMORY_ROOT` | `~/.foundry` | Data root |
| `FOUNDRY_SKILLS_ROOT` | `~/Documents/code/ai_coding_labs/skills` | Promote destination |
| `FOUNDRY_ALLOW_CUSTOM_SKILLS_ROOT` | unset | Set to `1` to allow promote to any `FOUNDRY_SKILLS_ROOT` without `--force` |
| `FOUNDRY_REPO_ROOT` | Foundry repo path | Tooling root |
| `FOUNDRY_PROJECT_RUNS` | `<project>/.foundry/runs` | Project overlay |

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Security

- Hooks cannot read `.env` paths (denylist in `security.mjs`)
- No cloud upload code
- `evolved/` cannot overwrite `skills/` — promote uses copy + git diff
- Prompt injection patterns scanned in validator
- Sync hooks timeout: Cursor 3–5s (see `.cursor/hooks.json`)

### Input validation

- **`validateSlug()`** — all slug arguments must match `^[a-z0-9][a-z0-9-]{0,63}$` (lowercase alphanumeric, hyphens, max 64 chars, no path traversal)
- **`assertPathWithinRoot()`** — promote resolves source and destination paths and rejects escapes outside their roots

### Promote safeguards

- **`foundry promote <slug> [--type CAPTURED|FIX|DERIVED] [--force]`** — `--type` selects the draft under `evolved/{TYPE}/`; defaults to `CAPTURED`
- **`assertSkillsRootAllowed()`** — blocks promote when `FOUNDRY_SKILLS_ROOT` is outside the default `~/Documents/code/ai_coding_labs/skills` path unless:
  - `FOUNDRY_ALLOW_CUSTOM_SKILLS_ROOT=1` is set, or
  - `--force` is passed (emits a warning and continues)
- Allowed without override: the default skills root, or any path under `$HOME` that contains `ai_coding_labs/`

### Process and data hardening

- **Git subprocesses** — `git.mjs` uses `spawnSync` with `shell: false`; slugs are validated before `git diff`
- **File permissions** — `skill_store.sqlite` and run JSONL files are chmod `600` on write
- **Hook adapters fail-open** — Cursor, Codex, and Claude adapters log invalid stdin JSON and exit `0` so a malformed hook payload does not block the host tool
- **CAPTURED command re-redaction** — commands in evolved drafts pass through `redactString()` again; dangerous patterns become `[REDACTED COMMAND]`

### Tests

```bash
npm test   # 16 unit tests: validateSlug, path denylist, git slug safety, redaction
```

## Relation to skill-mnemo

| Tool | Responsibility |
|------|----------------|
| **skill-mnemo** | Session memory recall (USER/MEMORY) |
| **Foundry** | Reusable SKILL evolution from runs |

Superset hooks are chained **after** Foundry adapters automatically.
