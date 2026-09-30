import { isLearningWorkspaceProject, type Project } from './config-types';

/** Resolve the workspace for an AI discussion turn.
 *
 * Explicit `workspaceId` always wins. Learning-mode discussions (card
 * coaching) land in the first learning workspace so the coach contract,
 * cards, and learning state are live context. Otherwise the first visible
 * project. Returns null only when the list is empty.
 */
export function resolveDiscussionWorkspace(
  projects: Project[],
  options: { workspaceId?: string; learningMode?: boolean } = {},
): Project | null {
  if (options.workspaceId) {
    const byId = projects.find((p) => p.id === options.workspaceId);
    if (byId) return byId;
  }
  if (options.learningMode) {
    const learning = projects.find(isLearningWorkspaceProject);
    if (learning) return learning;
    console.warn('[discussion] No learning workspace; falling back to the first project');
  }
  return projects[0] ?? null;
}
