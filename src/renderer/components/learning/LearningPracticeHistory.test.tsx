import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '@/i18n';
import { LearningChatContext, type LearningChatState } from '@/context/learningChatState';
import LearningPracticeHistory from './LearningPracticeHistory';
vi.mock('./LearningMarkdown', () => ({ default: ({ children }: { children: string }) => <div>{children}</div> }));
const cardPath = 'cards/2026-10-01-revenue.md';
const record = `---
type: practice
card: ${cardPath}
practice_id: abc
session_id: session-1
recorded_at: 2026-10-01T12:00:00+08:00
outcome: needs-review
---
还需要分析固定费用。
`;
function fixture(): LearningChatState {
  return {
    workspacePath: '/learning', isActive: true, isBusy: false, changeSignal: 0, discuss: vi.fn(),
    fileService: { isAvailable: true, dirExpand: vi.fn().mockResolvedValue({ children: [] }), readPreview: vi.fn().mockResolvedValue({ content: record }) } as unknown as LearningChatState['fileService'],
  };
}
function view(context: LearningChatState) {
  return <LearningChatContext.Provider value={context}><LearningPracticeHistory context={context} cardPath={cardPath} /></LearningChatContext.Provider>;
}
beforeEach(async () => { await i18n.changeLanguage('zh-CN'); });
describe('file-backed history under the original card', () => {
  it('appears only after a valid associated file exists and the workspace refreshes', async () => {
    const context = fixture();
    const node = render(view(context));
    await waitFor(() => expect(context.fileService.dirExpand).toHaveBeenCalledOnce());
    expect(screen.queryByText('最近学习记录')).toBeNull();
    vi.mocked(context.fileService.dirExpand).mockResolvedValue({ loaded: true, children: [
      { id: '1', path: 'assessments/2026-10-01-practice-abc.md', name: '2026-10-01-practice-abc.md', type: 'file' },
    ] });
    node.rerender(view({ ...context, changeSignal: 1 }));
    await screen.findByText('最近学习记录');
    expect(screen.getByText('还需要分析固定费用。')).toBeTruthy();
    vi.mocked(context.fileService.readPreview).mockResolvedValue({ name: '', size: 0, content: record.replace(cardPath, 'cards/2026-10-01-other.md') });
    node.rerender(view({ ...context, changeSignal: 2 }));
    await waitFor(() => expect(screen.queryByText('最近学习记录')).toBeNull());
  });
  it('ignores a late read after leaving the card scope and reports directory read failure', async () => {
    const context = fixture();
    let resolve!: (value: { children: []; loaded: boolean }) => void;
    vi.mocked(context.fileService.dirExpand).mockReturnValue(new Promise(done => { resolve = done; }));
    const node = render(view(context));
    node.rerender(view({ ...context, isActive: false }));
    await act(async () => { resolve({ children: [], loaded: true }); });
    expect(screen.queryByText('最近学习记录')).toBeNull();
    vi.mocked(context.fileService.dirExpand).mockRejectedValue(new Error('IO failure'));
    node.rerender(view({ ...context, changeSignal: 1 }));
    await screen.findByRole('status');
    expect(screen.queryByText('还需要分析固定费用。')).toBeNull();
  });
});
