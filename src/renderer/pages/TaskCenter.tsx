// TaskCenter — single-instance tab combining Thought stream (left) and Task list (right).
// PRD §5 / §6.

import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpen, Check, CircleCheck, MessageCircle, ThumbsDown, ThumbsUp } from 'lucide-react';
import { ThoughtPanel } from '@/components/task-center/ThoughtPanel';
import { TaskListPanel } from '@/components/task-center/TaskListPanel';
import RecordingSourceDialog from '@/components/task-center/RecordingSourceDialog';
import { taskCenterAvailable } from '@/api/taskCenter';
import { speechModelPackStatus } from '@/api/recording';
import { track } from '@/analytics';
import { CUSTOM_EVENTS } from '@/../shared/constants';
import { useConfig } from '@/hooks/useConfig';
import type { Thought } from '@/../shared/types/thought';
import type { TaskCreateRequest } from '@/../shared/taskDiscussion';
import type { PendingAppRoute } from '@/../shared/appRoute';
import type {
  RecordSummary,
  RecordingSnapshot,
  RecordingSourceSelection,
} from '@/../shared/types/record';

interface Props {
  isActive?: boolean;
  /** Canonical Session id of the Chat tab from which Task Center was opened. */
  currentSessionId?: string | null;
  /** Most recent OPEN_TASK_CENTER event payload. Forwarded to `TaskListPanel`
   *  so navigation with `{ autofocusSearch: true }` can open the task-list
   *  search input without the user touching the UI a second time. `nonce`
   *  forces the consumer's effect to re-fire when the same intent is sent
   *  back-to-back (e.g. user clicking the Launcher search icon twice). */
  pendingIntent?: {
    autofocusSearch?: boolean;
    nonce: number;
    consumed?: boolean;
  } | null;
  onSearchIntentConsumed?: (generation: number) => void;
  pendingRoute?: PendingAppRoute | null;
  onRouteConsumed?: (generation: number) => void;
  onOpenRecord?: (
    recordId: string,
    mediaMs?: number,
    activeRecording?: boolean,
  ) => void;
  activeRecordingSnapshot?: RecordingSnapshot | null;
  onStartRecording?: (selection: RecordingSourceSelection) => Promise<void>;
}

export default function TaskCenter({
  isActive,
  pendingIntent,
  onSearchIntentConsumed,
  currentSessionId,
  pendingRoute,
  onRouteConsumed,
  onOpenRecord,
  activeRecordingSnapshot,
  onStartRecording,
}: Props) {
  const { t } = useTranslation('task');
  const { config, updateConfig } = useConfig();
  const [recordingRequestBusy, setRecordingRequestBusy] = useState(false);
  const [activePanel, setActivePanel] = useState<'tasks' | 'learning'>('tasks');
  const [completedLessons, setCompletedLessons] = useState<string[]>(() => {
    try {
      const value: unknown = JSON.parse(localStorage.getItem('myagents.learning.completed.v1') ?? '[]');
      return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
    } catch { return []; }
  });
  const [lessonFeedback, setLessonFeedback] = useState<Record<string, 'useful' | 'skip'>>(() => {
    try {
      const value: unknown = JSON.parse(localStorage.getItem('myagents.learning.feedback.v1') ?? '{}');
      return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, 'useful' | 'skip'> : {};
    } catch { return {}; }
  });
  const lessons = useMemo(() => [
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
  ], []);
  const completedCount = lessons.filter((lesson) => completedLessons.includes(lesson.id)).length;

  const toggleLessonComplete = useCallback((lessonId: string) => {
    setCompletedLessons((current) => {
      const next = current.includes(lessonId) ? current.filter((id) => id !== lessonId) : [...current, lessonId];
      try { localStorage.setItem('myagents.learning.completed.v1', JSON.stringify(next)); } catch { /* Progress remains available for this app session. */ }
      return next;
    });
  }, []);

  const saveLessonFeedback = useCallback((lessonId: string, feedback: 'useful' | 'skip') => {
    setLessonFeedback((current) => {
      const next = { ...current, [lessonId]: feedback };
      try { localStorage.setItem('myagents.learning.feedback.v1', JSON.stringify(next)); } catch { /* Feedback remains available for this app session. */ }
      return next;
    });
  }, []);

  const discussLesson = useCallback((prompt: string, chatTitle: string) => {
    window.dispatchEvent(new CustomEvent(CUSTOM_EVENTS.OPEN_AI_DISCUSSION, {
      detail: { content: prompt, learningMode: true, chatTitle },
    }));
  }, []);
  const [recordingSourceDialog, setRecordingSourceDialog] = useState<{
    initialSelection: RecordingSourceSelection;
    modelPackUsable?: boolean;
    error?: string;
  } | null>(null);

  const handleOpenSpeechSettings = useCallback(() => {
    setRecordingSourceDialog(null);
    window.dispatchEvent(
      new CustomEvent(CUSTOM_EVENTS.OPEN_SETTINGS, {
        detail: {
          section: 'mcp',
          officialToolId: 'speech-recognition',
        },
      }),
    );
  }, []);

  const handleRequestRecording = useCallback(async () => {
    if (!onStartRecording) return;
    const initialSelection = config.recordingSourceSelection ?? {
      microphone: true,
      system: true,
    };
    setRecordingRequestBusy(true);
    if (config.recordingSourceSelection) {
      try {
        await onStartRecording(initialSelection);
      } catch (error) {
        setRecordingSourceDialog({
          initialSelection,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        setRecordingRequestBusy(false);
      }
      return;
    }
    let modelPackUsable: boolean | undefined;
    try {
      modelPackUsable = (await speechModelPackStatus()).usable;
    } catch {
      // Resource status is advisory for start; capture remains available.
    }
    setRecordingSourceDialog({ initialSelection, modelPackUsable });
    setRecordingRequestBusy(false);
  }, [config.recordingSourceSelection, onStartRecording]);

  const handleRecordingSourceConfirm = useCallback(
    async (selection: RecordingSourceSelection) => {
      if (!onStartRecording || !recordingSourceDialog) return;
      setRecordingRequestBusy(true);
      try {
        await updateConfig({ recordingSourceSelection: selection });
        await onStartRecording(selection);
        setRecordingSourceDialog(null);
      } catch (error) {
        setRecordingSourceDialog({
          ...recordingSourceDialog,
          initialSelection: selection,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        setRecordingRequestBusy(false);
      }
    },
    [onStartRecording, recordingSourceDialog, updateConfig],
  );

  // Child panels react to `isActive` transitions on their own (via refreshKey
  // derived from it below). We do NOT setState in an effect here — the lint
  // rule `react-hooks/set-state-in-effect` flags that. `isActive` itself is
  // passed down as the refresh signal.
  //
  // Tabs stay mounted with `content-visibility: hidden` when inactive, so
  // panels need to know "I just became active again" to reload. Passing
  // `isActive` straight through accomplishes that without a derived counter.

  const handleDispatch = useCallback(
    (t: Thought) => {
      const request: TaskCreateRequest = {
        initialMode: 'manual',
        source: 'thought',
        currentSessionId: currentSessionId ?? null,
        thought: { id: t.id, content: t.content, tags: t.tags },
      };
      window.dispatchEvent(
        new CustomEvent(CUSTOM_EVENTS.OPEN_TASK_CREATE, { detail: request }),
      );
    },
    [currentSessionId],
  );

  const handleDiscuss = useCallback((t: Thought, workspaceId: string) => {
    track('task_align_discuss', {});
    // Hand off to App.tsx which owns tab creation. The workspace was picked
    // explicitly via the card's workspace popover, so we carry its id through
    // the event; App.tsx uses it instead of running a smart-default guess.
    window.dispatchEvent(
      new CustomEvent(CUSTOM_EVENTS.OPEN_AI_DISCUSSION, {
        detail: {
          sourceRecordId: t.id,
          sourceRecordKind: 'text',
          content: t.content,
          workspaceId,
        },
      }),
    );
  }, []);

  const handleDiscussAudio = useCallback(
    (record: RecordSummary, workspaceId: string) => {
      track('task_align_discuss', {});
      window.dispatchEvent(
        new CustomEvent(CUSTOM_EVENTS.OPEN_AI_DISCUSSION, {
          detail: {
            sourceRecordId: record.id,
            sourceRecordKind: 'audio',
            workspaceId,
          },
        }),
      );
    },
    [],
  );

  const handleCreateTask = useCallback(() => {
    const request: TaskCreateRequest = {
      initialMode: 'smart',
      source: 'task-center',
      currentSessionId: currentSessionId ?? null,
    };
    window.dispatchEvent(
      new CustomEvent(CUSTOM_EVENTS.OPEN_TASK_CREATE, { detail: request }),
    );
  }, [currentSessionId]);

  // The DispatchTaskDialog returns the full Task, but for Phase 4 we only need
  // to know "something changed" to re-fetch both panels. Future Phase 5 hook:
  // pass the task down so the newly created one can be highlighted/scrolled to.

  if (!taskCenterAvailable()) {
    return (
      <div className="flex h-full items-center justify-center bg-[var(--paper)] px-8 text-center">
        <div className="max-w-md text-sm leading-relaxed text-[var(--ink-muted)]">
          <p className="font-medium text-[var(--ink-secondary)]">
            {t('center.title')}
          </p>
          <p className="mt-2">{t('center.desktopOnly')}</p>
          <p className="mt-2 text-[var(--ink-muted)]/70">
            {t('center.desktopUnavailable')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-[var(--paper)]">
      {recordingSourceDialog && (
        <RecordingSourceDialog
          mode="start"
          initialSelection={recordingSourceDialog.initialSelection}
          modelPackUsable={recordingSourceDialog.modelPackUsable}
          error={recordingSourceDialog.error}
          busy={recordingRequestBusy}
          onConfirm={handleRecordingSourceConfirm}
          onCancel={() => setRecordingSourceDialog(null)}
          onOpenSpeechSettings={handleOpenSpeechSettings}
        />
      )}
      {/* Page title — v0.1.69 polish:
            • breadcrumb "沉淀想法 › 派发任务 › 让 AI 执行" removed
              (it was scene-setting copy, redundant once the user is in
              the tab)
            • title bumped to 20px (type-scale §2.2 --text-xl) so it
              reads as the page heading it is, a tier above the 14px
              section headers inside the panels below
            • bottom border removed; vertical breathing room (pt/pb)
              replaces the hairline as the divider, continuing the
              "layout over rules" direction set in the review  */}
      <div className="flex shrink-0 items-center gap-5 px-5 pt-5 pb-3">
        <h1 className="text-xl font-semibold text-[var(--ink)]">{t('center.title')}</h1>
        <div className="flex rounded-lg bg-[var(--paper-inset)] p-1" role="tablist" aria-label={t('learning.tabsLabel')}>
          <button type="button" role="tab" aria-selected={activePanel === 'tasks'} onClick={() => setActivePanel('tasks')} className={`rounded-md px-3 py-1.5 text-sm ${activePanel === 'tasks' ? 'bg-[var(--paper)] text-[var(--ink)] shadow-sm' : 'text-[var(--ink-muted)]'}`}>{t('learning.tasksTab')}</button>
          <button type="button" role="tab" aria-selected={activePanel === 'learning'} onClick={() => setActivePanel('learning')} className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm ${activePanel === 'learning' ? 'bg-[var(--paper)] text-[var(--ink)] shadow-sm' : 'text-[var(--ink-muted)]'}`}><BookOpen className="h-3.5 w-3.5" />{t('learning.learningTab')}</button>
        </div>
      </div>

      {/* Two-column body — each panel renders its own section header
          (icon + label + collapsible 🔍 search toggle). */}
      {activePanel === 'learning' ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-8">
          <div className="mx-auto max-w-4xl">
            <section className="mb-5 rounded-2xl border border-[var(--line)] bg-[var(--paper-elevated)] p-5">
              <div className="flex items-start justify-between gap-4">
                <div><p className="text-sm text-[var(--ink-muted)]">{t('learning.dailyTagline')}</p><h2 className="mt-1 text-lg font-semibold text-[var(--ink)]">{t('learning.dailyTitle')}</h2><p className="mt-1 text-sm text-[var(--ink-muted)]">{t('learning.progress', { completed: completedCount, total: lessons.length })}</p></div>
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]"><BookOpen className="h-5 w-5" /></div>
              </div>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-[var(--paper-inset)]"><div className="h-full rounded-full bg-[var(--accent)] transition-all" style={{ width: `${(completedCount / lessons.length) * 100}%` }} /></div>
              <p className="mt-3 text-xs text-[var(--ink-muted)]">{t('learning.previewNotice')}</p>
            </section>
            <div className="grid gap-4 md:grid-cols-2">
              {lessons.map((lesson) => {
                const done = completedLessons.includes(lesson.id);
                return <article key={lesson.id} className="rounded-2xl border border-[var(--line)] bg-[var(--paper-elevated)] p-5">
                  <div className="flex items-center justify-between text-xs text-[var(--ink-muted)]"><span className="rounded-full bg-[var(--paper-inset)] px-2.5 py-1">{lesson.category}</span><span>{lesson.time}</span></div>
                  <h3 className="mt-4 text-base font-semibold leading-6 text-[var(--ink)]">{lesson.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-[var(--ink-secondary)]">{lesson.body}</p>
                  <div className="mt-4 rounded-xl bg-[var(--paper-inset)] p-3"><p className="text-xs font-medium text-[var(--ink-muted)]">{t('learning.tryNow')}</p><p className="mt-1 text-sm leading-5 text-[var(--ink)]">{lesson.action}</p></div>
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <button type="button" onClick={() => toggleLessonComplete(lesson.id)} className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium ${done ? 'bg-[var(--success-bg)] text-[var(--on-success)]' : 'bg-[var(--accent)] text-[var(--on-accent)]'}`}>{done ? <CircleCheck className="h-4 w-4" /> : <Check className="h-4 w-4" />}{done ? t('learning.completed') : t('learning.markComplete')}</button>
                    <button type="button" onClick={() => discussLesson(lesson.prompt, lesson.title)} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--line)] px-3 py-2 text-sm text-[var(--ink)] hover:bg-[var(--hover-bg)]"><MessageCircle className="h-4 w-4" />{t('learning.discuss')}</button>
                    <span className="ml-auto flex gap-1">
                      <button type="button" aria-label={t('learning.feedbackUseful')} aria-pressed={lessonFeedback[lesson.id] === 'useful'} onClick={() => saveLessonFeedback(lesson.id, 'useful')} className={`rounded-md p-2 ${lessonFeedback[lesson.id] === 'useful' ? 'text-[var(--accent)]' : 'text-[var(--ink-muted)]'}`}><ThumbsUp className="h-4 w-4" /></button>
                      <button type="button" aria-label={t('learning.feedbackSkip')} aria-pressed={lessonFeedback[lesson.id] === 'skip'} onClick={() => saveLessonFeedback(lesson.id, 'skip')} className={`rounded-md p-2 ${lessonFeedback[lesson.id] === 'skip' ? 'text-[var(--accent)]' : 'text-[var(--ink-muted)]'}`}><ThumbsDown className="h-4 w-4" /></button>
                    </span>
                  </div>
                </article>;
              })}
            </div>
          </div>
        </div>
      ) : <div className="flex min-w-0 flex-1 overflow-hidden">
        {/* Left: Thought stream */}
        <div className="flex w-[480px] min-w-0 max-w-full shrink-0 flex-col overflow-hidden">
          <ThoughtPanel
            onDispatchThought={handleDispatch}
            onDiscussThought={handleDiscuss}
            onDiscussAudioRecord={handleDiscussAudio}
            refreshKey={isActive ? '1' : '0'}
            // Suppress thought-input autofocus when the user arrived via
            // the Launcher 「我的任务」 search icon — in that flow the
            // caret belongs in the TaskListPanel search field, not the
            // ThoughtInput. Both would otherwise `requestAnimationFrame`
            // a focus call on the same tick, the right panel's effect
            // wins by render order but the user sees a momentary caret
            // flicker on the thought input. (v0.1.69 cross-review W4)
            autoFocusInput={!!isActive && !pendingIntent?.autofocusSearch}
            onOpenRecord={onOpenRecord}
            activeRecordingSnapshot={activeRecordingSnapshot}
            onStartRecording={
              onStartRecording ? handleRequestRecording : undefined
            }
            recordingBusy={recordingRequestBusy}
          />
        </div>

        {/* Divider — weaker line-subtle (6% ink) so the two panels feel
            like a continuous surface rather than two pages cut apart.
            A full --line (10%) reads heavier than the card borders, which
            made the split feel over-emphasized. */}
        <div className="w-px bg-[var(--line-subtle)]" />

        {/* Right: Task list */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <TaskListPanel
            refreshKey={isActive ? '1' : '0'}
            pendingIntent={pendingIntent ?? null}
            onSearchIntentConsumed={onSearchIntentConsumed}
            pendingRoute={pendingRoute ?? null}
            onRouteConsumed={onRouteConsumed}
            onCreateTask={handleCreateTask}
          />
        </div>
      </div>}
    </div>
  );
}
