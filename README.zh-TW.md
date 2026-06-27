# Foundry

跨工具的 hook 驅動 **Skill 演化層**，支援 Cursor、Codex 與 Claude Code。

Foundry 透過 hooks 記錄 agent 工作階段，離線分析成功執行紀錄，產生 CAPTURED / FIX / DERIVED 技能草稿，並將通過驗證的技能 promote 至正式 skills 目錄。

[English](README.md)

## 快速開始

```bash
cd /path/to/Foundry
npm install

# 檢查狀態（空 store 亦可執行）
node cli/foundry.mjs status

# 在目前專案安裝 Cursor hooks
node cli/foundry.mjs install-hooks cursor

# 安裝 Codex / Claude Code hooks（使用者層級）
node cli/foundry.mjs install-hooks codex
node cli/foundry.mjs install-hooks claude

# 模擬 recorder 事件（驗證 JSONL 寫入）
node cli/foundry.mjs simulate-recorder

# 將 session 分析為 evolved/CAPTURED/ 草稿
node cli/foundry.mjs analyze --session <session-id>

# Promote 已驗證的草稿
node cli/foundry.mjs promote <slug> [--type CAPTURED|FIX|DERIVED] [--force]

# 安全稽核
node cli/foundry.mjs audit

# 封存超過 90 天的 runs
node cli/foundry.mjs archive --days 90 --dry-run

# 處理非同步分析佇列（session 結束後）
node cli/foundry.mjs queue-worker --once

# 執行安全單元測試（16 項）
npm test
```

## 環境變數

| 變數 | 預設值 | 說明 |
|------|--------|------|
| `FOUNDRY_MEMORY_ROOT` | `~/.foundry` | 資料根目錄 |
| `FOUNDRY_SKILLS_ROOT` | `~/Documents/code/ai_coding_labs/skills` | Promote 目標目錄 |
| `FOUNDRY_ALLOW_CUSTOM_SKILLS_ROOT` | 未設定 | 設為 `1` 可允許 promote 至任意 `FOUNDRY_SKILLS_ROOT`，無需 `--force` |
| `FOUNDRY_REPO_ROOT` | Foundry repo 路徑 | 工具根目錄 |
| `FOUNDRY_PROJECT_RUNS` | `<project>/.foundry/runs` | 專案 overlay |

## 架構

詳見 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 安全邊界

- Hooks 不可讀取 `.env` 路徑（`security.mjs` denylist）
- 無 cloud 上傳程式碼
- `evolved/` 不可覆蓋 `skills/` — promote 使用 copy + git diff
- Validator 掃描 prompt injection 模式
- 同步 hook 逾時：Cursor 3–5 秒（見 `.cursor/hooks.json`）

### 輸入驗證

- **`validateSlug()`** — 所有 slug 參數須符合 `^[a-z0-9][a-z0-9-]{0,63}$`（小寫英數、連字號、最多 64 字元，禁止路徑穿越）
- **`assertPathWithinRoot()`** — promote 會 resolve 來源與目標路徑，拒絕逃出根目錄的路徑

### Promote 防護

- **`foundry promote <slug> [--type CAPTURED|FIX|DERIVED] [--force]`** — `--type` 指定 `evolved/{TYPE}/` 下的草稿；預設為 `CAPTURED`
- **`assertSkillsRootAllowed()`** — 當 `FOUNDRY_SKILLS_ROOT` 不在預設的 `~/Documents/code/ai_coding_labs/skills` 時會阻擋 promote，除非：
  - 已設定 `FOUNDRY_ALLOW_CUSTOM_SKILLS_ROOT=1`，或
  - 傳入 `--force`（輸出警告後繼續）
- 無需覆寫即可通過：預設 skills 根目錄，或 `$HOME` 下且路徑包含 `ai_coding_labs/` 的目錄

### 程序與資料強化

- **Git 子程序** — `git.mjs` 使用 `spawnSync` 且 `shell: false`；執行 `git diff` 前會先驗證 slug
- **檔案權限** — 寫入 `skill_store.sqlite` 與 run JSONL 時會 chmod `600`
- **Hook adapter 失敗放行** — Cursor、Codex、Claude adapter 在 stdin JSON 無效時記錄錯誤並以 exit `0` 結束，避免 malformed hook payload 阻擋主機工具
- **CAPTURED 命令再脫敏** — evolved 草稿中的命令會再次經過 `redactString()`；危險模式會替換為 `[REDACTED COMMAND]`

### 測試

```bash
npm test   # 16 項單元測試：validateSlug、路徑 denylist、git slug 安全、脫敏
```

## 與 skill-mnemo 的關係

| 工具 | 職責 |
|------|------|
| **skill-mnemo** | 回合級記憶召回（USER / MEMORY） |
| **Foundry** | 從 runs 演化可重用 SKILL |

Superset hooks 會在 Foundry adapter 之後自動 chain，不影響既有通知。
