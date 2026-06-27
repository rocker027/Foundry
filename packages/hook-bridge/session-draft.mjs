import { findSessionJsonl, summarizeSession, slugify } from '../../agents/analyzer/analyze.mjs';
import { readSessionEvents } from './recorder.mjs';
import { extractSession } from '../../agents/extractor/extract.mjs';
import { writeEvolvedDraft } from '../../agents/evolver/evolve.mjs';
import { openDb, queryExperiences } from './db.mjs';
import { validateSlug } from './security.mjs';

/** 從 session 取得或建立 experience_id */
function resolveExperienceId(sessionId, skillSlug) {
  const extractResult = extractSession(sessionId);
  if (!extractResult.skipped) {
    const expWrite = extractResult.writes?.find((w) => w.type === 'experience');
    if (expWrite?.id) return { experienceId: expWrite.id, extractResult };
  }

  const db = openDb();
  const rows = queryExperiences(db, { state: null, limit: 100 })
    .filter((e) => e.session_id === sessionId);
  const match = skillSlug
    ? rows.find((e) => e.skill_slug === skillSlug) || rows[0]
    : rows[0];
  if (match) return { experienceId: match.experience_id, extractResult };

  return { experienceId: null, extractResult };
}

/** 讀取 session 摘要 */
function loadSessionSummary(sessionId) {
  const jsonlPath = findSessionJsonl(sessionId);
  if (!jsonlPath) {
    throw new Error(`Session not found: ${sessionId}`);
  }
  const events = readSessionEvents(jsonlPath);
  if (events.length === 0) {
    throw new Error(`No events for session: ${sessionId}`);
  }
  return { summary: summarizeSession(events), jsonlPath };
}

/** 從 session 建立 FIX 草稿 */
export function createFixDraftFromSession(slug, sessionId) {
  validateSlug(slug);
  if (!sessionId) {
    throw new Error('--from-session <id> is required');
  }

  const { summary } = loadSessionSummary(sessionId);
  const { experienceId, extractResult } = resolveExperienceId(sessionId, slug);

  const draft = {
    slug,
    evolution_type: 'FIX',
    session_id: sessionId,
    experience_id: experienceId,
    summary,
    created_at: new Date().toISOString(),
  };
  const paths = writeEvolvedDraft(draft);

  return {
    slug,
    sessionId,
    experienceId,
    dir: paths.dir,
    extractResult,
  };
}

/** 從 session 建立 DERIVED 草稿 */
export function createDerivedDraftFromSession(parentSlug, sessionId, variant = null) {
  validateSlug(parentSlug);
  if (!sessionId) {
    throw new Error('--from-session <id> is required');
  }

  const variantSlug = variant
    ? slugify(variant)
    : slugify(`variant-${sessionId.slice(0, 8)}`);
  const childSlug = `${parentSlug}-${variantSlug}`;
  validateSlug(childSlug);

  const { summary } = loadSessionSummary(sessionId);
  const { experienceId, extractResult } = resolveExperienceId(sessionId, parentSlug);

  const draft = {
    slug: childSlug,
    evolution_type: 'DERIVED',
    parent_slug: parentSlug,
    session_id: sessionId,
    experience_id: experienceId,
    summary,
    created_at: new Date().toISOString(),
  };
  const paths = writeEvolvedDraft(draft);

  return {
    slug: childSlug,
    parentSlug,
    sessionId,
    experienceId,
    dir: paths.dir,
    extractResult,
  };
}
