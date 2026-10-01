import { isLearningWorkspaceProject, type Project } from './config-types';

/** Resolve the workspace for an AI discussion turn.
 *
 * Explicit `workspaceId` always wins. Learning-mode discussions use the
 * explicitly selected learning workspace, or the only learning workspace
 * when there is exactly one. Multiple workspaces without a selection are
 * ambiguous and return null; when none exists, legacy callers retain the
 * existing first-project fallback.
 */
export function resolveDiscussionWorkspace(
  projects: Project[],
  options: { workspaceId?: string; learningMode?: boolean; activeLearningWorkspaceId?: string } = {},
): Project | null {
  if (options.workspaceId) {
    const byId = projects.find((p) => p.id === options.workspaceId);
    if (byId) return byId;
    if (options.learningMode) return null;
  }
  if (options.learningMode) {
    const learning = projects.filter(isLearningWorkspaceProject);
    const selected = learning.find((project) => project.id === options.activeLearningWorkspaceId);
    if (selected) return selected;
    if (learning.length === 1) return learning[0];
    if (learning.length > 1) {
      console.warn('[discussion] Multiple learning workspaces exist without an active selection');
      return null;
    }
    console.warn('[discussion] No learning workspace is available');
  }
  return projects[0] ?? null;
}
