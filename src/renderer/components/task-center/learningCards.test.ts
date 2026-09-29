import { describe, expect, it } from 'vitest';
import enTask from '@/i18n/locales/en-US/task.json';
import zhTask from '@/i18n/locales/zh-CN/task.json';
import { LEARNING_IMPORT_ERRORS, readLearningFolder } from './learningCards';

function filesFrom(entries: Array<{ path: string; text: string }>): FileList {
  return entries.map(({ path, text }) => {
    const file = new File([text], path.split('/').at(-1) ?? 'note.md', { type: 'text/markdown' });
    Object.defineProperty(file, 'webkitRelativePath', { value: path });
    return file;
  }) as unknown as FileList;
}

describe('readLearningFolder', () => {
  it('provides both translations for every declared import error', () => {
    for (const code of Object.values(LEARNING_IMPORT_ERRORS)) {
      expect(enTask.learning.importErrors).toHaveProperty(code);
      expect(zhTask.learning.importErrors).toHaveProperty(code);
    }
  });

  it.each([
    { entries: Array.from({ length: 41 }, (_, i) => ({ path: `notes/${i}.md`, text: 'A note' })), code: LEARNING_IMPORT_ERRORS.tooManyFiles },
    { entries: [{ path: 'notes/large.md', text: 'x'.repeat(100_001) }], code: LEARNING_IMPORT_ERRORS.fileSizeLimit },
    { entries: Array.from({ length: 21 }, (_, i) => ({ path: `notes/${i}.md`, text: 'x'.repeat(100_000) })), code: LEARNING_IMPORT_ERRORS.totalSizeLimit },
  ])('rejects imports beyond the $code limit', async ({ entries, code }) => {
    await expect(readLearningFolder(filesFrom(entries))).rejects.toThrow(code);
  });

  it('ignores body title fields and never promotes an image URL to the source', async () => {
    const [card] = await readLearningFolder(filesFrom([{
      path: 'notes/example.md', text: 'title: An unrelated body field\n\n![cover](https://images.example/cover.png)',
    }]));
    expect(card.title).toBe('example');
    expect(card.sourceUrl).toBeUndefined();
  });

  it('keeps distinct nested source paths and only classifies known source folders', async () => {
    const cards = await readLearningFolder(filesFrom([
      { path: 'X/author/posts/note.md', text: '# Note\nA short note.' },
      { path: 'personal/posts/note.md', text: '# Note\nAnother short note.' },
    ]));

    expect(cards[0].category).toBe('X');
    expect(cards[1].category).toBe('本地资料');
    expect(cards[0].id).not.toBe(cards[1].id);
  });

  it('reads title only from frontmatter and preserves code symbols in content', async () => {
    const [card] = await readLearningFolder(filesFrom([{
      path: 'notes/example.md',
      text: '---\ntitle: "A useful note"\nurl: https://frontmatter.example\n---\nC# uses snake_case and #3 is a heading in a list.\n\nSee [the source](https://content.example/page).',
    }]));

    expect(card.title).toBe('A useful note');
    expect(card.body).toContain('C#');
    expect(card.body).toContain('snake_case');
    expect(card.body).toContain('#3');
    expect(card.sourceUrl).toBe('https://content.example/page');
  });
});
