# Foundry 每週審核 SOP

## 環境（一次性）

```bash
export FOUNDRY_SKILLS_ROOT="$HOME/.claude/skills"
export FOUNDRY_MEMORY_ROOT="$HOME/.foundry"

node cli/foundry.mjs setup
```

## 每週（約 15 分鐘）

```bash
node cli/foundry.mjs status
node cli/foundry.mjs review
node cli/foundry.mjs audit knowledge
node cli/foundry.mjs autopromote --dry-run
```

### 草稿處理

| 類型 | 命令 |
|------|------|
| 新工作流 | `foundry apply <slug> --type CAPTURED` |
| 改進既有 skill | `foundry apply <slug> --type FIX` |
| 特化變體 | `foundry apply <new-slug> --type DERIVED --parent <parent>` |

apply 後在 `~/.claude/skills` 做 git commit（若該目錄有 git）。

## 每月

```bash
node cli/foundry.mjs archive --days 90 --dry-run
node cli/foundry.mjs archive --days 90
```

## 背景 worker

```bash
# 手動
node cli/foundry.mjs queue-worker --once

# macOS launchd（一次性安裝）
./scripts/install-launchd.sh
```
