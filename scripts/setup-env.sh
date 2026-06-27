#!/usr/bin/env bash
# 輸出 Foundry 建議環境變數（可 source 或加入 shell profile）
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export FOUNDRY_REPO_ROOT="$REPO_ROOT"
export FOUNDRY_MEMORY_ROOT="${FOUNDRY_MEMORY_ROOT:-$HOME/.foundry}"
export FOUNDRY_SKILLS_ROOT="${FOUNDRY_SKILLS_ROOT:-$HOME/.claude/skills}"

echo "export FOUNDRY_REPO_ROOT=\"$FOUNDRY_REPO_ROOT\""
echo "export FOUNDRY_MEMORY_ROOT=\"$FOUNDRY_MEMORY_ROOT\""
echo "export FOUNDRY_SKILLS_ROOT=\"$FOUNDRY_SKILLS_ROOT\""
