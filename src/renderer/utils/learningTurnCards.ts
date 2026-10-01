import type { Message } from '@/types/chat';
import { LEARNING_CARD_PATH_RE } from '@/components/task-center/learningWorkspace';
import { deriveTurnFileEdits } from './turnFileEdits';
import { resolveWorkspaceFileLinkTarget } from './workspaceFileLinks';

/** Only this turn's completed edits or explicit references, never all cards. */
export function learningCardPathsForTurn(content: Message['content'], workspacePath: string): string[] {
  const paths = new Set<string>();
  const add = (path: string) => {
    const parts = path.split('/');
    if (parts.length === 2 && parts[0] === 'cards' && LEARNING_CARD_PATH_RE.test(parts[1])) paths.add(path);
  };
  for (const file of deriveTurnFileEdits(content, workspacePath)?.files ?? []) {
    if (file.status !== 'deleted' && file.actionTarget.scope === 'workspace') add(file.actionTarget.path);
  }
  const text = typeof content === 'string' ? content : content.filter(block => block.type === 'text').map(block => block.text ?? '').join('\n');
  // File references also cover cards written with Bash / external runtimes.
  for (const match of text.matchAll(/`([^`\n]+)`|\[[^\]\n]*\]\(([^)\n]+)\)/g)) {
    const target = resolveWorkspaceFileLinkTarget(match[1] ?? match[2], workspacePath);
    if (target) add(target.path);
  }
  return [...paths];
}
