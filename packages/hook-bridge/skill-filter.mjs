import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getMemoryRoot } from './paths.mjs';

/** Foundry 取代的 legacy skills — 不召回、不 adopt */
export const LEGACY_SKILL_SLUGS = new Set([
  'skill-mnemo',
  'auto-skill',
  'auto-skill-claude',
]);

/** OMX / 插件基礎設施 skills — 由插件路由，不由 Foundry 建議 */
export const PLUGIN_INFRA_SKILL_SLUGS = new Set([
  'analyze',
  'help',
  'worker',
  'plan',
  'autopilot',
  'omc-plan',
  'debug',
  'note',
  'omc-reference',
  'review-bugbot',
  'review-security',
]);

const DEPRECATED_PATH_RE = /[/\\]_deprecated[/\\]/;
const FOUNDRY_META_RE = /[/\\]\.foundry[/\\]/;
const PLUGIN_PATH_RE = /[/\\]\.cursor[/\\]plugins[/\\]/;
const PLUGIN_CACHE_RE = /[/\\]plugins[/\\]cache[/\\]/;

let cachedUserDenylist = null;

export function isLegacySkillSlug(slug) {
  return LEGACY_SKILL_SLUGS.has(String(slug || '').trim());
}

export function isOmxPluginSkill(description) {
  return String(description || '').includes('[OMX]');
}

/** 讀取 ~/.foundry/config/skill-denylist.json */
export function loadUserDenylist({ refresh = false } = {}) {
  if (!refresh && cachedUserDenylist) return cachedUserDenylist;

  const configPath = join(getMemoryRoot(), 'config', 'skill-denylist.json');
  if (!existsSync(configPath)) {
    cachedUserDenylist = new Set();
    return cachedUserDenylist;
  }

  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf8'));
    const slugs = Array.isArray(parsed.slugs) ? parsed.slugs : [];
    cachedUserDenylist = new Set(slugs.map((s) => String(s).trim()).filter(Boolean));
  } catch {
    cachedUserDenylist = new Set();
  }
  return cachedUserDenylist;
}

/** 所有固定 + 使用者 denylist slug */
export function getExcludedSlugList() {
  return [...new Set([
    ...LEGACY_SKILL_SLUGS,
    ...PLUGIN_INFRA_SKILL_SLUGS,
    ...loadUserDenylist(),
  ])];
}

export function isExcludedSkill(slug, description = '') {
  const normalized = String(slug || '').trim();
  if (!normalized) return true;
  if (LEGACY_SKILL_SLUGS.has(normalized)) return true;
  if (PLUGIN_INFRA_SKILL_SLUGS.has(normalized)) return true;
  if (normalized.startsWith('omc-')) return true;
  if (loadUserDenylist().has(normalized)) return true;
  if (isOmxPluginSkill(description)) return true;
  return false;
}

export function shouldSkipSkillDirectoryName(name) {
  return name === '_deprecated' || name === '.foundry';
}

/** 掃描 skills root 時略過的路徑 */
export function shouldSkipSkillScanPath(dirPath) {
  const normalized = String(dirPath || '');
  return DEPRECATED_PATH_RE.test(normalized)
    || FOUNDRY_META_RE.test(normalized)
    || PLUGIN_PATH_RE.test(normalized)
    || PLUGIN_CACHE_RE.test(normalized);
}

/** @deprecated 使用 getExcludedSlugList */
export function legacySkillSlugList() {
  return [...LEGACY_SKILL_SLUGS];
}
