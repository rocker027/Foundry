import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { scanSkillContent, assertWritableTarget, isDeniedPath, validateSlug, assertPathWithinRoot } from '../../packages/hook-bridge/security.mjs';
import { PATHS, getSkillsRoot } from '../../packages/hook-bridge/paths.mjs';

const SHELL_PATTERNS = [
  /\b(npm|pnpm|yarn|node|python|bash|sh|curl|wget)\b/i,
  /```(?:bash|sh|shell)/i,
];

/** 解析 SKILL.md frontmatter */
export function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return { valid: false, error: 'Missing YAML frontmatter' };
  const fm = match[1];
  const name = fm.match(/^name:\s*(.+)$/m)?.[1]?.trim();
  const description = fm.match(/^description:\s*(.+)$/m)?.[1]?.trim();
  if (!name) return { valid: false, error: 'Missing name in frontmatter' };
  if (!description) return { valid: false, error: 'Missing description in frontmatter' };
  return { valid: true, name, description, frontmatter: fm };
}

/** 驗證 provenance */
export function validateProvenance(provenance) {
  const required = ['source', 'created_at', 'confidence', 'author'];
  const missing = required.filter((k) => !provenance[k]);
  if (missing.length > 0) {
    return { valid: false, error: `Missing provenance fields: ${missing.join(', ')}` };
  }
  if (provenance.confidence < 0 || provenance.confidence > 1) {
    return { valid: false, error: 'confidence must be 0-1' };
  }
  return { valid: true };
}

/** 偵測 skill 是否含 shell 命令（低風險判定） */
export function hasShellContent(content) {
  return SHELL_PATTERNS.some((re) => re.test(content));
}

/** 完整驗證 evolved draft */
export function validateDraft(slug, evolutionType = 'CAPTURED') {
  const errors = [];
  const warnings = [];

  try {
    validateSlug(slug);
  } catch (err) {
    return {
      valid: false,
      errors: [err instanceof Error ? err.message : String(err)],
      warnings,
      lowRisk: false,
    };
  }

  const dir = join(PATHS.evolved(), evolutionType, slug);
  try {
    assertPathWithinRoot(dir, PATHS.evolved());
  } catch (err) {
    return {
      valid: false,
      errors: [err instanceof Error ? err.message : String(err)],
      warnings,
      lowRisk: false,
    };
  }

  const skillPath = join(dir, 'SKILL.md');
  const provenancePath = join(dir, '.provenance.json');

  if (!existsSync(skillPath)) {
    return { valid: false, errors: [`SKILL.md not found: ${skillPath}`], warnings };
  }

  const content = readFileSync(skillPath, 'utf8');
  const fm = parseFrontmatter(content);
  if (!fm.valid) errors.push(fm.error);

  const securityIssues = scanSkillContent(content);
  errors.push(...securityIssues);

  if (existsSync(provenancePath)) {
    const prov = JSON.parse(readFileSync(provenancePath, 'utf8'));
    const pv = validateProvenance(prov);
    if (!pv.valid) errors.push(pv.error);
  } else {
    errors.push('Missing .provenance.json');
  }

  // evolved 不可覆蓋 skills/
  const skillsRoot = getSkillsRoot();
  const targetDir = join(skillsRoot, slug);
  try {
    assertWritableTarget(targetDir, [skillsRoot, PATHS.staging()]);
  } catch (e) {
    errors.push(e.message);
  }

  const lowRisk = !hasShellContent(content);
  if (!lowRisk) {
    warnings.push('Contains shell patterns — requires manual review');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    lowRisk,
    skillPath,
    targetDir,
    dir,
  };
}

/** 安全稽核 memory store */
export function auditMemoryStore() {
  const issues = [];
  const runsRoot = PATHS.runs();

  function scanDir(dir, depth = 0) {
    if (depth > 6 || !existsSync(dir)) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const full = join(dir, ent.name);
      if (isDeniedPath(full)) {
        issues.push({ type: 'denied_path', path: full });
      }
      if (ent.isDirectory()) scanDir(full, depth + 1);
      else if (ent.name.endsWith('.jsonl')) {
        const sample = readFileSync(full, 'utf8').slice(0, 4000);
        const sec = scanSkillContent(sample);
        for (const s of sec) {
          issues.push({ type: 'injection_pattern', path: full, detail: s });
        }
      }
    }
  }

  scanDir(runsRoot);
  scanDir(PATHS.evolved());
  scanDir(PATHS.staging());
  return {
    ok: issues.length === 0,
    issue_count: issues.length,
    issues: issues.slice(0, 50),
    memory_root: PATHS.sqlite().replace('/shared-agent-memory/skill_store.sqlite', ''),
  };
}
