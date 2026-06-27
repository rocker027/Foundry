/** 判斷 session 是否成功（失敗 session 不進 extract/evolve queue） */
export function evaluateSessionSuccess(events) {
  if (!events || events.length === 0) {
    return { success: false, reason: 'no_events' };
  }

  const hasAfterTask = events.some((e) => e.event === 'after_task');
  if (!hasAfterTask) {
    return { success: false, reason: 'no_after_task' };
  }

  const failedCommands = events.filter((e) => {
    if (e.event !== 'after_command') return false;
    const exitCode = e.payload?.exit_code ?? e.payload?.exitCode;
    if (exitCode == null) return false;
    return Number(exitCode) !== 0;
  });
  if (failedCommands.length > 0) {
    return { success: false, reason: 'command_failed', count: failedCommands.length };
  }

  const toolFailures = events.filter((e) => {
    const hook = e.payload?.hook_name || '';
    if (hook === 'postToolUseFailure') return true;
    const status = String(e.payload?.status || '').toLowerCase();
    return status === 'failed' || status === 'error';
  });
  if (toolFailures.length > 0) {
    return { success: false, reason: 'tool_failure', count: toolFailures.length };
  }

  const edits = events.filter((e) => e.event === 'after_edit');
  const commands = events.filter((e) => e.event === 'after_command');
  if (edits.length === 0 && commands.length === 0 && events.length < 3) {
    return { success: false, reason: 'trivial_session' };
  }

  return { success: true };
}

/** 是否應跳過萃取佇列 */
export function shouldSkipExtractQueue(events) {
  return !evaluateSessionSuccess(events).success;
}
