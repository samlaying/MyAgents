import { describe, expect, it } from 'vitest';
import enTask from '@/i18n/locales/en-US/task.json';
import zhTask from '@/i18n/locales/zh-CN/task.json';
import {
  learningSourceLabel,
  LEARNING_IMPORT_ERRORS,
  validateLearningSourceFiles,
} from './learningCards';

function filesFrom(entries: Array<{ path: string; size?: number }>): FileList {
  return entries.map(({ path, size }) => {
    const file = new File(['A note'], path.split('/').at(-1) ?? 'note.md', { type: 'text/markdown' });
    Object.defineProperty(file, 'webkitRelativePath', { value: path });
    if (size !== undefined) Object.defineProperty(file, 'size', { value: size });
    return file;
  }) as unknown as FileList;
}

describe('validateLearningSourceFiles', () => {
  it('provides both translations for every declared import error', () => {
    for (const code of Object.values(LEARNING_IMPORT_ERRORS)) {
      expect(enTask.learning.importErrors).toHaveProperty(code);
      expect(zhTask.learning.importErrors).toHaveProperty(code);
    }
  });

  it('keeps only markdown files and returns them for copying', () => {
    const files = validateLearningSourceFiles(filesFrom([
      { path: 'notes/a.md' },
      { path: 'notes/b.txt' },
      { path: 'notes/c.MD' },
    ]));
    expect(files.map((file) => file.name)).toEqual(['a.md', 'c.MD']);
  });

  it.each([
    { entries: Array.from({ length: 41 }, (_, i) => ({ path: `notes/${i}.md` })), code: LEARNING_IMPORT_ERRORS.tooManyFiles },
    { entries: [{ path: 'notes/large.md', size: 100_001 }], code: LEARNING_IMPORT_ERRORS.fileSizeLimit },
    { entries: Array.from({ length: 21 }, (_, i) => ({ path: `notes/${i}.md`, size: 100_000 })), code: LEARNING_IMPORT_ERRORS.totalSizeLimit },
  ])('rejects imports beyond the $code limit', ({ entries, code }) => {
    expect(() => validateLearningSourceFiles(filesFrom(entries))).toThrow(code);
  });
});

describe('learningSourceLabel', () => {
  it('classifies known source folders and defaults to 本地资料', () => {
    expect(learningSourceLabel('xhs/author/posts/note.md')).toBe('小红书');
    expect(learningSourceLabel('bili/favorites/note.md')).toBe('B 站');
    expect(learningSourceLabel('x/posts/note.md')).toBe('X');
    expect(learningSourceLabel('Dropbox/notes/note.md')).toBe('本地资料');
  });
});
