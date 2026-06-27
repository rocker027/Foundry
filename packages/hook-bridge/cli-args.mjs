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
