#!/usr/bin/env bash
# 安裝 Foundry queue-worker launchd（每 5 分鐘執行一次）
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLIST_SRC="$REPO_ROOT/docs/launchd/foundry-queue-worker.plist.example"
PLIST_DEST="$HOME/Library/LaunchAgents/com.foundry.queue-worker.plist"
FOUNDRY_CLI="$REPO_ROOT/cli/foundry.mjs"
MEMORY_ROOT="${FOUNDRY_MEMORY_ROOT:-$HOME/.foundry}"
SKILLS_ROOT="${FOUNDRY_SKILLS_ROOT:-$HOME/.claude/skills}"

mkdir -p "$HOME/Library/LaunchAgents"
mkdir -p "$MEMORY_ROOT/shared-agent-memory/agents"

sed \
  -e "s|/path/to/Foundry/cli/foundry.mjs|$FOUNDRY_CLI|g" \
  -e "s|/Users/YOU/.foundry|$MEMORY_ROOT|g" \
  -e "s|/Users/YOU/.claude/skills|$SKILLS_ROOT|g" \
  "$PLIST_SRC" > "$PLIST_DEST"

launchctl unload "$PLIST_DEST" 2>/dev/null || true
launchctl load "$PLIST_DEST"

echo "Installed: $PLIST_DEST"
echo "Logs: $MEMORY_ROOT/shared-agent-memory/agents/queue-worker.log"
