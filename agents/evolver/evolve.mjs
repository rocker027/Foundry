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
    confidence: draft.evolution_type === 'FIX' ? 0.7 : 0.5,
    author: draft.evolution_type === 'FIX' ? 'foundry-extractor' : 'foundry-analyzer',
    session_id: draft.session_id,
    experience_id: draft.experience_id ?? null,
    evolution_type: draft.evolution_type || 'CAPTURED',
    foundry_version: '0.1.0',
  };
}

/** 產生 FIX SKILL.md 補丁草稿 */
export function buildFixSkillMarkdown(draft) {
  const { slug, summary, session_id: sessionId } = draft;
  const files = (summary.files || []).map((f) => `- \`${f}\``).join('\n') || '- （無檔案變更紀錄）';
  const commands = (summary.commands || []).map((c) => `- \`${sanitizeCommand(c)}\``).join('\n') || '- （無命令紀錄）';

  return `---
name: ${slug}
description: FIX 草稿 — 自 session ${sessionId.slice(0, 8)} 萃取的 skill 改進
---

# FIX: ${slug}

> 自動產生的 FIX 草稿，需人工審核後 apply。

## 改進摘要

${summary.prompt || '（無明確 prompt）'}

## 本次涉及檔案

${files}

## 執行的命令

${commands}

## 建議合併步驟

1. 閱讀上述上下文與現有 SKILL.md
2. 將可重用步驟補入對應章節
3. 執行 \`foundry apply ${slug} --type FIX\` 並通過 Validator
`;
}

/** 寫入 evolved/{type}/{slug}/ */
export function writeEvolvedDraft(draft) {
  const evolutionType = draft.evolution_type || 'CAPTURED';
  const dir = join(PATHS.evolved(), evolutionType, draft.slug);
  mkdirSync(dir, { recursive: true });

  const skillPath = join(dir, 'SKILL.md');
  const provenancePath = join(dir, '.provenance.json');
  const diffPath = join(dir, 'PROMOTE.diff');

  const markdown = evolutionType === 'FIX'
    ? buildFixSkillMarkdown(draft)
    : buildSkillMarkdown(draft);

  writeFileSync(skillPath, markdown, 'utf8');
  writeFileSync(provenancePath, `${JSON.stringify(buildProvenance(draft), null, 2)}\n`, 'utf8');
  writeFileSync(
    diffPath,
    evolutionType === 'FIX' ? '# FIX draft — merge into existing skill\n' : '# New skill — no parent diff\n',
    'utf8',
  );

  return { dir, skillPath, provenancePath };
}
