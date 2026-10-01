// Learning workspace data layer — the Task Center learning panel's file-backed
// replacement for localStorage state. Authority rules (see workspace
// CLAUDE.md contract): the agent owns card content; the UI owns ONLY the
// `status` / `feedback` frontmatter fields and must write them via
// saveFile({ expectedContent }) CAS so a concurrent agent rewrite cannot be
// blindly clobbered.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useConfig } from '@/hooks/useConfig';
import { useWorkspaceChangeSignal } from '@/hooks/useWorkspaceChangeSignal';
import { useWorkspaceFileService } from '@/hooks/useWorkspaceFileService';
import { isLearningWorkspaceProject, type Project } from '@/../shared/config-types';
import type { LearningCard } from './learningCards';

/** cards/YYYY-MM-DD-<slug>.md — date-prefixed so filename sort ≈ recency. */
export const LEARNING_CARD_PATH_RE = /^(\d{4}-\d{2}-\d{2})-[a-z0-9-]+\.md$/;

/** Newest cards kept in the panel; the full history stays on disk for the agent. */
export const LEARNING_CARD_LIST_LIMIT = 60;

export interface WorkspaceLearningCard extends LearningCard {
  /** Workspace-relative path, e.g. `cards/2026-01-02-pm-friction.md`. */
  filePath: string;
  date: string;
  status: 'new' | 'learned';
  feedback: 'useful' | 'skip' | null;
  /** Workspace-relative links to topics / other cards (agent-maintained). */
  related: string[];
  /** Raw file content — the CAS baseline for UI field patches. */
  raw: string;
}

function parseRelatedList(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed || trimmed === '[]') return [];
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed
      .slice(1, -1)
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [trimmed].filter(Boolean);
}

function sectionAfter(body: string, heading: string): string {
  const index = body.indexOf(heading);
  if (index === -1) return '';
  const rest = body.slice(index + heading.length);
  const nextHeading = rest.search(/^## /m);
  return (nextHeading === -1 ? rest : rest.slice(0, nextHeading)).trim();
}

/** Parse one card markdown file. Returns null for files that do not carry the
 *  expected frontmatter shape (stray .md files in cards/ are ignored). */
export function parseLearningCardMarkdown(
  md: string,
  filePath: string,
): WorkspaceLearningCard | null {
  const name = filePath.split('/').at(-1) ?? filePath;
  const match = LEARNING_CARD_PATH_RE.exec(name);
  if (!match) return null;

  const lines = md.split('\n');
  if (lines[0]?.trim() !== '---') return null;
  const closing = lines.indexOf('---', 1);
  if (closing === -1) return null;

  const fields = new Map<string, string>();
  for (const line of lines.slice(1, closing)) {
    const sep = line.indexOf(':');
    if (sep <= 0) continue;
    const key = line.slice(0, sep).trim();
    if (!key) continue;
    fields.set(key, line.slice(sep + 1).trim());
  }

  const title = fields.get('title');
  if (!title) return null;

  const body = lines.slice(closing + 1).join('\n').trim();
  const firstParagraphEnd = body.indexOf('## ');
  const intro = firstParagraphEnd === -1 ? body : body.slice(0, firstParagraphEnd);
  const introText = intro.replace(/^#+[^\n]*\n/, '').trim();

  const status = fields.get('status') === 'learned' ? 'learned' : 'new';
  const feedbackRaw = fields.get('feedback');
  const feedback = feedbackRaw === 'useful' || feedbackRaw === 'skip' ? feedbackRaw : null;

  return {
    id: fields.get('id') || name.replace(/\.md$/, ''),
    category: fields.get('category') || '学习',
    time: fields.get('time') || '5 分钟',
    title,
    body: introText,
    action: sectionAfter(body, '## 今天的小行动'),
    prompt: sectionAfter(body, '## 引导提问'),
    sourceLabel: undefined,
    sourcePath: undefined,
    sourceUrl: fields.get('source_url') || undefined,
    filePath,
    date: match[1],
    status,
    feedback,
    related: parseRelatedList(fields.get('related') ?? ''),
    raw: md,
  };
}

/** Rewrite ONLY the UI-owned frontmatter fields, preserving every other byte
 *  (agent fields, body, formatting) for the CAS comparison. */
export function applyCardUiPatch(
  raw: string,
  patch: { status?: 'new' | 'learned'; feedback?: 'useful' | 'skip' | null },
): string {
  const lines = raw.split('\n');
  if (lines[0]?.trim() !== '---') return raw;
  const closing = lines.indexOf('---', 1);
  if (closing === -1) return raw;

  const replacements: Array<[key: string, value: string]> = [];
  if (patch.status !== undefined) replacements.push(['status', patch.status]);
  if (patch.feedback !== undefined) replacements.push(['feedback', patch.feedback ?? '']);

  const next = [...lines];
  for (const [key, value] of replacements) {
    // Empty value keeps the template's bare `key:` spelling (no trailing
    // space) so reverting a patch round-trips byte-for-byte.
    const rendered = value === '' ? `${key}:` : `${key}: ${value}`;
    const pattern = new RegExp(`^${key}:`);
    const index = next.findIndex((line, i) => i > 0 && i < closing && pattern.test(line));
    if (index === -1) {
      next.splice(closing, 0, rendered);
    } else {
      next[index] = rendered;
    }
  }
  return next.join('\n');
}

/** UTF-8 safe base64 for importBase64Files payloads. */
export function encodeTextBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** Resolve the active workspace by its app-owned project ID. A single existing
 *  learning workspace remains the implicit choice for backward compatibility;
 *  multiple workspaces require explicit selection. */
export function useLearningWorkspace(): {
  project: Project | null;
  path: string | null;
  projects: Project[];
  requiresSelection: boolean;
  select: (projectId: string) => Promise<void>;
} {
  const { projects, config, updateConfig } = useConfig();
  const learningProjects = useMemo(
    () => projects.filter(isLearningWorkspaceProject),
    [projects],
  );
  const project = useMemo(() => {
    const selected = learningProjects.find((candidate) => candidate.id === config.activeLearningWorkspaceId);
    if (selected) return selected;
    return learningProjects.length === 1 ? learningProjects[0] : null;
  }, [config.activeLearningWorkspaceId, learningProjects]);
  const select = useCallback(async (projectId: string) => {
    if (!learningProjects.some((candidate) => candidate.id === projectId)) return;
    try {
      await updateConfig({ activeLearningWorkspaceId: projectId });
    } catch (error) {
      console.warn('[learningWorkspace] Failed to save active workspace selection:', error);
    }
  }, [learningProjects, updateConfig]);
  return {
    project,
    path: project?.path ?? null,
    projects: learningProjects,
    requiresSelection: learningProjects.length > 1 && !project,
    select,
  };
}

/** Local mirror of the tree node shape from useWorkspaceFileService (its
 *  internal interfaces are not exported). */
interface TreeLikeNode {
  name: string;
  type: 'file' | 'dir';
  path: string;
  children?: TreeLikeNode[];
  loaded?: boolean;
}

function findDir(node: TreeLikeNode, name: string): TreeLikeNode | undefined {
  return node.children?.find((child) => child.type === 'dir' && child.name === name);
}

export interface LearningCardsState {
  cards: WorkspaceLearningCard[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  fileService: ReturnType<typeof useWorkspaceFileService>;
}

/** Cap for the "recently updated by AI" hint. */
export const LEARNING_RECENT_CHANGES_LIMIT = 5;

/** Workspace-relative .md paths changed while the panel is active, newest
 *  first — the lightweight "AI 不偷偷改文件" disclosure. The caller filters
 *  out its own UI writes (they arrive on the same watcher channel). */
export function useLearningRecentChanges(
  workspacePath: string | null,
  isActive: boolean,
): string[] {
  const [snapshot, setSnapshot] = useState<{ workspacePath: string | null; paths: string[] }>(
    () => ({ workspacePath, paths: [] }),
  );
  useWorkspaceChangeSignal(
    workspacePath,
    isActive,
    undefined,
    useCallback((changed: string[]) => {
      const markdown = changed.filter((path) => path.toLowerCase().endsWith('.md'));
      if (markdown.length === 0) return;
      setSnapshot((previous) => {
        const previousPaths = previous.workspacePath === workspacePath ? previous.paths : [];
        const merged = [...markdown.slice().reverse(), ...previousPaths];
        return {
          workspacePath,
          paths: [...new Set(merged)].slice(0, LEARNING_RECENT_CHANGES_LIMIT),
        };
      });
    }, [workspacePath]),
  );
  return snapshot.workspacePath === workspacePath ? snapshot.paths : [];
}

/** List learning cards from `<learning workspace>/cards/`, refreshed on
 *  workspace fs changes while the panel is active. */
export function useLearningCards(
  workspacePath: string | null,
  isActive: boolean,
): LearningCardsState {
  const fileService = useWorkspaceFileService(workspacePath);
  const changeSignal = useWorkspaceChangeSignal(workspacePath, isActive);
  const [snapshot, setSnapshot] = useState<{
    workspacePath: string | null;
    cards: WorkspaceLearningCard[];
    loading: boolean;
    error: string | null;
  }>(() => ({ workspacePath, cards: [], loading: false, error: null }));
  const requestGenerationRef = useRef(0);

  const refresh = useCallback(async () => {
    const requestGeneration = ++requestGenerationRef.current;
    if (!workspacePath || !fileService.isAvailable) {
      setSnapshot({ workspacePath, cards: [], loading: false, error: null });
      return;
    }
    try {
      const tree = await fileService.dirTree();
      if (requestGeneration === requestGenerationRef.current) {
        setSnapshot((previous) => ({
          workspacePath,
          cards: previous.workspacePath === workspacePath ? previous.cards : [],
          loading: true,
          error: null,
        }));
      }
      const cardsNode = findDir(tree.tree as TreeLikeNode, 'cards');
      let children: TreeLikeNode[] = cardsNode?.children ?? [];
      if (cardsNode && cardsNode.loaded === false) {
        const expanded = await fileService.dirExpand({ path: cardsNode.path });
        children = expanded.children as TreeLikeNode[];
      }
      const files = children
        .filter((child) => child.type === 'file' && LEARNING_CARD_PATH_RE.test(child.name))
        .sort((a, b) => b.name.localeCompare(a.name))
        .slice(0, LEARNING_CARD_LIST_LIMIT);
      const parsed = await Promise.all(
        files.map(async (file) => {
          try {
            const preview = await fileService.readPreview({ path: file.path });
            return parseLearningCardMarkdown(preview.content, file.path);
          } catch {
            return null;
          }
        }),
      );
      if (requestGeneration === requestGenerationRef.current) {
        setSnapshot({
          workspacePath,
          cards: parsed.filter((card): card is WorkspaceLearningCard => card !== null),
          loading: false,
          error: null,
        });
      }
    } catch (err) {
      if (requestGeneration === requestGenerationRef.current) {
        console.warn('[learningWorkspace] Failed to list cards:', err);
        setSnapshot({
          workspacePath,
          cards: [],
          loading: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }, [fileService, workspacePath]);

  useEffect(() => {
    if (!isActive || !workspacePath || !fileService.isAvailable) return;
    const timer = window.setTimeout(() => { void refresh(); }, 0);
    return () => window.clearTimeout(timer);
  }, [changeSignal, fileService.isAvailable, isActive, refresh, workspacePath]);

  const current = snapshot.workspacePath === workspacePath
    ? snapshot
    : { workspacePath, cards: [], loading: Boolean(workspacePath && isActive), error: null };
  return { ...current, refresh, fileService };
}
