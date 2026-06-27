import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PATHS } from '../../packages/hook-bridge/paths.mjs';
import { scanSkillContent } from '../../packages/hook-bridge/security.mjs';
import { redactString } from '../../packages/hook-bridge/redact.mjs';

/** 脫敏並驗證命令內容 */
function sanitizeCommand(cmd) {
  const redacted = redactString(cmd);
  const issues = scanSkillContent(redacted);
  if (issues.length > 0) return '[REDACTED COMMAND]';
  return redacted;
}

/** 產生 CAPTURED SKILL.md 模板 */
export function buildSkillMarkdown(draft) {
  const { slug, summary, session_id: sessionId } = draft;
  const title = slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const files = (summary.files || []).map((f) => `- \`${f}\``).join('\n') || '- （無檔案變更紀錄）';
  const commands = (summary.commands || []).map((c) => `- \`${sanitizeCommand(c)}\``).join('\n') || '- （無命令紀錄）';

  return `---
name: ${slug}
description: 自 Foundry session ${sessionId.slice(0, 8)} 擷取的工作流草稿
---

# ${title}

> 自動產生的 CAPTURED 草稿，需人工審核後 promote。

## 何時使用

當需要重現以下工作流模式時使用本 skill。

## 上下文

- **工具**: ${summary.tool}
- **專案**: ${summary.project_root || 'unknown'}
- **Git 分支**: ${summary.git?.branch || 'unknown'}
- **事件數**: ${summary.event_count}

## 涉及檔案

${files}

## 執行的命令

${commands}

## 步驟

1. 閱讀上述檔案與命令上下文
2. 依據專案實際情況調整步驟
3. 驗證結果後 promote 到正式 skills 目錄

## 注意事項

- 本草稿由 Foundry Analyzer 規則產生，不含 LLM 推斷
- 推廣前請執行 \`foundry promote ${slug}\` 並通過 Validator
`;
}

/** 產生 provenance.json */
export function buildProvenance(draft) {
  return {
    source: `foundry:session:${draft.session_id}`,
    created_at: draft.created_at,
    confidence: 0.5,
    author: 'foundry-analyzer',
    session_id: draft.session_id,
    evolution_type: 'CAPTURED',
    foundry_version: '0.1.0',
  };
}

/** 寫入 evolved/CAPTURED/{slug}/ */
export function writeEvolvedDraft(draft) {
  const dir = join(PATHS.evolved(), 'CAPTURED', draft.slug);
  mkdirSync(dir, { recursive: true });

  const skillPath = join(dir, 'SKILL.md');
  const provenancePath = join(dir, '.provenance.json');
  const diffPath = join(dir, 'PROMOTE.diff');

  writeFileSync(skillPath, buildSkillMarkdown(draft), 'utf8');
  writeFileSync(provenancePath, `${JSON.stringify(buildProvenance(draft), null, 2)}\n`, 'utf8');
  writeFileSync(diffPath, '# New skill — no parent diff\n', 'utf8');

  return { dir, skillPath, provenancePath };
}
