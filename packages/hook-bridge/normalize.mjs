/** 正規化事件類型 */
export const NORMALIZED_EVENTS = ['before_task', 'after_edit', 'after_command', 'after_task'];

const CURSOR_MAP = {
  beforeSubmitPrompt: 'before_task',
  afterFileEdit: 'after_edit',
  afterShellExecution: 'after_command',
  stop: 'after_task',
  postToolUseFailure: 'after_command',
  preCompact: 'before_task',
};

const CODEX_MAP = {
  UserPromptSubmit: 'before_task',
  SessionStart: 'before_task',
  PostToolUse: 'after_edit',
  Stop: 'after_task',
};

const CLAUDE_MAP = {
  PreToolUse: 'before_task',
  PostToolUse: 'after_edit',
  Stop: 'after_task',
  SessionStart: 'before_task',
};

function asString(v) {
  return typeof v === 'string' ? v : '';
}

/** 從 payload 提取 session id */
export function extractSessionId(payload) {
  return asString(
    payload.session_id
    || payload.sessionId
    || payload.conversation_id
    || payload.conversationId
    || payload.chat_id,
  ).trim() || crypto.randomUUID();
}

/** 提取項目根目錄 */
export function extractProjectRoot(payload) {
  return asString(
    payload.project_root
    || payload.projectRoot
    || payload.workspace_roots?.[0]
    || payload.workspace_root
    || payload.cwd
    || process.cwd(),
  ).trim();
}

/** 提取工具名 */
export function extractToolName(payload, tool) {
  return asString(payload.tool_name || payload.toolName || payload.name || tool).trim();
}

/** Cursor hook 名稱對應 */
export function normalizeCursorEvent(hookName, payload) {
  const event = CURSOR_MAP[hookName];
  if (!event) return null;
  return buildNormalizedEvent({
    event,
    tool: 'cursor',
    payload,
    hookName,
  });
}

/** Codex hook 對應 */
export function normalizeCodexEvent(hookName, payload) {
  let event = CODEX_MAP[hookName];
  if (hookName === 'PostToolUse') {
    const toolName = asString(payload.tool_name || payload.toolName).toLowerCase();
    if (toolName.includes('shell') || toolName.includes('bash') || toolName.includes('exec')) {
      event = 'after_command';
    } else {
      event = 'after_edit';
    }
  }
  if (!event) return null;
  return buildNormalizedEvent({
    event,
    tool: 'codex',
    payload,
    hookName,
  });
}

/** Claude Code hook 對應 */
export function normalizeClaudeEvent(hookName, payload) {
  let event = CLAUDE_MAP[hookName];
  if (hookName === 'PostToolUse') {
    const toolName = asString(payload.tool_name || payload.toolName).toLowerCase();
    if (toolName === 'bash' || toolName.includes('shell')) {
      event = 'after_command';
    } else if (['edit', 'write', 'multiedit', 'notebookedit'].some((t) => toolName.includes(t))) {
      event = 'after_edit';
    }
  }
  if (!event) return null;
  return buildNormalizedEvent({
    event,
    tool: 'claude',
    payload,
    hookName,
  });
}

function buildNormalizedEvent({ event, tool, payload, hookName }) {
  const sessionId = extractSessionId(payload);
  const projectRoot = extractProjectRoot(payload);
  const files = extractFiles(payload);
  const command = asString(payload.command || payload.shell_command || payload.shellCommand);
  const exitCode = payload.exit_code ?? payload.exitCode ?? null;
  const toolName = extractToolName(payload, hookName);

  return {
    v: 1,
    ts: new Date().toISOString(),
    event,
    tool,
    session_id: sessionId,
    project_root: projectRoot,
    payload: {
      files,
      tool_name: toolName,
      command: command || undefined,
      exit_code: exitCode,
      prompt: asString(payload.prompt || payload.user_prompt).slice(0, 500) || undefined,
      hook_name: hookName,
      status: payload.status,
      generation_id: payload.generation_id || payload.generationId,
    },
    redacted: true,
  };
}

function extractFiles(payload) {
  const paths = [];
  if (Array.isArray(payload.files)) paths.push(...payload.files);
  if (Array.isArray(payload.file_paths)) paths.push(...payload.file_paths);
  if (payload.file_path) paths.push(payload.file_path);
  if (payload.path) paths.push(payload.path);
  if (payload.edits && Array.isArray(payload.edits)) {
    for (const e of payload.edits) {
      if (e.path) paths.push(e.path);
    }
  }
  return [...new Set(paths.filter(Boolean))];
}
