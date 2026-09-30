// Learning source import validation. Card generation itself moved into the
// learning workspace agent (see bundled-workspaces/learning/CLAUDE.md); the
// panel only gates what lands in `sources/` — the agent turns material into
// cards from there.

export interface LearningCard {
  id: string;
  category: string;
  time: string;
  title: string;
  body: string;
  action: string;
  prompt: string;
  sourceLabel?: string;
  sourcePath?: string;
  sourceUrl?: string;
}

const SOURCE_LIMIT = 40;
const FILE_LIMIT_BYTES = 100_000;

export const LEARNING_IMPORT_ERRORS = {
  tooManyFiles: 'too-many-files',
  totalSizeLimit: 'total-size-limit',
  fileSizeLimit: 'file-size-limit',
  noMarkdown: 'no-markdown',
  storageFull: 'storage-full',
} as const;

/** Gate the user-picked folder before anything is copied into `sources/`.
 *  Throws a LEARNING_IMPORT_ERRORS code on violation; returns the .md subset
 *  (possibly empty — callers surface the noMarkdown error). */
export function validateLearningSourceFiles(files: FileList): File[] {
  const markdownFiles = Array.from(files).filter((file) => file.name.toLowerCase().endsWith('.md'));
  if (markdownFiles.length > SOURCE_LIMIT) {
    throw new Error(LEARNING_IMPORT_ERRORS.tooManyFiles);
  }
  if (markdownFiles.reduce((total, file) => total + file.size, 0) > 2_000_000) {
    throw new Error(LEARNING_IMPORT_ERRORS.totalSizeLimit);
  }
  if (markdownFiles.some((file) => file.size > FILE_LIMIT_BYTES)) {
    throw new Error(LEARNING_IMPORT_ERRORS.fileSizeLimit);
  }
  return markdownFiles;
}

/** Label a source folder for display/toast purposes only — the agent
 *  classifies actual content when composing cards. */
export function learningSourceLabel(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/').map((part) => part.trim().toLowerCase());
  if (parts.some((part) => ['xhs', 'xiaohongshu', '小红书'].includes(part))) return '小红书';
  if (parts.some((part) => ['bili', 'bilibili', '哔哩哔哩', 'b站'].includes(part))) return 'B 站';
  if (parts.some((part) => ['x', 'twitter', 'x-posts', 'x_posts'].includes(part))) return 'X';
  return '本地资料';
}
