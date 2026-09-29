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

export const SAMPLE_LEARNING_CARDS: LearningCard[] = [
  {
    id: 'pm-friction', category: '产品经理', time: '5 分钟', title: '用户没完成任务，先找摩擦，不要先怪动机',
    body: '当用户在关键步骤流失，先检查步骤数、等待时间和信息不确定性。降低一次操作成本，往往比增加提醒更有效。',
    action: '今天挑一个你负责的流程，找出可以删掉或提前的一步。',
    prompt: '请用苏格拉底式提问带我学习“用户行为中的行动摩擦”。先问我一个问题，根据我的回答继续追问，最后帮我把它应用到一个产品案例。',
  },
  {
    id: 'english-retrieval', category: '英语六级', time: '5 分钟', title: '用主动回忆记单词：先想，再看答案',
    body: '合上词表，先尝试回忆词义或例句，再核对答案。检索失败也有价值；它会让下一次回忆更牢。',
    action: '选 5 个最近学过的词，遮住中文释义，口头说出含义和例句。',
    prompt: '请做我的六级英语教练，用主动回忆法带我练 5 个高频词。每次只出一个词，等我回答后纠错、举例，再进入下一个。',
  },
  {
    id: 'finance-subscription', category: '财商与生活', time: '4 分钟', title: '先审查重复订阅，比追逐高收益更容易省钱',
    body: '个人现金流改善可以从确定性较高的小额支出开始。列出自动续费项目，判断最近 30 天是否实际使用。',
    action: '花 3 分钟检查账单里的自动续费，取消一项不用的服务。',
    prompt: '请像一位谨慎的个人理财教练，带我做一次订阅支出盘点。每次问我一个问题，不要要求我提供账号、卡号等敏感信息。',
  },
];

const SOURCE_LIMIT = 40;
const FILE_LIMIT_BYTES = 100_000;

export const LEARNING_IMPORT_ERRORS = {
  tooManyFiles: 'too-many-files',
  totalSizeLimit: 'total-size-limit',
  fileSizeLimit: 'file-size-limit',
  noMarkdown: 'no-markdown',
  storageFull: 'storage-full',
} as const;

function sourceType(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/').map((part) => part.trim().toLowerCase());
  if (parts.some((part) => ['xhs', 'xiaohongshu', '小红书'].includes(part))) return '小红书';
  if (parts.some((part) => ['bili', 'bilibili', '哔哩哔哩', 'b站'].includes(part))) return 'B 站';
  if (parts.some((part) => ['x', 'twitter', 'x-posts', 'x_posts'].includes(part))) return 'X';
  return '本地资料';
}

function titleFromMarkdown(markdown: string, fileName: string): string {
  const frontmatter = /^---\s*\n([\s\S]*?)\n---(?:\s*\n|$)/.exec(markdown)?.[1];
  const frontmatterTitle = frontmatter
    ? /^title:\s*(?:"([^"]+)"|'([^']+)'|(.+))\s*$/im.exec(frontmatter)?.slice(1).find(Boolean)
    : undefined;
  const body = markdown.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '');
  const heading = /^#\s+(.+)$/m.exec(body)?.[1];
  return (frontmatterTitle ?? heading ?? fileName.replace(/\.md$/i, '')).trim().slice(0, 120);
}

export async function readLearningFolder(files: FileList): Promise<LearningCard[]> {
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

  return Promise.all(markdownFiles.map(async (file) => {
    const path = file.webkitRelativePath || file.name;
    const raw = await file.text();
    const markdown = raw.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '').trim();
    const body = markdown
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/^>\s?/gm, '')
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1')
      .replace(/\*\*(.*?)\*\*/gs, '$1')
      .replace(/\*([^*\n]+)\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
      .slice(0, 8_000);
    const label = sourceType(path);
    const title = titleFromMarkdown(raw, file.name);
    const sourceContent = markdown.replace(/!\[[^\]]*\]\([^)]+\)/g, '');
    const sourceUrl = /\[[^\]]+\]\((https?:\/\/[^)]+)\)/.exec(sourceContent)?.[1]
      ?? /https?:\/\/[^\s)\]]+/.exec(sourceContent)?.[0];
    return {
      id: `import:${label}:${path}`,
      category: label,
      time: '5 分钟',
      title,
      body,
      action: '从这份资料里挑一个观点，想想今天能在哪件小事上试用。',
      prompt: `请做我的碎片学习教练。根据下面资料先用通俗语言讲解一个最值得学的点，再给我一个今天能完成的小练习。每次只问我一个问题，根据我的回答继续追问，最后检查我是否理解。\n\n资料标题：${title}\n\n${body}`,
      sourceLabel: label,
      sourcePath: path,
      ...(sourceUrl ? { sourceUrl } : {}),
    } satisfies LearningCard;
  }));
}
