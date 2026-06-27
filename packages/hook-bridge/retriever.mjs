import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { openDb, incrementReuseCount } from './db.mjs';
import { getSkillsRoot } from './paths.mjs';

/** 分詞用於關鍵字匹配 */
export function tokenize(text) {
  return Array.from(new Set(
    (String(text).toLowerCase().match(/[\p{Letter}\p{Number}_-]+/gu) || [])
      .filter((t) => t.length >= 2),
  ));
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
        walk(full, depth + 1);
      } else if (ent.name === 'SKILL.md') {
        const slug = basename(dir);
        let content = '';
        try {
          content = readFileSync(full, 'utf8').slice(0, 8000);
        } catch {
          continue;
        }
        results.push({ slug, path: full, content, dir });
      }
    }
  }
  walk(skillsRoot);
  return results;
}

/** 從 sqlite 讀取 skill tags（slug + path） */
function getSqliteSkills(db) {
  try {
    return db.prepare('SELECT slug, path, reuse_count FROM skills WHERE state = ?').all('promoted');
  } catch {
    return [];
  }
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
    const score = scoreText(skill.content, prompt, tokens);
    if (score > 0) {
      scored.set(skill.slug, {
        slug: skill.slug,
        path: skill.path,
        score,
        source: 'filesystem',
      });
    }
  }

  for (const row of dbSkills) {
    const score = scoreText(row.slug, prompt, tokens) + (row.reuse_count || 0) * 0.1;
    if (score > 0) {
      const existing = scored.get(row.slug);
      if (!existing || score > existing.score) {
        scored.set(row.slug, {
          slug: row.slug,
          path: row.path,
          score,
          source: 'sqlite',
        });
      }
    }
  }

  return [...scored.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** 構建 before_task 注入上下文 */
export function buildAdditionalContext(prompt) {
  const matches = retrieveSkills({ prompt, limit: 5 });
  if (matches.length === 0) return null;

  const db = openDb();
  for (const m of matches) {
    try {
      incrementReuseCount(db, m.slug);
    } catch {
      // slug 可能尚未在 sqlite 註冊
    }
  }

  const lines = ['[Foundry skill suggestions]'];
  for (const m of matches) {
    lines.push(`- ${m.slug} (score: ${m.score.toFixed(1)})`);
  }
  lines.push('主 agent 自行決定是否採用上述 skills。');
  return lines.join('\n');
}
