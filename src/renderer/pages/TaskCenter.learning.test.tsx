import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '@/i18n';
import TaskCenter from './TaskCenter';

const taskMocks = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('@/components/task-center/ThoughtPanel', () => ({ ThoughtPanel: () => null }));
vi.mock('@/components/task-center/TaskListPanel', () => ({ TaskListPanel: () => null }));
vi.mock('@/components/task-center/RecordingSourceDialog', () => ({ default: () => null }));
vi.mock('@/api/taskCenter', () => ({ taskCenterAvailable: () => true, taskGet: taskMocks.get }));
vi.mock('@/hooks/useConfig', () => ({
  useConfig: () => ({ config: {}, updateConfig: vi.fn() }),
}));
vi.mock('@/analytics', () => ({ track: vi.fn() }));

beforeEach(() => {
  localStorage.clear();
  taskMocks.get.mockReset();
});
afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

function openLearning() {
  const view = render(<TaskCenter />);
  fireEvent.click(screen.getByRole('tab', { name: '学习' }));
  return view;
}

describe('personal learning cards', () => {
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
    render(<TaskCenter />);
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
    render(<TaskCenter />);
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

  it('restores completed cards and feedback after reopening and allows undo', () => {
    const first = openLearning();
    fireEvent.click(screen.getAllByRole('button', { name: '标记学完' })[0]);
    fireEvent.click(screen.getAllByRole('button', { name: '这条有帮助' })[0]);
    expect(JSON.parse(localStorage.getItem('myagents.learning.completed.v1')!)).toEqual(['pm-friction']);
    expect(JSON.parse(localStorage.getItem('myagents.learning.feedback.v1')!)).toEqual({ 'pm-friction': 'useful' });
    first.unmount();

    openLearning();
    expect(screen.getByText('完成 1 / 3 张卡片 · 进度保存在本机')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '这条有帮助' })[0]).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '已学完' }));
    expect(JSON.parse(localStorage.getItem('myagents.learning.completed.v1')!)).toEqual([]);
  });

  it('falls back from malformed storage and keeps interactions usable when writes fail', () => {
    localStorage.setItem('myagents.learning.completed.v1', '{broken');
    localStorage.setItem('myagents.learning.feedback.v1', '[]');
    openLearning();
    expect(screen.getByText('完成 0 / 3 张卡片 · 进度保存在本机')).toBeInTheDocument();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    });
    fireEvent.click(screen.getAllByRole('button', { name: '标记学完' })[0]);
    fireEvent.click(screen.getAllByRole('button', { name: '不感兴趣' })[0]);
    expect(screen.getByRole('button', { name: '已学完' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '不感兴趣' })[0]).toHaveAttribute('aria-pressed', 'true');
  });

  it('renders the learning panel chrome in English', async () => {
    await i18n.changeLanguage('en-US');
    render(<TaskCenter />);
    fireEvent.click(screen.getByRole('tab', { name: 'Learn' }));
    expect(screen.getByRole('tablist', { name: 'Learning and tasks' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Your daily learning' })).toBeInTheDocument();
    expect(screen.getByText('0 of 3 cards completed · Progress is saved locally')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Mark complete' })).toHaveLength(3);
  });
});
