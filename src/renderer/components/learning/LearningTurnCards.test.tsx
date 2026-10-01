import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '@/i18n';
import { LearningChatContext, type LearningChatState } from '@/context/learningChatState';
import LearningTurnCards from './LearningTurnCards';

vi.mock('@/components/Markdown', () => ({ default: ({ children }: { children: string }) => <div>{children}</div> }));

const path = 'cards/2026-10-01-revenue-profit.md';
const raw = `---
id: revenue-profit
title: 营收与利润
category: 商业感知
time: 4
date: 2026-10-01
status: new
feedback:
---
增长也需要关注成本。

## 今天的小行动
分析一家商店。

## 引导提问
营业额增长，利润为什么会下降？
`;

function fixture(overrides: Partial<LearningChatState> = {}): LearningChatState {
  return {
    workspacePath: '/workspace/learning',
    sessionId: 'session-1',
    isActive: true,
    isBusy: false,
    changeSignal: 0,
    discuss: vi.fn().mockResolvedValue(true),
    fileService: {
      isAvailable: true,
      dirExpand: vi.fn().mockResolvedValue({ children: [], loaded: true }),
      readPreview: vi.fn().mockResolvedValue({ content: raw }),
      saveFile: vi.fn().mockResolvedValue(undefined),
    } as unknown as LearningChatState['fileService'],
    ...overrides,
  };
}

function view(context: LearningChatState | null) {
  return <LearningChatContext.Provider value={context}><LearningTurnCards content={`已保存到 \`${path}\``} /></LearningChatContext.Provider>;
}

beforeEach(async () => { await i18n.changeLanguage('zh-CN'); });

describe('learning cards inside the current Chat', () => {
  it('keeps streaming text visible and waits for the turn to finish before reading a card', async () => {
    const context = fixture();
    const content = `保存到 \`${path}\``;
    const rendered = render(<LearningChatContext.Provider value={context}><LearningTurnCards content={content} isLoading fallback={<p>正在生成</p>} /></LearningChatContext.Provider>);
    expect(screen.getByText('正在生成')).toBeTruthy();
    expect(context.fileService.readPreview).not.toHaveBeenCalled();
    rendered.rerender(<LearningChatContext.Provider value={context}><LearningTurnCards content={content} /></LearningChatContext.Provider>);
    await screen.findByRole('article');
  });

  it('sends a stable closing target on retries without marking the card learned', async () => {
    const context = fixture();
    render(view(context));
    await screen.findByRole('article');
    fireEvent.click(screen.getByRole('button', { name: '开始练习' }));
    await waitFor(() => expect(context.discuss).toHaveBeenCalledOnce());
    const start = vi.mocked(context.discuss).mock.calls[0][0];
    const target = /assessments\/[^。\s]+\.md/.exec(start)?.[0];
    expect(target).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '结束并记录' }));
    await waitFor(() => expect(context.discuss).toHaveBeenCalledTimes(2));
    expect(vi.mocked(context.discuss).mock.calls[1][0]).toContain(target!);
    await waitFor(() => expect(screen.getByRole('button', { name: '结束并记录' }).hasAttribute('disabled')).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: '结束并记录' }));
    await waitFor(() => expect(context.discuss).toHaveBeenCalledTimes(3));
    expect(vi.mocked(context.discuss).mock.calls[2][0]).toContain(target!);
    expect(context.fileService.saveFile).not.toHaveBeenCalled();
  });

  it('replaces the final reply with the real saved card and preserves the reply when no file exists', async () => {
    const context = fixture();
    const node = <LearningTurnCards content={`已保存 \`${path}\``} fallback={<p>原始回复</p>} />;
    const rendered = render(<LearningChatContext.Provider value={context}>{node}</LearningChatContext.Provider>);
    await screen.findByRole('article');
    expect(screen.queryByText('原始回复')).toBeNull();
    vi.mocked(context.fileService.readPreview).mockRejectedValue(new Error('deleted'));
    rendered.rerender(<LearningChatContext.Provider value={{ ...context, changeSignal: 1 }}>{node}</LearningChatContext.Provider>);
    await screen.findByText('原始回复');
    expect(screen.queryByRole('article')).toBeNull();
  });

  it('reads the saved card and starts practice through the same Chat sender', async () => {
    const context = fixture();
    render(view(context));
    await screen.findByRole('article', { name: '营收与利润' });
    expect(screen.getByText(/4 分钟/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '开始练习' }));
    await waitFor(() => expect(context.discuss).toHaveBeenCalledOnce());
    expect(context.discuss).toHaveBeenCalledWith(expect.stringContaining(path));
    expect(context.discuss).toHaveBeenCalledWith(expect.stringContaining('营业额增长，利润为什么会下降？'));
    expect(context.fileService.saveFile).not.toHaveBeenCalled();
  });

  it('retries a conflicting UI status write against fresh file contents, preserving Agent edits', async () => {
    const context = fixture();
    render(view(context));
    await screen.findByRole('article');
    const updated = raw.replace('增长也需要关注成本。', 'Agent 刚刚补充了新的例子。');
    vi.mocked(context.fileService.readPreview).mockResolvedValue({ content: updated, name: path, size: updated.length });
    vi.mocked(context.fileService.saveFile).mockRejectedValueOnce(new Error('content mismatch'));
    fireEvent.click(screen.getByRole('button', { name: '标记学完' }));
    await waitFor(() => expect(context.fileService.saveFile).toHaveBeenCalledTimes(2));
    expect(context.fileService.saveFile).toHaveBeenLastCalledWith({ path, content: updated.replace('status: new', 'status: learned'), expectedContent: updated });
  });

  it('keeps cards out of ordinary Agent chats and pauses file reads for hidden chats', async () => {
    const context = fixture({ isActive: false });
    const rendered = render(view(null));
    expect(screen.queryByRole('article')).toBeNull();
    rendered.rerender(view(context));
    await act(async () => {});
    expect(context.fileService.readPreview).not.toHaveBeenCalled();
  });

  it('drops a delayed card read from the previous workspace', async () => {
    let resolve!: (value: { content: string; name: string; size: number }) => void;
    const first = fixture();
    vi.mocked(first.fileService.readPreview).mockReturnValue(new Promise(done => { resolve = done; }));
    const next = fixture({ workspacePath: '/workspace/another' });
    vi.mocked(next.fileService.readPreview).mockRejectedValue(new Error('missing'));
    const rendered = render(view(first));
    rendered.rerender(view(next));
    await act(async () => { resolve({ content: raw, name: path, size: raw.length }); });
    expect(screen.queryByRole('article')).toBeNull();
  });

  it('surfaces failed feedback writes without claiming success', async () => {
    const context = fixture();
    render(view(context));
    await screen.findByRole('article');
    vi.mocked(context.fileService.saveFile).mockRejectedValue(new Error('read-only'));
    fireEvent.click(screen.getByRole('button', { name: '这条有帮助' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: '这条有帮助' }).getAttribute('aria-pressed')).toBe('false');
  });
});
