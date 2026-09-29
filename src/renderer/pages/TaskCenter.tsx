// TaskCenter — single-instance tab combining Thought stream (left) and Task list (right).
// PRD §5 / §6.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpen, Check, CircleCheck, MessageCircle, ThumbsDown, ThumbsUp } from 'lucide-react';
import { ThoughtPanel } from '@/components/task-center/ThoughtPanel';
import { TaskListPanel } from '@/components/task-center/TaskListPanel';
import RecordingSourceDialog from '@/components/task-center/RecordingSourceDialog';
import { taskCenterAvailable, taskGet } from '@/api/taskCenter';
import { speechModelPackStatus } from '@/api/recording';
import { track } from '@/analytics';
import { CUSTOM_EVENTS } from '@/../shared/constants';
import { useConfig } from '@/hooks/useConfig';
import { LEARNING_IMPORT_ERRORS, readLearningFolder, SAMPLE_LEARNING_CARDS, type LearningCard } from '@/components/task-center/learningCards';
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
  const [importedLessons, setImportedLessons] = useState<LearningCard[]>(() => {
    try {
      const value: unknown = JSON.parse(localStorage.getItem('myagents.learning.sources.v1') ?? '[]');
      return Array.isArray(value) ? value.filter((item): item is LearningCard => (
        item && typeof item === 'object' && typeof item.id === 'string' && typeof item.title === 'string' && typeof item.body === 'string'
      )) : [];
    } catch { return []; }
  });
  const [importingSources, setImportingSources] = useState(false);
  const [sourceImportError, setSourceImportError] = useState<string | null>(null);
  const [dailyPushTaskId, setDailyPushTaskId] = useState(() => {
    try { return localStorage.getItem('myagents.learning.dailyTaskId.v1') ?? ''; } catch { return ''; }
  });
  const sourceFolderInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const handleCreated = () => {
      try { setDailyPushTaskId(localStorage.getItem('myagents.learning.dailyTaskId.v1') ?? ''); } catch { /* The Task Center still owns the scheduled task. */ }
    };
    window.addEventListener(CUSTOM_EVENTS.LEARNING_DAILY_TASK_CREATED, handleCreated);
    return () => window.removeEventListener(CUSTOM_EVENTS.LEARNING_DAILY_TASK_CREATED, handleCreated);
  }, []);
  useEffect(() => {
    if (!dailyPushTaskId) return;
    let cancelled = false;
    void taskGet(dailyPushTaskId)
      .then((task) => {
        const activeStatuses = ['todo', 'running', 'verifying', 'blocked'];
        if (cancelled || (task?.executionMode === 'recurring' && !task.deleted && activeStatuses.includes(task.status))) return;
        try {
          if (localStorage.getItem('myagents.learning.dailyTaskId.v1') === dailyPushTaskId) {
            localStorage.removeItem('myagents.learning.dailyTaskId.v1');
          }
        } catch { /* Keep the current view usable when local storage is unavailable. */ }
        setDailyPushTaskId((current) => current === dailyPushTaskId ? '' : current);
      })
      .catch((error) => {
        console.warn('[TaskCenter] Failed to verify daily learning task:', error);
      });
    return () => { cancelled = true; };
  }, [activePanel, dailyPushTaskId, isActive]);
  const lessons = useMemo(() => [...SAMPLE_LEARNING_CARDS, ...importedLessons], [importedLessons]);
  const completedCount = lessons.filter((lesson) => completedLessons.includes(lesson.id)).length;

  const importSources = useCallback(async (files: FileList | null) => {
    if (!files?.length) return;
    setSourceImportError(null);
    setImportingSources(true);
    try {
      const incoming = await readLearningFolder(files);
      if (incoming.length === 0) throw new Error(LEARNING_IMPORT_ERRORS.noMarkdown);
      const merged = new Map(importedLessons.map((lesson) => [lesson.id, lesson]));
      for (const lesson of incoming) merged.set(lesson.id, lesson);
      const next = [...merged.values()].slice(-40);
      try { localStorage.setItem('myagents.learning.sources.v1', JSON.stringify(next)); } catch {
        throw new Error(LEARNING_IMPORT_ERRORS.storageFull);
      }
      setImportedLessons(next);
    } catch (error) {
      const reason = error instanceof Error ? error.message : '';
      setSourceImportError(Object.values(LEARNING_IMPORT_ERRORS).some((code) => code === reason)
        ? t(`learning.importErrors.${reason}`)
        : t('learning.importErrors.unknown'));
    } finally {
      setImportingSources(false);
    }
  }, [importedLessons, t]);

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
  const scheduleDailyLearning = useCallback(() => {
    const sourceNotes = importedLessons.slice(0, 5).map((lesson) => (
      `【${lesson.category}｜${lesson.title}】\n${lesson.body.slice(0, 1_200)}${lesson.sourceUrl ? `\n来源：${lesson.sourceUrl}` : ''}`
    )).join('\n\n');
    const prompt = [
      '你是我的每日碎片学习教练。每天生成一张新的 3–5 分钟学习卡片，主题覆盖产品经理（用户心理、行为、商业分析）、英语六级、财商与税务；按星期轮换主题，周末用复习或综合练习。',
      '卡片格式：主题与标题、一个讲清楚的知识点、一个贴近日常或工作的例子、一个今天能完成的小行动、一个等我回答的练习问题。总长控制在 350 个汉字内，英语练习可保留英文。',
      '优先使用下面的个人资料并注明来源；资料不足时可讲稳定的通用知识，但不要编造来源、链接、法律税务结论或个性化投资建议。涉及可能变化的规定时，明确提醒核对官方来源。',
      sourceNotes ? `个人资料快照（任务创建时导入，之后新增资料不会自动同步）：\n${sourceNotes}` : '目前没有导入个人资料；请基于可靠的通用知识生成内容，并明确不提供虚构引用。',
      '这是一条重复运行任务。每次只推送一张卡片，不要输出执行报告或任务管理说明。',
    ].join('\n\n');
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai';
    window.dispatchEvent(new CustomEvent(CUSTOM_EVENTS.OPEN_TASK_CREATE, {
      detail: {
        initialMode: 'manual',
        source: 'task-center',
        defaultWorkspacePath: config.defaultWorkspacePath,
        prefillName: '每日碎片学习',
        prefillTaskMd: prompt,
        initialExecutionMode: 'recurring',
        initialCronExpression: '0 9 * * *',
        initialCronTimezone: timezone,
        learningDailyPush: true,
      } satisfies TaskCreateRequest,
    }));
  }, [config.defaultWorkspacePath, importedLessons]);
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
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-[var(--ink-muted)]">{t('learning.sourceImportHint')}</p>
                <button type="button" disabled={importingSources} onClick={() => sourceFolderInputRef.current?.click()} className="rounded-lg border border-[var(--line)] px-3 py-2 text-sm text-[var(--ink)] hover:bg-[var(--hover-bg)] disabled:opacity-50">{importingSources ? t('learning.importing') : t('learning.importFolder')}</button>
                <input ref={(element) => { sourceFolderInputRef.current = element; element?.setAttribute('webkitdirectory', ''); }} type="file" multiple accept=".md,text/markdown" className="hidden" onChange={(event) => { void importSources(event.currentTarget.files); event.currentTarget.value = ''; }} />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-[var(--line-subtle)] pt-3">
                {dailyPushTaskId ? <>
                  <span className="rounded-md bg-[var(--success-bg)] px-2 py-1 text-sm text-[var(--on-success)]">{t('learning.dailyPushCreated')}</span>
                  <button type="button" onClick={() => setActivePanel('tasks')} className="text-sm text-[var(--accent)] hover:underline">{t('learning.openTasks')}</button>
                </> : <>
                  <button type="button" onClick={scheduleDailyLearning} className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-[var(--on-accent)]">{t('learning.scheduleDaily')}</button>
                  <span className="text-xs text-[var(--ink-muted)]">{t('learning.scheduleHint')}</span>
                </>}
              </div>
              {sourceImportError && <p role="alert" className="mt-2 text-sm text-[var(--error)]">{sourceImportError}</p>}
            </section>
            <div className="grid gap-4 md:grid-cols-2">
              {lessons.map((lesson) => {
                const done = completedLessons.includes(lesson.id);
                return <article key={lesson.id} className="rounded-2xl border border-[var(--line)] bg-[var(--paper-elevated)] p-5">
                  <div className="flex items-center justify-between text-xs text-[var(--ink-muted)]"><span className="rounded-full bg-[var(--paper-inset)] px-2.5 py-1">{lesson.category}</span><span>{lesson.time}</span></div>
                  <h3 className="mt-4 text-base font-semibold leading-6 text-[var(--ink)]">{lesson.title}</h3>
                  {lesson.sourcePath && <p className="mt-1 truncate text-xs text-[var(--ink-muted)]" title={lesson.sourcePath}>{t('learning.sourceFrom', { source: lesson.sourceLabel, path: lesson.sourcePath })}</p>}
                  {lesson.sourceUrl && <a href={lesson.sourceUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-[var(--accent)] hover:underline">{t('learning.openSource')}</a>}
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
