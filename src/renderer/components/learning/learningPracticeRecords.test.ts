import { describe, expect, it } from 'vitest';
import { parseLearningPracticeRecord } from './learningPracticeRecords';
const path = 'assessments/2026-10-01-practice-abc.md';
const raw = `---
type: practice
card: cards/2026-10-01-revenue.md
practice_id: abc
session_id: session-1
recorded_at: 2026-10-01T12:00:00+08:00
outcome: needs-review
---
## 用户回答
成本也翻倍了。
## 教练反馈
继续分析毛利与固定费用。
`;
describe('persisted practice record boundary', () => {
  it('parses real YAML scalars and preserves the saved record body', () => {
    expect(parseLearningPracticeRecord(raw.replace('type: practice', 'type: "practice"'), path)).toMatchObject({ cardPath: 'cards/2026-10-01-revenue.md', outcome: 'needs-review', practiceId: 'abc' });
    expect(parseLearningPracticeRecord(raw, path)?.body).toContain('成本也翻倍了');
  });
  it('rejects workspace escapes, malformed metadata, empty bodies and invalid results', () => {
    for (const content of [raw.replace('cards/2026', '../cards/2026'), raw.replace('needs-review', 'mastered'), raw.replace('session-1', ''), raw.replace('+08:00', ''), raw.split('\n---\n')[0] + '\n---\n', raw.replace('type: practice', 'type: [practice]')]) {
      expect(parseLearningPracticeRecord(content, path)).toBeNull();
    }
    expect(parseLearningPracticeRecord(raw, '../' + path)).toBeNull();
  });
});
