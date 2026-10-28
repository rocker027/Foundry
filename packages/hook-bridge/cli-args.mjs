/** 解析 foundry fix 子命令參數 */
export function parseFixArgs(args) {
  const sessionIdx = args.indexOf('--from-session');
  const sessionId = sessionIdx >= 0 ? args[sessionIdx + 1] : null;
  const slug = args.find((a, i) => !a.startsWith('--')
    && (sessionIdx < 0 || i !== sessionIdx + 1));
  return { slug: slug ?? null, sessionId: sessionId ?? null };
}

/** 解析 foundry derive 子命令參數 */
export function parseDeriveArgs(args) {
  const sessionIdx = args.indexOf('--from-session');
  const variantIdx = args.indexOf('--variant');
  const sessionId = sessionIdx >= 0 ? args[sessionIdx + 1] : null;
  const variant = variantIdx >= 0 ? args[variantIdx + 1] : null;
  const parentSlug = args.find((a, i) => !a.startsWith('--')
    && (sessionIdx < 0 || i !== sessionIdx + 1)
    && (variantIdx < 0 || i !== variantIdx + 1));
  return { parentSlug: parentSlug ?? null, sessionId: sessionId ?? null, variant };
}

/** 解析 foundry audit 子命令 */
export function parseAuditArgs(args) {
  const sub = args[0];
  return { subcommand: sub ?? null, rest: sub ? args.slice(1) : args };
}

/** 解析 foundry deprecate-legacy 旗標 */
export function parseDeprecateLegacyArgs(args) {
  const dryRun = !args.includes('--execute');
  const execute = args.includes('--execute');
  return { dryRun, execute };
}

/** 收集旗標值，避免 indexOf(-1) 誤判 */
function collectFlagValues(args, flags) {
  const excluded = new Set();
  for (const flag of flags) {
    const idx = args.indexOf(flag);
    if (idx >= 0 && args[idx + 1] && !args[idx + 1].startsWith('--')) {
      excluded.add(args[idx + 1]);
    }
  }
  return excluded;
}

/** 解析 foundry diff 子命令參數 */
export function parseDiffArgs(args) {
  const fromIdx = args.indexOf('--from');
  const toIdx = args.indexOf('--to');
  const fromVersion = fromIdx >= 0 ? args[fromIdx + 1] : null;
  const toVersion = toIdx >= 0 ? args[toIdx + 1] : null;
  const excluded = collectFlagValues(args, ['--from', '--to']);
  const slug = args.find((a) => !a.startsWith('--') && !excluded.has(a));
  return { slug: slug ?? null, fromVersion, toVersion };
}

/** 解析 foundry rollback 子命令參數 */
export function parseRollbackArgs(args) {
  const toIdx = args.indexOf('--to');
  const toLabel = toIdx >= 0 ? args[toIdx + 1] : null;
  const excluded = collectFlagValues(args, ['--to']);
  const slug = args.find((a) => !a.startsWith('--') && !excluded.has(a));
  const force = args.includes('--force');
  return { slug: slug ?? null, toLabel: toLabel ?? null, force };
}

/** 解析 foundry apply / promote 子命令參數 */
export function parseApplyArgs(args) {
  const typeIdx = args.indexOf('--type');
  const draftIdx = args.indexOf('--draft');
  const parentIdx = args.indexOf('--parent');
  const type = typeIdx >= 0 ? args[typeIdx + 1] : 'CAPTURED';
  const draftSlug = draftIdx >= 0 ? args[draftIdx + 1] : null;
  const parentSlug = parentIdx >= 0 ? args[parentIdx + 1] : null;
  const excluded = collectFlagValues(args, ['--type', '--draft', '--parent']);
  const slug = args.find((a) => !a.startsWith('--') && !excluded.has(a));
  const force = args.includes('--force');
  return { slug: slug ?? null, type, draftSlug, parentSlug, force };
}
