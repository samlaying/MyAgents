import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '@/i18n';
import TaskCenter from './TaskCenter';
import { parseLearningCardMarkdown } from '@/components/task-center/learningWorkspace';

const taskMocks = vi.hoisted(() => ({ get: vi.fn() }));
const learningMocks = vi.hoisted(() => ({
  cards: [] as unknown[],
  path: '/tmp/projects/learning' as string | null,
  projects: [] as unknown[],
  recentChanges: [] as string[],
  saveFile: vi.fn(),
  readPreview: vi.fn(),
  refresh: vi.fn().mockResolvedValue(undefined),
  openWithDefault: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/components/task-center/ThoughtPanel', () => ({ ThoughtPanel: () => null }));
vi.mock('@/components/task-center/TaskListPanel', () => ({ TaskListPanel: () => null }));
vi.mock('@/components/task-center/RecordingSourceDialog', () => ({ default: () => null }));
vi.mock('@/api/taskCenter', () => ({ taskCenterAvailable: () => true, taskGet: taskMocks.get }));
vi.mock('@/hooks/useConfig', () => ({
  useConfig: () => ({
    config: { defaultWorkspacePath: '/tmp/default-workspace' },
    projects: learningMocks.projects,
    updateConfig: vi.fn(),
    refreshConfig: vi.fn(),
  }),
}));
vi.mock('@/config/services/appConfigService', () => ({
  ensureLearningWorkspace: vi.fn().mockResolvedValue(true),
}));
vi.mock('@/analytics', () => ({ track: vi.fn() }));
vi.mock('@/components/task-center/learningWorkspace', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/task-center/learningWorkspace')>();
  return {
    ...actual,
    useLearningWorkspace: () => ({ project: learningMocks.path ? { id: 'p-learning', path: learningMocks.path } : null, path: learningMocks.path }),
    useLearningCards: () => ({
      cards: learningMocks.cards,
      loading: false,
      error: null,
      refresh: learningMocks.refresh,
      fileService: {
        isAvailable: true,
        saveFile: learningMocks.saveFile,
        readPreview: learningMocks.readPreview,
        openWithDefault: learningMocks.openWithDefault,
      },
    }),
    useLearningRecentChanges: () => learningMocks.recentChanges,
  };
});

const CARD_RAW = `---
id: 2026-01-02-pm-friction
title: 用户没完成任务，先找摩擦，不要先怪动机
category: 产品经理
time: 5 分钟
date: 2026-01-02
status: new
feedback:
related: []
source: seed
source_url:
---

当用户在关键步骤流失，先检查步骤数、等待时间和信息不确定性。

## 今天的小行动

挑一个你负责的流程，找出可以删掉或提前的一步。

## 引导提问

请用苏格拉底式提问带我学习"用户行为中的行动摩擦"。
`;

function fixtureCard(overrides: Record<string, unknown> = {}) {
  return {
    id: '2026-01-02-pm-friction',
    category: '产品经理',
    time: '5 分钟',
    title: '用户没完成任务，先找摩擦，不要先怪动机',
    body: '当用户在关键步骤流失，先检查步骤数、等待时间和信息不确定性。',
    action: '挑一个你负责的流程，找出可以删掉或提前的一步。',
    prompt: '请用苏格拉底式提问带我学习"用户行为中的行动摩擦"。',
    sourceUrl: undefined,
    filePath: 'cards/2026-01-02-pm-friction.md',
    date: '2026-01-02',
    status: 'new',
    feedback: null,
    related: [],
    raw: CARD_RAW,
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
  taskMocks.get.mockReset();
  learningMocks.cards = [fixtureCard()];
  learningMocks.path = '/tmp/projects/learning';
  learningMocks.projects = [{ id: 'p-learning', path: '/tmp/projects/learning', templateId: 'learning', templateSource: 'builtin' }];
  learningMocks.saveFile.mockReset().mockResolvedValue(undefined);
  learningMocks.readPreview.mockReset();
  learningMocks.recentChanges = [];
  learningMocks.openWithDefault.mockClear();
  learningMocks.refresh.mockClear();
  // Simulate "refresh re-reads the disk truth": the last successful save
  // becomes the new card fixture, so follow-up clicks see persisted state.
  learningMocks.refresh.mockImplementation(async () => {
    const last = learningMocks.saveFile.mock.calls.at(-1);
    if (!last) return;
    const card = parseLearningCardMarkdown(last[0].content, last[0].path);
    if (card) learningMocks.cards = [card];
  });
});
afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

function openLearning() {
  const view = render(<TaskCenter isActive />);
  fireEvent.click(screen.getByRole('tab', { name: '学习' }));
  return view;
}

describe('personal learning cards (workspace-backed)', () => {
  it.each([
    { status: 'todo', active: true },
    { status: 'running', active: true },
    { status: 'verifying', active: true },
    { status: 'blocked', active: true },
    { status: 'stopped', active: false },
    { status: 'done', active: false },
    { status: 'archived', active: false },
    { status: 'deleted', active: false },
    { status: null, active: false },
    { status: 'running', deleted: true, active: false },
  ])('reconciles the saved daily task ($status, active=$active)', async ({ status, active, ...flags }) => {
    localStorage.setItem('myagents.learning.dailyTaskId.v1', 'daily-1');
    taskMocks.get.mockResolvedValue(status ? { executionMode: 'recurring', status, ...flags } : null);
    render(<TaskCenter isActive />);
    await act(async () => { fireEvent.click(screen.getByRole('tab', { name: '学习' })); });

    expect(taskMocks.get).toHaveBeenCalledWith('daily-1');
    if (active) {
      expect(screen.getByText('每日推送任务已创建')).toBeInTheDocument();
      expect(localStorage.getItem('myagents.learning.dailyTaskId.v1')).toBe('daily-1');
    } else {
      expect(screen.getByRole('button', { name: '设置每日 9:00 推送' })).toBeInTheDocument();
      expect(localStorage.getItem('myagents.learning.dailyTaskId.v1')).toBeNull();
    }
  });

  it('rechecks the daily task when returning from the task list after pausing it', async () => {
    localStorage.setItem('myagents.learning.dailyTaskId.v1', 'daily-1');
    taskMocks.get.mockResolvedValue({ executionMode: 'recurring', status: 'todo' });
    render(<TaskCenter isActive />);
    await act(async () => { fireEvent.click(screen.getByRole('tab', { name: '学习' })); });
    fireEvent.click(screen.getByRole('tab', { name: '任务' }));
    taskMocks.get.mockResolvedValue({ executionMode: 'recurring', status: 'stopped' });
    fireEvent.click(screen.getByRole('tab', { name: '学习' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '设置每日 9:00 推送' })).toBeInTheDocument());
  });

  it('enables directory selection when the learning tab mounts the file input', () => {
    const view = openLearning();
    expect(view.container.querySelector('input[type="file"]')).toHaveAttribute('webkitdirectory', '');
  });

  it('marks a card learned through a CAS save of its frontmatter', async () => {
    openLearning();
    fireEvent.click(screen.getByRole('button', { name: '标记学完' }));

    await waitFor(() => expect(learningMocks.saveFile).toHaveBeenCalledTimes(1));
    const [args] = learningMocks.saveFile.mock.calls[0];
    expect(args.path).toBe('cards/2026-01-02-pm-friction.md');
    expect(args.expectedContent).toBe(CARD_RAW);
    expect(args.content).toContain('status: learned');
    expect(args.content).not.toContain('status: new');
    // Body and agent fields survive the surgical patch.
    expect(args.content).toContain('## 引导提问');
    expect(args.content).toContain('title: 用户没完成任务，先找摩擦，不要先怪动机');
  });

  it('saves feedback and can clear it again', async () => {
    openLearning();
    fireEvent.click(screen.getAllByRole('button', { name: '这条有帮助' })[0]);
    await waitFor(() => expect(learningMocks.saveFile).toHaveBeenCalled());
    expect(learningMocks.saveFile.mock.calls[0][0].content).toContain('feedback: useful');

    learningMocks.saveFile.mockClear();
    fireEvent.click(screen.getAllByRole('button', { name: '这条有帮助' })[0]);
    await waitFor(() => expect(learningMocks.saveFile).toHaveBeenCalled());
    expect(learningMocks.saveFile.mock.calls[0][0].content).toContain('feedback:\n');
  });

  it('retries once against the disk truth when the CAS baseline is stale', async () => {
    const rewritten = CARD_RAW.replace('related: []', 'related: [memory/topics/用户行为.md]');
    learningMocks.saveFile.mockRejectedValueOnce(new Error('content mismatch'));
    learningMocks.readPreview.mockResolvedValue({ content: rewritten, name: 'x', size: 1 });
    openLearning();
    fireEvent.click(screen.getByRole('button', { name: '标记学完' }));

    await waitFor(() => expect(learningMocks.saveFile).toHaveBeenCalledTimes(2));
    const [, retryArgs] = learningMocks.saveFile.mock.calls;
    expect(retryArgs[0].expectedContent).toBe(rewritten);
    expect(retryArgs[0].content).toContain('related: [memory/topics/用户行为.md]');
    expect(retryArgs[0].content).toContain('status: learned');
    expect(learningMocks.readPreview).toHaveBeenCalledWith({ path: 'cards/2026-01-02-pm-friction.md' });
  });

  it('shows the missing-workspace state with a recreate action when the preset is absent', () => {
    learningMocks.path = null;
    learningMocks.projects = [];
    render(<TaskCenter isActive />);
    fireEvent.click(screen.getByRole('tab', { name: '学习' }));
    expect(screen.getByText(/学习工作区不可用/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重建学习工作区' })).toBeInTheDocument();
  });

  it('dispatches the daily push pinned to the learning workspace with the contract prompt', () => {
    const events: Array<{ type: string; detail: Record<string, unknown> }> = [];
    const listener = (event: Event) => {
      const custom = event as CustomEvent;
      events.push({ type: custom.type, detail: custom.detail });
    };
    window.addEventListener('open-task-create', listener);
    openLearning();
    fireEvent.click(screen.getByRole('button', { name: '设置每日 9:00 推送' }));
    window.removeEventListener('open-task-create', listener);

    expect(events).toHaveLength(1);
    const detail = events[0].detail as Record<string, unknown>;
    expect(detail.defaultWorkspacePath).toBe('/tmp/projects/learning');
    expect(detail.lockWorkspace).toBe(true);
    expect(detail.learningDailyPush).toBe(true);
    expect(detail.initialCronExpression).toBe('0 9 * * *');
    // Habit-style daily routine must not advertise self-termination to the model.
    expect(detail.initialAiCanExit).toBe(false);
    const prompt = String(detail.prefillTaskMd);
    expect(prompt).toContain('04-LEARNING-STATE');
    // The template keeps topics/ top-level; the prompt must not drift to the old layout.
    expect(prompt).toContain('topics/');
    expect(prompt).not.toContain('memory/topics/');
    expect(prompt).not.toContain('快照');
    expect(prompt).not.toContain('不会自动同步');
  });

  it('dispatches the weekly review as a Sunday recurring task on the learning workspace', () => {
    const events: Array<Record<string, unknown>> = [];
    const listener = (event: Event) => {
      events.push((event as CustomEvent).detail);
    };
    window.addEventListener('open-task-create', listener);
    openLearning();
    fireEvent.click(screen.getByRole('button', { name: '设置每周日 21:30 复盘' }));
    window.removeEventListener('open-task-create', listener);

    expect(events).toHaveLength(1);
    const detail = events[0] as Record<string, unknown>;
    expect(detail.defaultWorkspacePath).toBe('/tmp/projects/learning');
    expect(detail.lockWorkspace).toBe(true);
    expect(detail.learningDailyPush).toBeUndefined();
    expect(detail.initialAiCanExit).toBe(false);
    expect(detail.prefillName).toBe('每周学习复盘');
    expect(detail.initialCronExpression).toBe('30 21 * * 0');
    const prompt = String(detail.prefillTaskMd);
    expect(prompt).toContain('reviews/weekly');
    expect(prompt).toContain('周复盘协议');
  });

  it('surfaces agent file changes in the learning panel and hides its own writes', async () => {
    learningMocks.recentChanges = ['.claude/rules/04-LEARNING-STATE.md', 'topics/用户行为.md'];
    const view = openLearning();
    expect(screen.getByText('AI 最近更新：')).toBeInTheDocument();
    expect(screen.getByTitle('.claude/rules/04-LEARNING-STATE.md')).toBeInTheDocument();
    expect(screen.getByTitle('topics/用户行为.md')).toBeInTheDocument();

    fireEvent.click(screen.getByTitle('topics/用户行为.md'));
    expect(learningMocks.openWithDefault).toHaveBeenCalledWith({ path: 'topics/用户行为.md' });

    // Own UI write on the card file must be filtered out of the hint.
    learningMocks.recentChanges = ['.claude/rules/04-LEARNING-STATE.md', 'cards/2026-01-02-pm-friction.md'];
    fireEvent.click(screen.getByRole('button', { name: '标记学完' }));
    view.rerender(<TaskCenter isActive />);
    expect(screen.getByTitle('.claude/rules/04-LEARNING-STATE.md')).toBeInTheDocument();
    expect(screen.queryByTitle('cards/2026-01-02-pm-friction.md')).not.toBeInTheDocument();
  });

  it('dispatches a learning-mode discussion with the card prompt', () => {
    const events: Array<Record<string, unknown>> = [];
    const listener = (event: Event) => {
      events.push((event as CustomEvent).detail);
    };
    window.addEventListener('open-ai-discussion', listener);
    openLearning();
    fireEvent.click(screen.getByRole('button', { name: '和 AI 多轮学' }));
    window.removeEventListener('open-ai-discussion', listener);

    expect(events).toHaveLength(1);
    expect(events[0].learningMode).toBe(true);
    expect(events[0].chatTitle).toBeUndefined();
    expect(events[0].content).toContain('苏格拉底式提问');
  });

  it('renders the learning panel chrome in English', async () => {
    await i18n.changeLanguage('en-US');
    render(<TaskCenter isActive />);
    fireEvent.click(screen.getByRole('tab', { name: 'Learn' }));
    expect(screen.getByRole('tablist', { name: 'Learning and tasks' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Your daily learning' })).toBeInTheDocument();
    expect(screen.getByText('0 of 1 cards completed · Progress is saved locally')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark complete' })).toBeInTheDocument();
    await i18n.changeLanguage('zh-CN');
  });
});
