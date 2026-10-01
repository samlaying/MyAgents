import { useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { BookOpen, ChartNoAxesCombined, Check, Clock3, Languages, Lightbulb, MessageCircle, PanelsTopLeft, PencilLine, CircleHelp, ThumbsDown, ThumbsUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Markdown from '@/components/learning/LearningMarkdown';
import { applyCardUiPatch, parseLearningCardMarkdown, type WorkspaceLearningCard } from '@/components/task-center/learningWorkspace';
import { LearningChatContext, type LearningChatState } from '@/context/learningChatState';
import { useNotifyRowLayoutChanged } from '@/context/ChatRowLayoutContext';
import type { Message } from '@/types/chat';
import { learningCardPathsForTurn } from '@/utils/learningTurnCards';
import LearningPracticeHistory from './LearningPracticeHistory';
import './learning-cards.css';

export default function LearningTurnCards({ content, fallback = null, isLoading = false }: { content: Message['content']; fallback?: ReactNode; isLoading?: boolean }) {
  const context = useContext(LearningChatContext);
  const workspacePath = context?.workspacePath;
  const paths = useMemo(() => workspacePath ? learningCardPathsForTurn(content, workspacePath) : [], [content, workspacePath]);
  if (isLoading || !context || paths.length === 0) return fallback;
  return <LearningCardFiles key={`${context.workspacePath}:${paths.join('\n')}`} context={context} paths={paths} fallback={fallback} />;
}

function LearningCardFiles({ context, paths, fallback }: { context: LearningChatState; paths: string[]; fallback: ReactNode }) {
  const { t } = useTranslation('task');
  const { fileService, workspacePath, isActive, isBusy, changeSignal, discuss } = context;
  const [cards, setCards] = useState<WorkspaceLearningCard[]>([]);
  const [revision, setRevision] = useState(0);
  const [pending, setPending] = useState(false);
  const [practicePaths, setPracticePaths] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const notifyLayout = useNotifyRowLayoutChanged();

  useEffect(() => {
    if (!isActive || !fileService.isAvailable) return;
    let cancelled = false;
    void Promise.all(paths.map(async path => {
      try {
        const preview = await fileService.readPreview({ path });
        return parseLearningCardMarkdown(preview.content, path);
      } catch {
        return null; // Deleted / invalid references must not display invented cards.
      }
    })).then(results => {
      if (!cancelled) setCards(results.filter((card): card is WorkspaceLearningCard => card !== null));
    });
    return () => { cancelled = true; };
  }, [changeSignal, fileService, isActive, paths, revision]);

  useEffect(() => { notifyLayout('widget-resize'); }, [cards, error, notifyLayout]);

  const patchCard = async (card: WorkspaceLearningCard, patch: { status?: 'new' | 'learned'; feedback?: 'useful' | 'skip' | null }) => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      // Re-read the file before writing UI-owned fields; preserve Agent edits.
      const preview = await fileService.readPreview({ path: card.filePath });
      if (!parseLearningCardMarkdown(preview.content, card.filePath)) throw new Error('Invalid card');
      try {
        await fileService.saveFile({ path: card.filePath, content: applyCardUiPatch(preview.content, patch), expectedContent: preview.content });
      } catch {
        const latest = await fileService.readPreview({ path: card.filePath });
        if (!parseLearningCardMarkdown(latest.content, card.filePath)) throw new Error('Invalid card');
        await fileService.saveFile({ path: card.filePath, content: applyCardUiPatch(latest.content, patch), expectedContent: latest.content });
      }
    } catch {
      setError(t('learning.syncConflict'));
    } finally {
      setPending(false);
      setRevision(previous => previous + 1);
    }
  };

  const practicePath = () => {
    const date = new Date();
    const localDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    return `assessments/${localDate}-practice-${crypto.randomUUID()}.md`;
  };

  const startPractice = async (card: WorkspaceLearningCard, finish = false) => {
    setPending(true);
    setError(null);
    try {
      const recordPath = finish ? practicePaths[card.filePath] || practicePath() : practicePath();
      // Keep the same target on retry; accepted means sent, not saved or learned.
      setPracticePaths(previous => ({ ...previous, [card.filePath]: recordPath }));
      const accepted = await discuss(t(finish ? 'learning.finishPracticeMessage' : 'learning.practiceMessage', {
        path: card.filePath, title: card.title, prompt: card.prompt || card.action,
        recordPath, practiceId: recordPath.split('/').pop()!.replace(/\.md$/, ''), sessionId: context.sessionId || 'unknown',
      }));
      if (accepted === false) setError(t('learning.practiceFailed'));
    } catch {
      setError(t('learning.practiceFailed'));
    } finally {
      setPending(false);
    }
  };

  if (cards.length === 0) return fallback;
  return <div className="my-4 w-full space-y-4" data-learning-turn-cards>
    {cards.map(card => {
      // An explicit card category takes precedence over its workspace name.
      const classify = (value: string) => /六级|英语|cet[ -]?6|english/i.test(value) ? 'english'
        : /商业|business/i.test(value) ? 'business'
        : /产品|product|prd/i.test(value) ? 'product' : null;
      const course = classify(card.category) || classify(workspacePath.split(/[\\/]/).pop() || '') || 'general';
      const CourseIcon = course === 'english' ? Languages : course === 'business' ? ChartNoAxesCombined : course === 'product' ? PanelsTopLeft : BookOpen;
      return <article key={card.filePath} aria-label={card.title} data-course={course} className="learning-card overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--paper-elevated)] shadow-sm select-text">
      <header className="learning-card-header border-t-4 p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-[var(--ink-muted)]">
        <span className="learning-card-badge inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-semibold"><CourseIcon aria-hidden="true" className="size-4" />{card.category}</span>
        <span className="inline-flex items-center gap-1.5"><Clock3 aria-hidden="true" className="size-3.5" />{card.date} · {/^[0-9]+$/.test(card.time) ? t('learning.durationMinutes', { count: Number(card.time) }) : card.time}</span>
      </div>
      <p className="mt-4 text-xs font-medium tracking-wide text-[var(--ink-muted)]">{t('learning.cardLabel')}</p>
      <h3 className="mt-1 text-xl font-semibold leading-snug text-[var(--ink)]">{card.title}</h3>
      </header>
      <div className="p-5 sm:p-6">
      <section>
        <h4 className="learning-card-section-title mb-3 flex items-center gap-2 text-sm font-semibold"><Lightbulb aria-hidden="true" className="size-4" />{t('learning.coreKnowledge')}</h4>
        <div className="ai-message-content text-base leading-relaxed text-[var(--ink-secondary)]"><Markdown basePath="cards" workspacePath={workspacePath}>{card.body}</Markdown></div>
      </section>
      {card.action && <section className="learning-card-exercise mt-5 rounded-lg border border-[var(--line)] p-4 sm:p-5">
        <h4 className="learning-card-section-title mb-3 flex items-center gap-2 text-sm font-semibold"><PencilLine aria-hidden="true" className="size-4" />{t('learning.tryNow')}</h4>
        <div className="ai-message-content text-base leading-relaxed"><Markdown basePath="cards" workspacePath={workspacePath}>{card.action}</Markdown></div>
      </section>}
      {card.prompt && <section className="mt-5 border-l-2 border-[var(--learning-card-color)] py-1 pl-4">
        <h4 className="learning-card-section-title mb-2 flex items-center gap-2 text-sm font-semibold"><CircleHelp aria-hidden="true" className="size-4" />{t('learning.guidingQuestion')}</h4>
        <div className="ai-message-content text-base leading-relaxed"><Markdown basePath="cards" workspacePath={workspacePath}>{card.prompt}</Markdown></div>
      </section>}
      <LearningPracticeHistory key={`${workspacePath}:${card.filePath}`} context={context} cardPath={card.filePath} />
      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-[var(--line)] pt-4">
        <button type="button" disabled={pending || isBusy || !isActive} onClick={() => { void startPractice(card); }} className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-2 text-sm text-[var(--on-accent)] disabled:opacity-50"><MessageCircle className="size-4" />{t('learning.startPractice')}</button>
        <button type="button" disabled={pending || isBusy || !isActive || !context.sessionId} onClick={() => { void startPractice(card, true); }} className="rounded-lg border border-[var(--line)] px-3 py-2 text-sm text-[var(--ink)] disabled:opacity-50">{t('learning.finishPractice')}</button>
        <button type="button" disabled={pending || !isActive} aria-pressed={card.status === 'learned'} onClick={() => { void patchCard(card, { status: card.status === 'learned' ? 'new' : 'learned' }); }} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--line)] px-3 py-2 text-sm text-[var(--ink)] disabled:opacity-50"><Check className="size-4" />{t(card.status === 'learned' ? 'learning.completed' : 'learning.markComplete')}</button>
        <div className="ml-auto flex gap-1">
          <button type="button" disabled={pending || !isActive} aria-label={t('learning.feedbackUseful')} aria-pressed={card.feedback === 'useful'} onClick={() => { void patchCard(card, { feedback: card.feedback === 'useful' ? null : 'useful' }); }} className={`rounded-md p-2 disabled:opacity-50 ${card.feedback === 'useful' ? 'text-[var(--accent)]' : 'text-[var(--ink-muted)]'}`}><ThumbsUp className="size-4" /></button>
          <button type="button" disabled={pending || !isActive} aria-label={t('learning.feedbackSkip')} aria-pressed={card.feedback === 'skip'} onClick={() => { void patchCard(card, { feedback: card.feedback === 'skip' ? null : 'skip' }); }} className={`rounded-md p-2 disabled:opacity-50 ${card.feedback === 'skip' ? 'text-[var(--accent)]' : 'text-[var(--ink-muted)]'}`}><ThumbsDown className="size-4" /></button>
        </div>
      </div>
      </div>
    </article>; })}
    {error && <p role="alert" className="text-sm text-[var(--error)]">{error}</p>}
  </div>;
}
