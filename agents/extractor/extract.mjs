import { mkdirSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import {
  findSessionJsonl, summarizeSession,
} from '../analyzer/analyze.mjs';
import { readSessionEvents } from '../../packages/hook-bridge/recorder.mjs';
import {
  openDb, insertKnowledgeEntry, insertExperience, getSkillBySlug,
} from '../../packages/hook-bridge/db.mjs';
import { PATHS, getSkillsRoot } from '../../packages/hook-bridge/paths.mjs';
import { evaluateSessionSuccess } from '../../packages/hook-bridge/session-success.mjs';
import { tokenize } from '../../packages/hook-bridge/retriever.mjs';
import { writeEvolvedDraft } from '../evolver/evolve.mjs';

const KNOWLEDGE_CATEGORIES = ['preference', 'entity', 'event', 'pattern', 'profile'];
const ERROR_KEYWORDS = ['error', 'fix', 'bug', 'crash', 'fail', 'npe', 'exception', 'debug'];

/** 從 summary 偵測關聯 skill slug */
export function detectSkillSlug(summary) {
  const db = openDb();
  const prompt = String(summary.prompt || '').toLowerCase();
  const files = (summary.files || []).join(' ').toLowerCase();

  const rows = db.prepare("SELECT slug FROM skills WHERE state IN ('promoted', 'draft', 'staging')").all();
  for (const row of rows) {
    if (prompt.includes(row.slug) || files.includes(row.slug)) {
      return row.slug;
    }
  }

  const skillsRoot = getSkillsRoot();
  for (const f of summary.files || []) {
    const match = f.replace(/\\/g, '/').match(/skills\/([a-z0-9][a-z0-9-]*)\//);
    if (match) return match[1];
  }

  const tokens = tokenize(prompt);
  for (const t of tokens) {
    if (t.length >= 4 && getSkillBySlug(db, t)) return t;
  }

  return null;
}

/** 規則式 rubric 評分 0-3 */
export function scoreSessionRubric(summary, events) {
  const fileCount = summary.file_count || 0;
  const cmdCount = (summary.commands || []).length;
  const promptLen = String(summary.prompt || '').trim().length;
  const eventCount = summary.event_count || events.length;

  let raw = 0;
  if (eventCount < 3) raw = 0;
  else if (fileCount === 0 && cmdCount === 0) raw = 0;
  else if (fileCount <= 1 && cmdCount === 0 && promptLen < 20) raw = 1;
  else if (fileCount >= 3 && cmdCount >= 2 && promptLen >= 30) raw = 3;
  else if (fileCount >= 2 || cmdCount >= 1) raw = 2;
  else raw = 1;

  const skillSlug = detectSkillSlug(summary);
  const workflowSignals = fileCount >= 2 && cmdCount >= 1 && promptLen >= 20;
  const hasErrorContext = ERROR_KEYWORDS.some((k) => {
    const text = `${summary.prompt || ''} ${(summary.commands || []).join(' ')}`.toLowerCase();
    return text.includes(k);
  });

  let target = null;
  let lessonType = 'pattern';
  let category = 'pattern';

  if (raw === 2) {
    if (skillSlug && hasErrorContext) {
      target = 'experience';
      lessonType = 'bug-fix';
    } else if (!skillSlug && fileCount <= 2 && promptLen < 80) {
      target = 'knowledge';
      category = promptLen < 40 ? 'preference' : 'event';
    } else {
      target = 'experience';
      lessonType = hasErrorContext ? 'bug-fix' : 'pattern';
    }
  } else if (raw >= 3) {
    target = 'experience';
    lessonType = skillSlug ? (hasErrorContext ? 'bug-fix' : 'new-solution') : 'pattern';
  }

  return {
    score: raw,
    skill_slug: skillSlug,
    workflowSignals,
    target,
    lesson_type: lessonType,
    category,
    keywords: tokenize(`${summary.prompt || ''} ${(summary.files || []).join(' ')}`).slice(0, 12),
  };
}

/** 產生 abstract 摘要句 */
function buildAbstract(summary, rubric) {
  const prompt = String(summary.prompt || '').trim();
  if (prompt.length > 10) return prompt.slice(0, 200);
  const files = (summary.files || []).slice(0, 3).map((f) => basename(f)).join(', ');
  if (files) return `Worked on ${files} (${rubric.lesson_type})`;
  return `Session workflow with ${summary.file_count || 0} files`;
}

/** 寫入 knowledge body markdown */
function writeKnowledgeBody(entryId, summary, rubric) {
  const dir = PATHS.knowledge();
  mkdirSync(dir, { recursive: true });
  const bodyPath = join(dir, `${entryId}.md`);
  const content = `# Knowledge Entry

**Category**: ${rubric.category}
**Rubric**: ${rubric.score}

## Context

- Tool: ${summary.tool}
- Project: ${summary.project_root || 'unknown'}

## Prompt

${summary.prompt || '(none)'}

## Files

${(summary.files || []).map((f) => `- \`${f}\``).join('\n') || '- (none)'}

## Commands

${(summary.commands || []).map((c) => `- \`${c}\``).join('\n') || '- (none)'}
`;
  writeFileSync(bodyPath, content, 'utf8');
  return bodyPath;
}

/** 寫入 experience body markdown */
function writeExperienceBody(experienceId, summary, rubric) {
  const dir = PATHS.experiences();
  mkdirSync(dir, { recursive: true });
  const bodyPath = join(dir, `${experienceId}.md`);
  const content = `# Experience

**Lesson type**: ${rubric.lesson_type}
**Skill**: ${rubric.skill_slug || '(general)'}
**Rubric**: ${rubric.score}

## Summary

${buildAbstract(summary, rubric)}

## Files touched

${(summary.files || []).map((f) => `- \`${f}\``).join('\n') || '- (none)'}

## Commands run

${(summary.commands || []).map((c) => `- \`${c}\``).join('\n') || '- (none)'}

## Notes

- Session: ${summary.tool} on ${summary.project_root || 'unknown'}
`;
  writeFileSync(bodyPath, content, 'utf8');
  return bodyPath;
}

/** 萃取 session：rubric → experiences / knowledge_entries */
export function extractSession(sessionId) {
  const jsonlPath = findSessionJsonl(sessionId);
  if (!jsonlPath) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const events = readSessionEvents(jsonlPath);
  const successEval = evaluateSessionSuccess(events);
  if (!successEval.success) {
    return { skipped: true, reason: successEval.reason, session_id: sessionId };
  }

  const summary = summarizeSession(events);
  const rubric = scoreSessionRubric(summary, events);

  if (rubric.score < 2) {
    return { skipped: true, reason: 'low_rubric', score: rubric.score, session_id: sessionId };
  }

  const db = openDb();
  const abstract = buildAbstract(summary, rubric);
  const result = {
    session_id: sessionId,
    score: rubric.score,
    writes: [],
    should_evolve_fix: false,
  };

  if (rubric.score === 2 && rubric.target === 'knowledge') {
    const entryId = crypto.randomUUID();
    const bodyPath = writeKnowledgeBody(entryId, summary, rubric);
    insertKnowledgeEntry(db, {
      entryId,
      category: rubric.category,
      abstract,
      keywords: rubric.keywords,
      bodyPath,
      rubricScore: rubric.score,
      sourceSessionId: sessionId,
    });
    result.writes.push({ type: 'knowledge_entry', id: entryId, category: rubric.category });
  } else {
    const experienceId = crypto.randomUUID();
    const bodyPath = writeExperienceBody(experienceId, summary, rubric);
    insertExperience(db, {
      experienceId,
      sessionId,
      skillSlug: rubric.skill_slug,
      lessonType: rubric.lesson_type,
      abstract,
      keywords: rubric.keywords,
      bodyPath,
      rubricScore: rubric.score,
    });
    result.writes.push({
      type: 'experience',
      id: experienceId,
      lesson_type: rubric.lesson_type,
      skill_slug: rubric.skill_slug,
    });

    if (rubric.score >= 3 && rubric.skill_slug && rubric.workflowSignals) {
      const draft = {
        slug: rubric.skill_slug,
        evolution_type: 'FIX',
        session_id: sessionId,
        experience_id: experienceId,
        summary,
        created_at: new Date().toISOString(),
      };
      const paths = writeEvolvedDraft(draft);
      result.should_evolve_fix = true;
      result.fix_draft = { slug: draft.slug, dir: paths.dir };
      result.writes.push({ type: 'evolved_fix', slug: draft.slug });
    }
  }

  return result;
}

export { KNOWLEDGE_CATEGORIES };
