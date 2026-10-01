import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { i18n } from '@/i18n';
import { LearningChatContext, type LearningChatState } from '@/context/learningChatState';
import LearningMarkdown from './LearningMarkdown';
import { ThemeRuntimeProvider } from '@/theme';

const context = { workspacePath: '/learning' } as LearningChatState;
beforeEach(async () => { await i18n.changeLanguage('zh-CN'); });
const view = (text: string) => render(<ThemeRuntimeProvider selection={{ themeId: 'myagents-default', appearanceMode: 'light' }}><LearningChatContext.Provider value={context}><LearningMarkdown>{text}</LearningMarkdown></LearningChatContext.Provider></ThemeRuntimeProvider>);

describe('learning semantic Markdown', () => {
  it('renders a labeled takeaway without showing its machine marker', () => {
    view('> [!CORE]\n> 营收增长不代表**利润增长**。');
    expect(screen.getByText('核心结论')).toBeTruthy();
    expect(screen.getByText('利润增长').tagName).toBe('STRONG');
    expect(screen.queryByText(/\[!CORE\]/)).toBeNull();
  });
  it('preserves GFM comparison tables and safe formatting inside callouts', () => {
    view('> [!COMPARE]\n>\n> | 营收 | 利润 |\n> | --- | --- |\n> | 总收入 | 收入减成本 |');
    expect(screen.getByText('对比理解')).toBeTruthy();
    expect(screen.getAllByRole('columnheader')).toHaveLength(2);
    expect(screen.getByRole('cell', { name: '收入减成本' })).toBeTruthy();
  });
  it('leaves ordinary quotes, unknown markers and fenced examples intact', () => {
    view('> 原文引用\n\n> [!OTHER]\n> 保留原文\n\n```text\n> [!CORE]\n```');
    expect(screen.queryByText('核心结论')).toBeNull();
    expect(screen.getByText('原文引用')).toBeTruthy();
    expect(screen.getByText(/\[!OTHER\]/)).toBeTruthy();
  });
  it('keeps ordinary Agent Markdown unchanged and retains sanitization in learning', () => {
    const normal = render(<LearningMarkdown>{'> [!CORE]\n> 原文'}</LearningMarkdown>);
    expect(screen.queryByText('核心结论')).toBeNull();
    normal.unmount();
    const learning = view('> [!EXAMPLE]\n> <script>alert(1)</script><a href="javascript:alert(1)">例子</a>');
    expect(screen.getByText('具体例子')).toBeTruthy();
    expect(learning.container.querySelector('script')).toBeNull();
    expect(learning.container.querySelector('[href^="javascript:"]')).toBeNull();
  });
});
