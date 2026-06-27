# Foundry Skill Evolution — learnings

## Completed 2026-06-27

- Full hook-bridge with Cursor/Codex/Claude adapters
- SQLite via better-sqlite3 (sessions, events, skills, lineage, evolution_queue)
- Project overlay runs at `<project>/.foundry/runs/`; analyzer resolves via sqlite jsonl_path + project_root
- Superset chained in adapters/chain.mjs after Foundry record
- Verification: `node cli/foundry.mjs status`, `simulate-recorder`, `analyze --session`

## Env vars

- FOUNDRY_MEMORY_ROOT, FOUNDRY_SKILLS_ROOT, FOUNDRY_REPO_ROOT
- FOUNDRY_ALLOW_CUSTOM_SKILLS_ROOT=1 bypasses skills root path guard on promote

## Security fixes 2026-06-27

- `validateSlug` / `assertPathWithinRoot` in security.mjs; used in promote, autopromote, validateDraft, gitDiffInSkillsRoot
- git.mjs uses spawnSync without shell; malicious slugs rejected before git invocation
- Adapters fail-open on invalid JSON (stderr + exit 0)
- promote requires --force or FOUNDRY_ALLOW_CUSTOM_SKILLS_ROOT for non-default skills root
- evolve.mjs re-redacts commands via redactString + scanSkillContent
- auditMemoryStore scans evolved/ and staging/ in addition to runs/
- recorder/db chmod 600 on jsonl and sqlite after write/create
- Tests: `npm test` runs 16 tests in packages/hook-bridge/*.test.mjs
