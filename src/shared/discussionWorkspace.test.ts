import { describe, expect, it, vi } from 'vitest';
import { resolveDiscussionWorkspace } from './discussionWorkspace';
import type { Project } from './config-types';

function project(id: string, overrides: Partial<Project> = {}): Project {
  return {
    id,
    name: id,
    path: `/tmp/${id}`,
    providerId: null,
    permissionMode: null,
    ...overrides,
  } as Project;
}

describe('resolveDiscussionWorkspace', () => {
  it('prefers the explicit workspace id', () => {
    const a = project('a');
    const b = project('b');
    expect(resolveDiscussionWorkspace([a, b], { workspaceId: 'b' })).toBe(b);
    expect(resolveDiscussionWorkspace([a, b], {})).toBe(a);
    // Unknown id falls through rather than hard-failing.
    expect(resolveDiscussionWorkspace([a, b], { workspaceId: 'zz' })).toBe(a);
  });

  it('routes learning-mode discussions into the learning workspace', () => {
    const ordinary = project('ordinary');
    const learning = project('learning', { templateId: 'learning' });
    expect(resolveDiscussionWorkspace([ordinary, learning], { learningMode: true })).toBe(learning);
    // Explicit id still wins over the learning default.
    expect(resolveDiscussionWorkspace([ordinary, learning], { workspaceId: 'ordinary', learningMode: true })).toBe(ordinary);
  });

  it('falls back to the first project when the learning workspace is missing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ordinary = project('ordinary');
    expect(resolveDiscussionWorkspace([ordinary], { learningMode: true })).toBe(ordinary);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('returns null for an empty project list', () => {
    expect(resolveDiscussionWorkspace([], {})).toBeNull();
  });
});
