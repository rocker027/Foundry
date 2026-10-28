import { isDeniedPath } from './security.mjs';

export const SECRET_PATTERNS = [
  [/sk-ant-[a-zA-Z0-9_-]{20,}/g, 'sk-ant-[REDACTED]'],
  [/sk-[a-zA-Z0-9]{20,}/g, 'sk-[REDACTED]'],
  [/ghp_[a-zA-Z0-9]{20,}/g, 'ghp_[REDACTED]'],
  [/gho_[a-zA-Z0-9]{20,}/g, 'gho_[REDACTED]'],
  [/github_pat_[a-zA-Z0-9_]{20,}/g, 'github_pat_[REDACTED]'],
  [/ghs_[a-zA-Z0-9]{20,}/g, 'ghs_[REDACTED]'],
  [/glpat-[a-zA-Z0-9_-]{20,}/g, 'glpat-[REDACTED]'],
  [/AIza[0-9A-Za-z_-]{35}/g, 'AIza[REDACTED]'],
  [/xox[baprs]-[a-zA-Z0-9-]{10,}/g, 'xox[REDACTED]'],
  [/AKIA[0-9A-Z]{16}/g, 'AKIA[REDACTED]'],
  [/Bearer\s+[a-zA-Z0-9._-]+/gi, 'Bearer [REDACTED]'],
  [/api[_-]?key\s*[:=]\s*['"]?[a-zA-Z0-9._-]{8,}/gi, 'api_key=[REDACTED]'],
  [/(?:password|secret|token)\s*[:=]\s*['"]?[a-zA-Z0-9._-]{8,}/gi, '[REDACTED CREDENTIAL]'],
  [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g, '[REDACTED PEM]'],
];

/** 供 archive 等模組使用的未脫敏偵測 pattern */
export function getRawSecretPatterns() {
  return SECRET_PATTERNS.map(([re]) => re);
}

export function redactString(value) {
  if (typeof value !== 'string') return value;
  let out = value;
  for (const [re, replacement] of SECRET_PATTERNS) {
    out = out.replace(re, replacement);
  }
  return out;
}

export function redactValue(value) {
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (isDeniedPath(k)) continue;
      out[k] = redactValue(v);
    }
    return out;
  }
  return value;
}

export function sanitizePayload(payload) {
  const cleaned = redactValue(payload ?? {});
  if (cleaned.files && Array.isArray(cleaned.files)) {
    cleaned.files = cleaned.files.filter((f) => !isDeniedPath(f));
  }
  if (cleaned.command && typeof cleaned.command === 'string') {
    cleaned.command = redactString(cleaned.command);
  }
  return cleaned;
}
