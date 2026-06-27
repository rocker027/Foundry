import { basename, normalize, resolve, sep } from 'node:path';

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

const DENY_PATTERNS = [
  /^\.env(\.|$)/i,
  /^\.env\./i,
  /credentials/i,
  /secrets?\//i,
  /\.pem$/i,
  /\.key$/i,
  /id_rsa/i,
  /\.p12$/i,
  /token\.json$/i,
];

const DANGEROUS_SKILL_PATTERNS = [
  /\bcurl\s+.*\|\s*(ba)?sh\b/i,
  /\bwget\s+.*\|\s*(ba)?sh\b/i,
  /\bbash\s+-c\s+['"]?\s*curl/i,
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /disregard\s+(all\s+)?prior\s+instructions/i,
  /you\s+are\s+now\s+(in\s+)?(DAN|jailbreak)/i,
];

/** 驗證 slug 格式，防止路徑穿越 */
export function validateSlug(slug) {
  if (!slug || typeof slug !== 'string' || !SLUG_PATTERN.test(slug)) {
    throw new Error(`Invalid slug: ${slug}`);
  }
  return slug;
}

/** 斷言子路徑在根目錄內（resolve 後前綴檢查） */
export function assertPathWithinRoot(childPath, rootPath) {
  const resolvedChild = resolve(childPath);
  const resolvedRoot = resolve(rootPath);
  const rootPrefix = resolvedRoot.endsWith(sep) ? resolvedRoot : `${resolvedRoot}${sep}`;
  if (resolvedChild !== resolvedRoot && !resolvedChild.startsWith(rootPrefix)) {
    throw new Error(`Path escapes root: ${childPath}`);
  }
}

export function isDeniedPath(filePath) {
  if (!filePath || typeof filePath !== 'string') return false;
  const name = basename(normalize(filePath));
  return DENY_PATTERNS.some((re) => re.test(name) || re.test(filePath));
}

export function filterAllowedPaths(paths) {
  if (!Array.isArray(paths)) return [];
  return paths.filter((p) => !isDeniedPath(p));
}

export function scanSkillContent(content) {
  const issues = [];
  if (typeof content !== 'string') return issues;
  for (const re of DANGEROUS_SKILL_PATTERNS) {
    if (re.test(content)) {
      issues.push(`Matched dangerous pattern: ${re.source}`);
    }
  }
  return issues;
}

export function assertWritableTarget(targetPath, allowedRoots) {
  const resolved = normalize(targetPath);
  const allowed = allowedRoots.some((root) => {
    const r = normalize(root);
    return resolved === r || resolved.startsWith(`${r}/`);
  });
  if (!allowed) {
    throw new Error(`Write target not allowed: ${targetPath}`);
  }
}
