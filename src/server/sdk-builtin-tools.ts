/**
 * MyAgents' product-owned Claude Agent SDK builtin catalog.
 *
 * This is deliberately separate from permission policy: exposing a tool to the
 * model does not auto-approve it. Keeping an explicit catalog also prevents a
 * Claude Code patch from silently adding a new builtin with no MyAgents owner.
 */
export const SDK_BUILTIN_TOOLS = [
  'Read',
  'Write',
  'Edit',
  'MultiEdit',
  'NotebookEdit',
  'Glob',
  'Grep',
  'Bash',
  'PowerShell',
  'WebFetch',
  'WebSearch',
  'AskUserQuestion',
  'EnterPlanMode',
  'ExitPlanMode',
  'Skill',
  'Agent',
  'Task',
  'TaskStop',
  'SendMessage',
  'TaskCreate',
  'TaskGet',
  'TaskList',
  'TaskUpdate',
  'Monitor',
  'ReportFindings',
  'Workflow',
  'ScheduleWakeup',
  'EnterWorktree',
  'ExitWorktree',
] as const;

export const SDK_EXCLUDED_BUILTIN_TOOLS = [
  'CronCreate',
  'CronDelete',
  'CronList',
  'PushNotification',
  'DesignSync',
] as const;

/**
 * Session-visible builtin tools for one SDK query.
 *
 * WebSearch executes as an Anthropic Messages server-side tool. Through the
 * OpenAI-protocol bridge (or any non-Claude third-party endpoint) the nested
 * search call comes back as fabricated tool-call markers instead of results,
 * so the model retries, fails again and burns the turn. Hide it on those
 * runtimes and let MCP search servers (e.g. tavily-search-rotating) own web
 * search; the official Anthropic API and Claude-behind-a-proxy keep it.
 */
export function resolveSdkSessionTools(webSearchSupported: boolean): string[] {
  const tools = [...SDK_BUILTIN_TOOLS];
  if (!webSearchSupported) {
    tools.splice(tools.indexOf('WebSearch'), 1);
  }
  return tools;
}
