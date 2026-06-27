# Foundry

跨工具的 hook 驅動 **Skill 演化層**，支援 Cursor、Codex 與 Claude Code。

Foundry 透過 hooks 記錄 agent 工作階段，離線分析成功執行紀錄，產生 CAPTURED / FIX / DERIVED 技能草稿，並將通過驗證的技能 promote 至正式 skills 目錄。

[English](README.md)

## 快速開始

```bash
cd /path/to/Foundry
npm install

# 一次性設定：環境變數提示 + 三端 hooks
node cli/foundry.mjs setup --target /path/to/your/project

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

# 從 session 建立 FIX 草稿（連結 experience）
node cli/foundry.mjs fix <slug> --from-session <session-id>

# 從 session 建立 DERIVED 變體草稿
node cli/foundry.mjs derive <parent-slug> --from-session <session-id> [--variant <name>]

# Apply 已驗證的草稿（promote 別名）
node cli/foundry.mjs apply <slug> [--type CAPTURED|FIX|DERIVED] [--draft <slug>] [--parent <slug>] [--force]
node cli/foundry.mjs promote <slug>   # apply 別名

# 收編既有 skills 至版本追蹤
node cli/foundry.mjs adopt [--dry-run] [--slug <name>]

# 審核草稿、版本歷史、diff、回滾
node cli/foundry.mjs review
node cli/foundry.mjs history <slug>
node cli/foundry.mjs diff <slug> [--from vN] [--to current|vN]
node cli/foundry.mjs rollback <slug> --to vN [--force]

# 匯入 legacy 記憶至 SQLite
node cli/foundry.mjs migrate-mnemo [--dry-run] [--path <dir>]
node cli/foundry.mjs migrate-auto-skill [--dry-run] [--path <dir>]

# 安全稽核 + knowledge lifecycle 稽核
node cli/foundry.mjs audit
node cli/foundry.mjs audit knowledge

# 廢棄 legacy auto-skill / skill-mnemo 目錄（預設 dry-run）
node cli/foundry.mjs deprecate-legacy [--dry-run]
node cli/foundry.mjs deprecate-legacy --execute

# 封存超過 90 天的 runs
node cli/foundry.mjs archive --days 90 --dry-run

# 處理非同步分析佇列（建議 cron 每 5 分鐘）
node cli/foundry.mjs queue-worker --once

# 執行單元測試
npm test
```

## 環境變數

| 變數 | 預設值 | 說明 |
|------|--------|------|
| `FOUNDRY_MEMORY_ROOT` | `~/.foundry` | 資料根目錄 |
| `FOUNDRY_SKILLS_ROOT` | `~/.claude/skills` | Promote 目標目錄 |
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

Foundry 已**取代** skill-mnemo 與 auto-skill 的記憶索引與 skill 演化。請先 `migrate-mnemo` / `migrate-auto-skill`，再 `deprecate-legacy`。

| 工具 | 職責 |
|------|------|
| **Foundry** | Session 記錄、經驗萃取、skill 演化、統一 SQLite 召回 |
| **skill-mnemo**（已廢棄） | 原為 USER/MEMORY 回合召回 — 改用 Foundry Retriever |

Superset hooks 會在 Foundry adapter 之後自動 chain，不影響既有通知。

### 背景 worker（macOS launchd）

見 [docs/launchd/foundry-queue-worker.plist.example](docs/launchd/foundry-queue-worker.plist.example)，每 5 分鐘執行 `queue-worker --once`。
