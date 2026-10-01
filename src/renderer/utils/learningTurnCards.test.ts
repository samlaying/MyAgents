import { describe, expect, it } from 'vitest';
import type { ContentBlock } from '@/types/chat';
import { learningCardPathsForTurn } from './learningTurnCards';

const path = 'cards/2026-10-01-revenue-profit.md';

describe('learningCardPathsForTurn', () => {
  it('recognizes completed file writes without requiring the Agent to repeat a path in its answer', () => {
    const blocks: ContentBlock[] = [{ type: 'tool_use', tool: { id: 'write', streamIndex: 0, name: 'Write', input: { file_path: `/workspace/${path}`, content: 'card' }, result: 'saved' } }];
    expect(learningCardPathsForTurn(blocks, '/workspace')).toEqual([path]);
    blocks[0].tool!.isError = true;
    expect(learningCardPathsForTurn(blocks, '/workspace')).toEqual([]);
  });

  it('deduplicates local references and rejects external, traversing, and non-card paths', () => {
    const content = `已保存 \`${path}\` [卡片](/workspace/${path}) [其他工作区](/other/${path}) \`cards/../../secret.md\` \`topics/revenue.md\` [网站](https://example.com/${path})`;
    expect(learningCardPathsForTurn(content, '/workspace')).toEqual([path]);
  });
});
