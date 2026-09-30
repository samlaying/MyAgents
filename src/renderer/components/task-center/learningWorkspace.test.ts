import { describe, expect, it } from 'vitest';
import { applyCardUiPatch, LEARNING_CARD_PATH_RE, parseLearningCardMarkdown } from './learningWorkspace';

const SAMPLE = `---
id: 2026-01-02-pm-friction
title: 用户没完成任务，先找摩擦
category: 产品经理
time: 5 分钟
date: 2026-01-02
status: new
feedback:
related: [memory/topics/用户行为.md, cards/2025-12-30-x.md]
source: daily
source_url:
---

知识点正文第一段。

## 今天的小行动

挑一个流程，删掉一步。

## 引导提问

先问我一个问题。
`;

describe('parseLearningCardMarkdown', () => {
  it('parses frontmatter, sections and related links', () => {
    const card = parseLearningCardMarkdown(SAMPLE, 'cards/2026-01-02-pm-friction.md');
    expect(card).not.toBeNull();
    expect(card!.title).toBe('用户没完成任务，先找摩擦');
    expect(card!.category).toBe('产品经理');
    expect(card!.status).toBe('new');
    expect(card!.feedback).toBeNull();
    expect(card!.related).toEqual(['memory/topics/用户行为.md', 'cards/2025-12-30-x.md']);
    expect(card!.action).toBe('挑一个流程，删掉一步。');
    expect(card!.prompt).toBe('先问我一个问题。');
    expect(card!.body).toContain('知识点正文第一段');
    expect(card!.date).toBe('2026-01-02');
  });

  it('reads learned status and feedback marks', () => {
    const learned = SAMPLE.replace('status: new', 'status: learned').replace('feedback:', 'feedback: useful');
    const card = parseLearningCardMarkdown(learned, 'cards/2026-01-02-pm-friction.md');
    expect(card!.status).toBe('learned');
    expect(card!.feedback).toBe('useful');
  });

  it('rejects stray markdown and missing frontmatter', () => {
    expect(parseLearningCardMarkdown('# just a note', 'cards/2026-01-02-x.md')).toBeNull();
    expect(parseLearningCardMarkdown(SAMPLE, 'cards/readme.md')).toBeNull();
    expect(parseLearningCardMarkdown(SAMPLE, 'cards/notes.txt')).toBeNull();
  });

  it('accepts only the dated card filename shape', () => {
    expect(LEARNING_CARD_PATH_RE.test('2026-01-02-pm-friction.md')).toBe(true);
    expect(LEARNING_CARD_PATH_RE.test('2026-1-2-short.md')).toBe(false);
    expect(LEARNING_CARD_PATH_RE.test('2026-01-02-UPPER.md')).toBe(false);
    expect(LEARNING_CARD_PATH_RE.test('2026-01-02-a b.md')).toBe(false);
  });
});

describe('applyCardUiPatch', () => {
  it('rewrites only status/feedback and preserves every other byte', () => {
    const patched = applyCardUiPatch(SAMPLE, { status: 'learned', feedback: 'useful' });
    expect(patched).toContain('status: learned');
    expect(patched).toContain('feedback: useful');
    // Agent-owned fields and body untouched
    expect(patched).toContain('title: 用户没完成任务，先找摩擦');
    expect(patched).toContain('related: [memory/topics/用户行为.md, cards/2025-12-30-x.md]');
    expect(patched).toContain('## 引导提问');
    // Round-trip: reverting the patch reproduces the original exactly
    expect(applyCardUiPatch(patched, { status: 'new', feedback: null })).toBe(SAMPLE);
  });

  it('clears feedback to an empty value', () => {
    const patched = applyCardUiPatch(SAMPLE, { feedback: 'skip' });
    expect(applyCardUiPatch(patched, { feedback: null })).toBe(SAMPLE);
  });

  it('inserts missing UI fields into the frontmatter instead of failing', () => {
    const noFields = '---\ntitle: T\n---\n\nbody';
    const patched = applyCardUiPatch(noFields, { status: 'learned' });
    expect(patched).toContain('status: learned');
    expect(parseLearningCardMarkdown(patched, 'cards/2026-01-02-x.md')?.status).toBe('learned');
  });
});
