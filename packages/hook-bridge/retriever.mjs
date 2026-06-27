import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import {
  openDb, incrementReuseCount, incrementKnowledgeAccess,
  queryKnowledgeEntries, queryExperiences,
} from './db.mjs';
import { getSkillsRoot } from './paths.mjs';
import {
  isExcludedSkill, shouldSkipSkillDirectoryName, shouldSkipSkillScanPath,
  getExcludedSlugList,
} from './skill-filter.mjs';

const COMPOUND_KEYWORDS = ['plan', 'review', 'design', 'architect', 'refactor', 'audit', 'strategy'];

/** 分詞用於關鍵字匹配 */
export function tokenize(text) {
  return Array.from(new Set(
    (String(text).toLowerCase().match(/[\p{Letter}\p{Number}_-]+/gu) || [])
      .filter((t) => t.length >= 2),
  ));
}

/** 是否為 compound 召回模式（plan/review 等關鍵字） */
export function isCompoundMode(prompt) {
  const lower = String(prompt || '').toLowerCase();
  return COMPOUND_KEYWORDS.some((k) => lower.includes(k));
}

/** 對文字打分 */
function scoreText(text, prompt, tokens) {
  const lower = String(text).toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (lower.includes(token)) score += token.length > 3 ? 2 : 1;
  }
  if (prompt && lower.includes(prompt.toLowerCase().slice(0, 40))) score += 3;
  return score;
}

/** 對 keywords 陣列打分 */
function scoreKeywords(keywords, tokens) {
  if (!keywords?.length) return 0;
  let score = 0;
  for (const kw of keywords) {
    const lower = String(kw).toLowerCase();
    for (const token of tokens) {
      if (lower.includes(token)) score += 2;
    }
  }
  return score;
}

/** 掃描 skills 目錄下的 SKILL.md */
function scanSkillFiles(skillsRoot) {
  const results = [];
  if (!existsSync(skillsRoot)) return results;

  function walk(dir, depth = 0) {
    if (depth > 4) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const full = join(dir, ent.name);
      if (ent.isDirectory()) {
        if (shouldSkipSkillDirectoryName(ent.name) || shouldSkipSkillScanPath(full)) continue;
        walk(full, depth + 1);
      } else if (ent.name === 'SKILL.md') {
        let content = '';
        try {
          content = readFileSync(full, 'utf8').slice(0, 8000);
        } catch {
          continue;
        }
        const slug = basename(dir);
        if (isExcludedSkill(slug, parseSkillDescription(content))) continue;
        results.push({ slug, path: full, content, dir });
      }
    }
  }
  walk(skillsRoot);
  return results;
}

/** 從 SKILL.md frontmatter 解析 description */
export function parseSkillDescription(content) {
  const match = String(content).match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return '';
  const desc = match[1].match(/^description:\s*(.+)$/m)?.[1]?.trim();
  return desc || '';
}

/** 從 sqlite 讀取 skill tags（slug + path + metrics） */
function getSqliteSkills(db) {
  try {
    const excluded = getExcludedSlugList();
    if (excluded.length === 0) {
      return db.prepare(
        'SELECT slug, path, reuse_count, success_rate FROM skills WHERE state = ?',
      ).all('promoted');
    }
    const placeholders = excluded.map(() => '?').join(', ');
    return db.prepare(
      `SELECT slug, path, reuse_count, success_rate FROM skills
       WHERE state = ? AND slug NOT IN (${placeholders})`,
    ).all('promoted', ...excluded);
  } catch {
    return [];
  }
}

/** 從 sqlite 查詢 knowledge + experiences */
function queryMemoryEntries(db, { compound = false, limit = 20 } = {}) {
  const knowledge = queryKnowledgeEntries(db, { state: 'active', limit });
  const experiences = queryExperiences(db, {
    state: compound ? undefined : 'pending',
    limit,
  });
  return { knowledge, experiences };
}

/** 關鍵字檢索建議 skills */
export function retrieveSkills({ prompt, limit = 5 }) {
  const tokens = tokenize(prompt || '');
  if (tokens.length === 0) return [];

  const skillsRoot = getSkillsRoot();
  const db = openDb();
  const fileSkills = scanSkillFiles(skillsRoot);
  const dbSkills = getSqliteSkills(db);

  const scored = new Map();

  for (const skill of fileSkills) {
    const description = parseSkillDescription(skill.content);
    const score = scoreText(skill.content, prompt, tokens)
      + scoreText(description, prompt, tokens);
    if (score > 0) {
      scored.set(skill.slug, {
        slug: skill.slug,
        path: skill.path,
        score,
        source: 'filesystem',
        kind: 'skill',
        description,
      });
    }
  }

  for (const row of dbSkills) {
    const score = scoreText(row.slug, prompt, tokens)
      + (row.reuse_count || 0) * 0.1
      + (row.success_rate || 0) * 5;
    if (score > 0) {
      const existing = scored.get(row.slug);
      const fileMatch = fileSkills.find((s) => s.slug === row.slug);
      const description = fileMatch ? parseSkillDescription(fileMatch.content) : '';
      if (!existing || score > existing.score) {
        scored.set(row.slug, {
          slug: row.slug,
          path: row.path,
          score,
          source: 'sqlite',
          kind: 'skill',
          description,
        });
      }
    }
  }

  return [...scored.values()]
    .filter((entry) => !isExcludedSkill(entry.slug, entry.description))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** 檢索 knowledge entries 與 experiences */
export function retrieveMemory({ prompt, limit = 5, compound = false }) {
  const tokens = tokenize(prompt || '');
  if (tokens.length === 0) return { knowledge: [], experiences: [] };

  const db = openDb();
  const { knowledge, experiences } = queryMemoryEntries(db, { compound, limit: limit * 4 });

  const scoredKnowledge = knowledge
    .map((entry) => ({
      ...entry,
      score: scoreText(entry.abstract, prompt, tokens) + scoreKeywords(entry.keywords, tokens),
      kind: 'knowledge',
    }))
    .filter((e) => e.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  const scoredExperiences = experiences
    .map((exp) => ({
      ...exp,
      score: scoreText(exp.abstract, prompt, tokens) + scoreKeywords(exp.keywords, tokens)
        + (exp.skill_slug && tokens.some((t) => exp.skill_slug.includes(t)) ? 3 : 0),
      kind: 'experience',
    }))
    .filter((e) => e.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return { knowledge: scoredKnowledge, experiences: scoredExperiences };
}

/** 取得 profile 前置內容（category=profile） */
export function getProfilePrepend(db) {
  const profiles = queryKnowledgeEntries(db, { state: 'active', category: 'profile', limit: 3 });
  if (profiles.length === 0) return null;

  const lines = ['[Foundry user profile]'];
  for (const p of profiles) {
    lines.push(`- ${p.abstract}`);
    incrementKnowledgeAccess(db, p.entry_id);
  }
  return lines.join('\n');
}

/** 構建 before_task 注入上下文 */
export function buildAdditionalContext(prompt) {
  const compound = isCompoundMode(prompt);
  const skillMatches = retrieveSkills({ prompt, limit: compound ? 8 : 5 });
  const memory = retrieveMemory({ prompt, limit: compound ? 5 : 3, compound });

  const db = openDb();
  const profile = getProfilePrepend(db);

  if (skillMatches.length === 0 && memory.knowledge.length === 0
    && memory.experiences.length === 0 && !profile) {
    return null;
  }

  for (const m of skillMatches) {
    try {
      incrementReuseCount(db, m.slug);
    } catch {
      // slug 可能尚未在 sqlite 註冊
    }
  }

  for (const k of memory.knowledge) {
    incrementKnowledgeAccess(db, k.entry_id);
  }

  const lines = [];

  if (profile) {
    lines.push(profile, '');
  }

  if (memory.knowledge.length > 0) {
    lines.push('[Foundry knowledge]');
    for (const k of memory.knowledge) {
      lines.push(`- (${k.category}) ${k.abstract}`);
    }
    lines.push('');
  }

  if (memory.experiences.length > 0) {
    lines.push('[Foundry experiences]');
    for (const e of memory.experiences) {
      const slugPart = e.skill_slug ? ` [${e.skill_slug}]` : '';
      lines.push(`- (${e.lesson_type})${slugPart} ${e.abstract}`);
    }
    lines.push('');
  }

  if (skillMatches.length > 0) {
    lines.push('[Foundry skill suggestions]');
    for (const m of skillMatches) {
      const desc = m.description ? `: ${m.description.slice(0, 120)}` : '';
      lines.push(`- ${m.slug}${desc} (score: ${m.score.toFixed(1)})`);
    }
    lines.push('主 agent 自行決定是否採用上述 skills。');
  }

  return lines.join('\n');
}
