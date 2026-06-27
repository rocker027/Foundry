import {
  readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync,
} from 'node:fs';
import { join, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { PATHS, getSkillsRoot } from './paths.mjs';
import {
  insertKnowledgeEntry, insertExperience, getKnowledgeEntry, getExperience, upsertSession,
} from './db.mjs';

/** 確保 migrate 用的 placeholder session 存在，避免 experiences FK 失敗 */
function ensureMigrateSession(db, sessionId, tool) {
  upsertSession(db, {
    sessionId,
    tool,
    projectRoot: null,
    gitBranch: null,
    status: 'ended',
  });
}

function stableId(prefix, content) {
  const hash = createHash('sha256').update(content).digest('hex').slice(0, 12);
  return `${prefix}-${hash}`;
}

function extractKeywords(text) {
  const matches = text.match(/\*\*關鍵詞[：:]\*\*\s*(.+)/i)
    || text.match(/keywords[：:]\s*(.+)/i);
  if (!matches) return [];
  return matches[1].split(/[,，、]/).map((k) => k.trim()).filter(Boolean);
}

function writeBodyFile(dir, id, content) {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${id}.md`);
  writeFileSync(path, content, 'utf8');
  return path;
}

/** 解析 mnemo MEMORY.md 條目 */
export function parseMnemoMemory(content) {
  const entries = [];
  const lines = content.split('\n').filter((l) => l.trim() && !l.startsWith('#'));
  for (const line of lines) {
    const match = line.match(/^(\d{4}-\d{2}-\d{2})\s+(\w+):\s*(.+)$/);
    if (!match) continue;
    const [, date, category, abstract] = match;
    const normalizedCategory = ['preference', 'entity', 'event', 'pattern', 'profile', 'case']
      .includes(category) ? category : 'pattern';
    entries.push({
      date,
      category: normalizedCategory,
      abstract: abstract.trim(),
      keywords: [],
    });
  }
  return entries;
}

/** 解析 mnemo USER.md 為 profile entry */
export function parseMnemoUser(content) {
  const lines = content.split('\n').filter((l) => l.trim() && !l.startsWith('#'));
  const abstract = lines.slice(0, 3).join('; ') || 'User profile';
  return { category: 'profile', abstract, keywords: ['user', 'profile'] };
}

/** 從 experience markdown 萃取摘要 */
export function parseExperienceMarkdown(content, { defaultSkillSlug = null } = {}) {
  const titleMatch = content.match(/^#\s+(.+)/m);
  const typeMatch = content.match(/\*\*教訓類型\*\*[：:]\s*(\S+)/i)
    || content.match(/\*\*類別\*\*[：:]\s*(\S+)/i);
  const skillMatch = content.match(/\*\*技能\*\*[：:]\s*(\S+)/i)
    || content.match(/^#\s+Skill:\s*(\S+)/im);
  const abstract = titleMatch?.[1]?.trim() || content.slice(0, 120).replace(/\n/g, ' ');
  return {
    lessonType: typeMatch?.[1]?.toLowerCase() || 'pattern',
    skillSlug: skillMatch?.[1] || defaultSkillSlug,
    abstract,
    keywords: extractKeywords(content),
    rubricScore: 2,
  };
}

/** 匯入 skill-mnemo 資料到 sqlite + body 檔 */
export function migrateMnemo(db, {
  mnemoDir,
  dryRun = false,
  sessionId = 'migrate-mnemo',
} = {}) {
  const root = mnemoDir || join(getSkillsRoot(), 'skill-mnemo');
  const stats = { knowledge: 0, experiences: 0, skipped: 0, errors: [] };

  if (!existsSync(root)) {
    stats.errors.push(`Mnemo dir not found: ${root}`);
    return stats;
  }

  if (!dryRun) {
    ensureMigrateSession(db, sessionId, 'migrate-mnemo');
  }

  const memoryPath = join(root, 'MEMORY.md');
  if (existsSync(memoryPath)) {
    const memoryContent = readFileSync(memoryPath, 'utf8');
    for (const entry of parseMnemoMemory(memoryContent)) {
      const entryId = stableId('kn', `${entry.date}:${entry.category}:${entry.abstract}`);
      const body = `---\nsource: skill-mnemo/MEMORY.md\ndate: ${entry.date}\ncategory: ${entry.category}\n---\n\n${entry.abstract}\n`;
      if (dryRun) {
        stats.knowledge += 1;
        continue;
      }
      if (getKnowledgeEntry(db, entryId)) {
        stats.skipped += 1;
        continue;
      }
      const bodyPath = writeBodyFile(PATHS.knowledge(), entryId, body);
      insertKnowledgeEntry(db, {
        entryId,
        category: entry.category,
        abstract: entry.abstract,
        keywords: entry.keywords,
        bodyPath,
        rubricScore: 2,
        sourceSessionId: sessionId,
      });
      stats.knowledge += 1;
    }
  }

  const userPath = join(root, 'USER.md');
  if (existsSync(userPath)) {
    const user = parseMnemoUser(readFileSync(userPath, 'utf8'));
    const entryId = 'kn-user-profile';
    if (dryRun) {
      stats.knowledge += 1;
    } else if (getKnowledgeEntry(db, entryId)) {
      stats.skipped += 1;
    } else {
      const bodyPath = writeBodyFile(PATHS.knowledge(), entryId, readFileSync(userPath, 'utf8'));
      insertKnowledgeEntry(db, {
        entryId,
        category: user.category,
        abstract: user.abstract,
        keywords: user.keywords,
        bodyPath,
        rubricScore: 3,
        sourceSessionId: sessionId,
        state: 'pinned',
      });
      stats.knowledge += 1;
    }
  }

  const expDir = join(root, 'experience');
  if (existsSync(expDir)) {
    for (const ent of readdirSync(expDir, { withFileTypes: true })) {
      if (!ent.isFile() || !ent.name.endsWith('.md')) continue;
      const content = readFileSync(join(expDir, ent.name), 'utf8');
      const parsed = parseExperienceMarkdown(content, { defaultSkillSlug: basename(ent.name, '.md') });
      const experienceId = stableId('exp', content);
      if (dryRun) {
        stats.experiences += 1;
        continue;
      }
      if (getExperience(db, experienceId)) {
        stats.skipped += 1;
        continue;
      }
      const bodyPath = writeBodyFile(PATHS.experiences(), experienceId, content);
      insertExperience(db, {
        experienceId,
        sessionId,
        skillSlug: parsed.skillSlug,
        lessonType: parsed.lessonType,
        abstract: parsed.abstract,
        keywords: parsed.keywords,
        bodyPath,
        rubricScore: parsed.rubricScore,
        state: 'promoted',
      });
      stats.experiences += 1;
    }
  }

  return stats;
}

/** 匯入 auto-skill experience/ 與 knowledge-base/ */
export function migrateAutoSkill(db, {
  autoSkillDir,
  dryRun = false,
  sessionId = 'migrate-auto-skill',
} = {}) {
  const root = autoSkillDir || join(getSkillsRoot(), 'auto-skill');
  const stats = { knowledge: 0, experiences: 0, skipped: 0, errors: [] };

  if (!existsSync(root)) {
    stats.errors.push(`auto-skill dir not found: ${root}`);
    return stats;
  }

  if (!dryRun) {
    ensureMigrateSession(db, sessionId, 'migrate-auto-skill');
  }

  const kbDir = join(root, 'knowledge-base');
  if (existsSync(kbDir)) {
    for (const ent of readdirSync(kbDir, { withFileTypes: true })) {
      if (!ent.isFile() || !ent.name.endsWith('.md') || ent.name.startsWith('_')) continue;
      const content = readFileSync(join(kbDir, ent.name), 'utf8');
      const titleMatch = content.match(/^#\s+(.+)/m);
      const abstract = titleMatch?.[1]?.trim() || basename(ent.name, '.md');
      const entryId = stableId('kn', `auto:${ent.name}:${content.slice(0, 200)}`);
      if (dryRun) {
        stats.knowledge += 1;
        continue;
      }
      if (getKnowledgeEntry(db, entryId)) {
        stats.skipped += 1;
        continue;
      }
      const bodyPath = writeBodyFile(PATHS.knowledge(), entryId, content);
      insertKnowledgeEntry(db, {
        entryId,
        category: 'pattern',
        abstract,
        keywords: extractKeywords(content),
        bodyPath,
        rubricScore: 2,
        sourceSessionId: sessionId,
      });
      stats.knowledge += 1;
    }
  }

  const expDir = join(root, 'experience');
  if (existsSync(expDir)) {
    for (const ent of readdirSync(expDir, { withFileTypes: true })) {
      if (!ent.isFile() || !ent.name.endsWith('.md') || ent.name.startsWith('_')) continue;
      const content = readFileSync(join(expDir, ent.name), 'utf8');
      const parsed = parseExperienceMarkdown(content, { defaultSkillSlug: basename(ent.name, '.md').replace(/^skill-/, '') });
      const experienceId = stableId('exp', `auto:${ent.name}:${content.slice(0, 200)}`);
      if (dryRun) {
        stats.experiences += 1;
        continue;
      }
      if (getExperience(db, experienceId)) {
        stats.skipped += 1;
        continue;
      }
      const bodyPath = writeBodyFile(PATHS.experiences(), experienceId, content);
      insertExperience(db, {
        experienceId,
        sessionId,
        skillSlug: parsed.skillSlug,
        lessonType: parsed.lessonType,
        abstract: parsed.abstract,
        keywords: parsed.keywords,
        bodyPath,
        rubricScore: 3,
        state: 'promoted',
      });
      stats.experiences += 1;
    }
  }

  return stats;
}
