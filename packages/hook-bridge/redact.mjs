import { isDeniedPath } from './security.mjs';

const SECRET_PATTERNS = [
  [/sk-[a-zA-Z0-9]{20,}/g, 'sk-[REDACTED]'],
  [/ghp_[a-zA-Z0-9]{20,}/g, 'ghp_[REDACTED]'],
  [/gho_[a-zA-Z0-9]{20,}/g, 'gho_[REDACTED]'],
  [/xox[baprs]-[a-zA-Z0-9-]{10,}/g, 'xox[REDACTED]'],
  [/AKIA[0-9A-Z]{16}/g, 'AKIA[REDACTED]'],
  [/Bearer\s+[a-zA-Z0-9._-]+/gi, 'Bearer [REDACTED]'],
  [/api[_-]?key\s*[:=]\s*['"]?[a-zA-Z0-9._-]{8,}/gi, 'api_key=[REDACTED]'],
];

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
