// TaskCenter — single-instance tab combining Thought stream (left) and Task list (right).
// PRD §5 / §6.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpen, Check, CircleCheck, MessageCircle, ThumbsDown, ThumbsUp } from 'lucide-react';
import CustomSelect, { type SelectOption } from '@/components/CustomSelect';
import { ThoughtPanel } from '@/components/task-center/ThoughtPanel';
import { TaskListPanel } from '@/components/task-center/TaskListPanel';
import RecordingSourceDialog from '@/components/task-center/RecordingSourceDialog';
import { taskCenterAvailable, taskGet } from '@/api/taskCenter';
import { speechModelPackStatus } from '@/api/recording';
import { track } from '@/analytics';
import { CUSTOM_EVENTS } from '@/../shared/constants';
import { useConfig } from '@/hooks/useConfig';
import { LEARNING_IMPORT_ERRORS, validateLearningSourceFiles } from '@/components/task-center/learningCards';
import {
  applyCardUiPatch,
  encodeTextBase64,
  useLearningCards,
  useLearningRecentChanges,
  useLearningWorkspace,
  type WorkspaceLearningCard,
} from '@/components/task-center/learningWorkspace';
import { ensureLearningWorkspace } from '@/config/services/appConfigService';
import type { Thought } from '@/../shared/types/thought';
import type { TaskCreateRequest } from '@/../shared/taskDiscussion';
import type { PendingAppRoute } from '@/../shared/appRoute';
import type {
  RecordSummary,
  RecordingSnapshot,
  RecordingSourceSelection,
} from '@/../shared/types/record';
import { workspacePathsEqual } from '@/../shared/workspacePath';

const LEARNING_DAILY_TASK_REF_KEY = 'myagents.learning.dailyTaskId.v1';

function readLearningDailyTaskId(workspacePath: string | null): string {
  try {
    const raw = localStorage.getItem(LEARNING_DAILY_TASK_REF_KEY);
    if (!raw) return '';
    try {
      const parsed = JSON.parse(raw) as {
        byWorkspace?: Record<string, unknown>;
        id?: unknown;
        workspacePath?: unknown;
      };
      if (parsed.byWorkspace && typeof parsed.byWorkspace === 'object') {
        const match = Object.entries(parsed.byWorkspace).find(([path]) =>
          workspacePath && workspacePathsEqual(path, workspacePath),
        );
        return typeof match?.[1] === 'string' ? match[1] : '';
      }
      if (typeof parsed.id === 'string' && typeof parsed.workspacePath === 'string') {
        return workspacePath && workspacePathsEqual(parsed.workspacePath, workspacePath)
          ? parsed.id
          : '';
      }
    } catch {
      // Older releases stored only the TaskStore ID. Verify its workspace below.
    }
    return raw;
  } catch {
    return '';
  }
}

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
  const { config, updateConfig, refreshConfig } = useConfig();
  const [recordingRequestBusy, setRecordingRequestBusy] = useState(false);
  const [activePanel, setActivePanel] = useState<'tasks' | 'learning'>('tasks');

  // Learning data lives in the learning workspace (system preset). The agent
  // owns card content; the UI owns only status/feedback frontmatter fields
  // and writes them through CAS saveFile (see learningWorkspace.ts).
  const {
    path: learningWorkspacePath,
    projects: learningWorkspaces = [],
    project: learningWorkspace,
    requiresSelection: learningWorkspaceRequiresSelection = false,
    select: selectLearningWorkspace = async () => {},
  } = useLearningWorkspace();
  const {
    cards: learningCards,
    loading: learningLoading,
    error: learningLoadError,
    refresh: refreshLearningCards,
    fileService: learningFileService,
  } = useLearningCards(learningWorkspacePath, isActive ?? false);
  type CardUiPatch = { status?: 'new' | 'learned'; feedback?: 'useful' | 'skip' | null };
  const [uiPatchSnapshot, setUiPatchSnapshot] = useState<{
    workspacePath: string | null;
    patches: Record<string, CardUiPatch>;
  }>(() => ({ workspacePath: learningWorkspacePath, patches: {} }));
  const uiPatches = useMemo(
    () => uiPatchSnapshot.workspacePath === learningWorkspacePath ? uiPatchSnapshot.patches : {},
    [learningWorkspacePath, uiPatchSnapshot],
  );
  const setUiPatches = useCallback((update: (previous: Record<string, CardUiPatch>) => Record<string, CardUiPatch>) => {
    setUiPatchSnapshot((previous) => ({
      workspacePath: learningWorkspacePath,
      patches: update(previous.workspacePath === learningWorkspacePath ? previous.patches : {}),
    }));
  }, [learningWorkspacePath]);
  const [importingSources, setImportingSources] = useState(false);
  const [sourceImportError, setSourceImportError] = useState<string | null>(null);
  const [learningSyncError, setLearningSyncError] = useState<string | null>(null);
  // Watcher events carry both agent writes and this panel's own frontmatter
  // saves; remember what we wrote ourselves so the "AI 最近更新" hint stays
  // honest. The Rust watcher debounces 5s, so the window is generous.
  const uiWriteTimestampsRef = useRef<Map<string, number>>(new Map());
  const recentChanges = useLearningRecentChanges(learningWorkspacePath, isActive ?? false);
  const agentRecentChanges = useMemo(
    () => recentChanges.filter((path) => {
      const writtenAt = uiWriteTimestampsRef.current.get(path);
      return !writtenAt || Date.now() - writtenAt > 15_000;
    }),
    [recentChanges],
  );
  const [dailyPushTaskId, setDailyPushTaskId] = useState(() => {
    return readLearningDailyTaskId(learningWorkspacePath);
  });
  const sourceFolderInputRef = useRef<HTMLInputElement>(null);
  // Learning state moved into the learning workspace files; sweep the three
  // retired WebView-local keys once so stale data can't mislead a rollback.
  // dailyTaskId.v1 stays — it is the UI pointer to the TaskStore-owned task.
  useEffect(() => {
    for (const key of ['myagents.learning.completed.v1', 'myagents.learning.feedback.v1', 'myagents.learning.sources.v1']) {
      try { localStorage.removeItem(key); } catch { /* storage unavailable — nothing to sweep */ }
    }
  }, []);
  useEffect(() => {
    setDailyPushTaskId(readLearningDailyTaskId(learningWorkspacePath));
  }, [learningWorkspacePath]);
  useEffect(() => {
    const handleCreated = () => {
      setDailyPushTaskId(readLearningDailyTaskId(learningWorkspacePath));
    };
    window.addEventListener(CUSTOM_EVENTS.LEARNING_DAILY_TASK_CREATED, handleCreated);
    return () => window.removeEventListener(CUSTOM_EVENTS.LEARNING_DAILY_TASK_CREATED, handleCreated);
  }, [learningWorkspacePath]);
  useEffect(() => {
    if (!dailyPushTaskId) return;
    let cancelled = false;
    void taskGet(dailyPushTaskId)
      .then((task) => {
        const activeStatuses = ['todo', 'running', 'verifying', 'blocked'];
        if (!cancelled && task?.workspacePath && learningWorkspacePath && !workspacePathsEqual(task.workspacePath, learningWorkspacePath)) {
          setDailyPushTaskId((current) => current === dailyPushTaskId ? '' : current);
          return;
        }
        if (cancelled || (task?.executionMode === 'recurring' && !task.deleted && activeStatuses.includes(task.status))) return;
        try {
          const raw = localStorage.getItem(LEARNING_DAILY_TASK_REF_KEY);
          let removeWholeReference = raw === dailyPushTaskId;
          try {
            const parsed = JSON.parse(raw ?? '') as {
              byWorkspace?: Record<string, unknown>;
              id?: unknown;
            };
            if (parsed.id === dailyPushTaskId) removeWholeReference = true;
            if (parsed.byWorkspace) {
              const next = Object.fromEntries(Object.entries(parsed.byWorkspace)
                .filter(([, id]) => id !== dailyPushTaskId));
              if (Object.keys(next).length === 0) removeWholeReference = true;
              else localStorage.setItem(LEARNING_DAILY_TASK_REF_KEY, JSON.stringify({ byWorkspace: next }));
            }
          } catch { /* Backward-compatible legacy raw task ID. */ }
          if (removeWholeReference) {
            localStorage.removeItem(LEARNING_DAILY_TASK_REF_KEY);
          }
        } catch { /* Keep the current view usable when local storage is unavailable. */ }
        setDailyPushTaskId((current) => current === dailyPushTaskId ? '' : current);
      })
      .catch((error) => {
        console.warn('[TaskCenter] Failed to verify daily learning task:', error);
      });
    return () => { cancelled = true; };
  }, [activePanel, dailyPushTaskId, isActive, learningWorkspacePath]);
  const lessons = useMemo(
    () => learningCards.map((card) => (uiPatches[card.filePath] ? { ...card, ...uiPatches[card.filePath] } : card)),
    [learningCards, uiPatches],
  );
  const learningWorkspaceOptions = useMemo<SelectOption[]>(
    () => learningWorkspaces.map((workspace) => ({
      value: workspace.id,
      label: workspace.displayName || workspace.name,
    })),
    [learningWorkspaces],
  );
  const completedCount = lessons.filter((lesson) => lesson.status === 'learned').length;

  const importSources = useCallback(async (files: FileList | null) => {
    if (!files?.length) return;
    if (!learningWorkspacePath || !learningFileService.isAvailable) {
      setSourceImportError(t('learning.workspaceMissing'));
      return;
    }
    setSourceImportError(null);
    setImportingSources(true);
    try {
      const incoming = validateLearningSourceFiles(files);
      if (incoming.length === 0) throw new Error(LEARNING_IMPORT_ERRORS.noMarkdown);
      const payload = await Promise.all(incoming.map(async (file) => ({
        name: file.name,
        content: encodeTextBase64(await file.text()),
      })));
      const result = await learningFileService.importBase64Files({ files: payload, targetDir: 'inbox' });
      if (!result.success || result.files.length === 0) throw new Error(LEARNING_IMPORT_ERRORS.storageFull);
    } catch (error) {
      const reason = error instanceof Error ? error.message : '';
      setSourceImportError(Object.values(LEARNING_IMPORT_ERRORS).some((code) => code === reason)
        ? t(`learning.importErrors.${reason}`)
        : t('learning.importErrors.unknown'));
    } finally {
      setImportingSources(false);
    }
  }, [learningFileService, learningWorkspacePath, t]);

  const writeCardPatch = useCallback(async (
    card: WorkspaceLearningCard,
    patch: { status?: 'new' | 'learned'; feedback?: 'useful' | 'skip' | null },
  ) => {
    setLearningSyncError(null);
    uiWriteTimestampsRef.current.set(card.filePath, Date.now());
    setUiPatches((prev) => ({ ...prev, [card.filePath]: { ...(prev[card.filePath] ?? {}), ...patch } }));
    const clearPatch = () => setUiPatches((prev) => {
      if (!prev[card.filePath]) return prev;
      const next = { ...prev };
      delete next[card.filePath];
      return next;
    });
    try {
      await learningFileService.saveFile({
        path: card.filePath,
        content: applyCardUiPatch(card.raw, patch),
        expectedContent: card.raw,
      });
      await refreshLearningCards();
      clearPatch();
      return;
    } catch {
      // CAS conflict (the agent rewrote the card) or transient IO — refetch
      // the disk truth and retry exactly once before surfacing an error.
    }
    try {
      const preview = await learningFileService.readPreview({ path: card.filePath });
      await learningFileService.saveFile({
        path: card.filePath,
        content: applyCardUiPatch(preview.content, patch),
        expectedContent: preview.content,
      });
      await refreshLearningCards();
      clearPatch();
    } catch (error) {
      clearPatch();
      await refreshLearningCards().catch(() => {});
      setLearningSyncError(error instanceof Error ? error.message : String(error));
      console.warn('[TaskCenter] Failed to persist learning card patch:', error);
    }
  }, [learningFileService, refreshLearningCards, setUiPatches]);

  const toggleLessonComplete = useCallback((lesson: WorkspaceLearningCard) => {
    void writeCardPatch(lesson, { status: lesson.status === 'learned' ? 'new' : 'learned' });
  }, [writeCardPatch]);

  const saveLessonFeedback = useCallback((lesson: WorkspaceLearningCard, feedback: 'useful' | 'skip') => {
    void writeCardPatch(lesson, { feedback: lesson.feedback === feedback ? null : feedback });
  }, [writeCardPatch]);

  const handleRecreateLearningWorkspace = useCallback(async () => {
    try {
      await ensureLearningWorkspace();
      await refreshConfig();
      await refreshLearningCards();
    } catch (error) {
      console.warn('[TaskCenter] Failed to recreate learning workspace:', error);
    }
  }, [refreshConfig, refreshLearningCards]);

  const discussLesson = useCallback((lesson: WorkspaceLearningCard) => {
    const content = lesson.prompt || `请带我学习「${lesson.title}」：先问我一个问题，根据我的回答继续追问，最后检查我是否理解。`;
    window.dispatchEvent(new CustomEvent(CUSTOM_EVENTS.OPEN_AI_DISCUSSION, {
      detail: { content, workspaceId: learningWorkspace?.id, learningMode: true },
    }));
  }, [learningWorkspace?.id]);
  const scheduleDailyLearning = useCallback(() => {
    if (!learningWorkspacePath) return;
    // Thin prompt: the workspace CLAUDE.md contract carries the card
    // protocol, and rules/cards/topics are injected live at run time —
    // no source snapshot is frozen into the task.
    const prompt = [
      '执行「每日碎片学习」流程：按工作区 CLAUDE.md 的每日卡片协议，先读 .claude/rules/04-LEARNING-STATE.md、cards/ 最近卡片与 topics/，再生成今天的一张 3–5 分钟学习卡片。',
      '把卡片写入 cards/YYYY-MM-DD-<slug>.md（标准 frontmatter，related 填写与既有知识点/卡片的关联），并更新 04-LEARNING-STATE.md 与相关主题文件。',
      '回复内容即推送内容：仅输出卡片正文（350 个汉字内，英语练习可保留英文），不要输出执行报告或任务管理说明。',
      '不要编造来源、链接、法律税务结论或个性化投资建议；涉及可能变化的规定时提醒核对官方来源。',
    ].join('\n\n');
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai';
    window.dispatchEvent(new CustomEvent(CUSTOM_EVENTS.OPEN_TASK_CREATE, {
      detail: {
        initialMode: 'manual',
        source: 'task-center',
        defaultWorkspacePath: learningWorkspacePath,
        lockWorkspace: true,
        initialAiCanExit: false,
        prefillName: '每日碎片学习',
        prefillTaskMd: prompt,
        initialExecutionMode: 'recurring',
        initialCronExpression: '0 9 * * *',
        initialCronTimezone: timezone,
        learningDailyPush: true,
      } satisfies TaskCreateRequest,
    }));
  }, [learningWorkspacePath]);
  const scheduleWeeklyReview = useCallback(() => {
    if (!learningWorkspacePath) return;
    // Same thin-prompt pattern as the daily push: the CLAUDE.md weekly-review
    // protocol carries the process; no snapshot, no new scheduling concepts.
    const prompt = [
      '执行「每周学习复盘」流程：按工作区 CLAUDE.md 的周复盘协议，读取 .claude/rules/04-LEARNING-STATE.md、03-USER.md 的学习目标、本周 cards/、assessments/ 与 mistakes/，对照计划与实际，识别进展、阻塞、重复错误与能力缺口，决定下周继续/停止/调整的方向。',
      '把复盘写入 reviews/weekly/YYYY-Www.md（标准 frontmatter），并按反囤积纪律更新 04-LEARNING-STATE.md。',
      '回复内容即复盘摘要（300 字内），不要输出执行报告或任务管理说明。',
    ].join('\n\n');
    window.dispatchEvent(new CustomEvent(CUSTOM_EVENTS.OPEN_TASK_CREATE, {
      detail: {
        initialMode: 'manual',
        source: 'task-center',
        defaultWorkspacePath: learningWorkspacePath,
        lockWorkspace: true,
        initialAiCanExit: false,
        prefillName: '每周学习复盘',
        prefillTaskMd: prompt,
        initialExecutionMode: 'recurring',
        initialCronExpression: '30 21 * * 0',
        initialCronTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai',
      } satisfies TaskCreateRequest,
    }));
  }, [learningWorkspacePath]);
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
        !learningWorkspacePath ? (
          <div className="flex min-h-0 flex-1 items-center justify-center px-8">
            <div className="max-w-md text-center">
              {learningWorkspaceRequiresSelection ? <>
                <p className="text-sm text-[var(--ink-secondary)]">{t('learning.chooseWorkspace')}</p>
                <label className="mt-4 flex flex-col gap-2 text-left text-sm text-[var(--ink-muted)]">
                  <span>{t('learning.workspaceLabel')}</span>
                  <CustomSelect
                    value=""
                    options={learningWorkspaceOptions}
                    onChange={(projectId) => { void selectLearningWorkspace(projectId); }}
                    placeholder={t('learning.chooseWorkspaceOption')}
                    ariaLabel={t('learning.workspaceLabel')}
                    size="md"
                    className="min-w-64"
                  />
                </label>
              </> : <>
                <p className="text-sm text-[var(--ink-secondary)]">{t('learning.workspaceMissing')}</p>
                <button type="button" onClick={() => { void handleRecreateLearningWorkspace(); }} className="mt-4 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--on-accent)]">{t('learning.workspaceMissingAction')}</button>
              </>}
            </div>
          </div>
        ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-8">
          <div className="mx-auto max-w-4xl">
            <section className="mb-5 rounded-2xl border border-[var(--line)] bg-[var(--paper-elevated)] p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm text-[var(--ink-muted)]">{t('learning.dailyTagline')}</p>
                  <h2 className="mt-1 text-lg font-semibold text-[var(--ink)]">{t('learning.dailyTitle')}</h2>
                  <p className="mt-1 text-sm text-[var(--ink-muted)]">{t('learning.progress', { completed: completedCount, total: lessons.length })}</p>
                  {learningWorkspaces.length > 1 && <label className="mt-3 flex flex-wrap items-center gap-2 text-sm text-[var(--ink-muted)]">
                    <span>{t('learning.workspaceLabel')}</span>
                    <CustomSelect
                      value={learningWorkspace?.id ?? ''}
                      options={learningWorkspaceOptions}
                      onChange={(projectId) => { void selectLearningWorkspace(projectId); }}
                      ariaLabel={t('learning.workspaceLabel')}
                      size="toolbar"
                      className="max-w-xs"
                    />
                  </label>}
                </div>
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]"><BookOpen className="h-5 w-5" /></div>
              </div>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-[var(--paper-inset)]"><div className="h-full rounded-full bg-[var(--accent)] transition-all" style={{ width: `${lessons.length ? (completedCount / lessons.length) * 100 : 0}%` }} /></div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-[var(--ink-muted)]">{t('learning.sourceImportHint')}</p>
                <button type="button" disabled={importingSources || !learningFileService.isAvailable} onClick={() => sourceFolderInputRef.current?.click()} className="rounded-lg border border-[var(--line)] px-3 py-2 text-sm text-[var(--ink)] hover:bg-[var(--hover-bg)] disabled:opacity-50">{importingSources ? t('learning.importing') : t('learning.importFolder')}</button>
                <input ref={(element) => { sourceFolderInputRef.current = element; element?.setAttribute('webkitdirectory', ''); }} type="file" multiple accept=".md,text/markdown" className="hidden" onChange={(event) => { void importSources(event.currentTarget.files); event.currentTarget.value = ''; }} />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-[var(--line-subtle)] pt-3">
                {dailyPushTaskId ? <>
                  <span className="rounded-md bg-[var(--success-bg)] px-2 py-1 text-sm text-[var(--on-success)]">{t('learning.dailyPushCreated')}</span>
                  <button type="button" onClick={() => window.dispatchEvent(new CustomEvent(CUSTOM_EVENTS.OPEN_TASK_CENTER))} className="text-sm text-[var(--accent)] hover:underline">{t('learning.openTasks')}</button>
                </> : <>
                  <button type="button" onClick={scheduleDailyLearning} className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-[var(--on-accent)]">{t('learning.scheduleDaily')}</button>
                  <span className="text-xs text-[var(--ink-muted)]">{t('learning.scheduleHint')}</span>
                </>}
                <button type="button" onClick={scheduleWeeklyReview} className="rounded-lg border border-[var(--line)] px-3 py-2 text-sm text-[var(--ink)] hover:bg-[var(--hover-bg)]">{t('learning.scheduleWeekly')}</button>
              </div>
              {agentRecentChanges.length > 0 && (
                <p className="mt-2 text-xs leading-6 text-[var(--ink-muted)]">
                  {t('learning.recentUpdates')}
                  {agentRecentChanges.map((path) => (
                    <button
                      key={path}
                      type="button"
                      title={path}
                      onClick={() => { void learningFileService.openWithDefault({ path }); }}
                      className="mx-1 rounded-md bg-[var(--paper-inset)] px-1.5 py-0.5 text-[var(--ink-secondary)] hover:text-[var(--ink)]"
                    >
                      {path.split('/').pop()?.replace(/\.md$/, '') ?? path}
                    </button>
                  ))}
                </p>
              )}
              {sourceImportError && <p role="alert" className="mt-2 text-sm text-[var(--error)]">{sourceImportError}</p>}
              {learningSyncError && <p role="alert" className="mt-2 text-sm text-[var(--error)]">{t('learning.syncConflict')}</p>}
              {learningLoadError && <p role="alert" className="mt-2 text-sm text-[var(--error)]">{learningLoadError}</p>}
            </section>
            {learningLoading && lessons.length === 0 ? (
              <p className="py-8 text-center text-sm text-[var(--ink-muted)]">{t('learning.loadingCards')}</p>
            ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {lessons.map((lesson) => {
                const done = lesson.status === 'learned';
                return <article key={lesson.filePath} className="rounded-2xl border border-[var(--line)] bg-[var(--paper-elevated)] p-5">
                  <div className="flex items-center justify-between text-xs text-[var(--ink-muted)]"><span className="rounded-full bg-[var(--paper-inset)] px-2.5 py-1">{lesson.category}</span><span>{lesson.date} · {lesson.time}</span></div>
                  <h3 className="mt-4 text-base font-semibold leading-6 text-[var(--ink)]">{lesson.title}</h3>
                  {lesson.sourceUrl && <a href={lesson.sourceUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-[var(--accent)] hover:underline">{t('learning.openSource')}</a>}
                  <p className="mt-2 text-sm leading-6 text-[var(--ink-secondary)]">{lesson.body}</p>
                  <div className="mt-4 rounded-xl bg-[var(--paper-inset)] p-3"><p className="text-xs font-medium text-[var(--ink-muted)]">{t('learning.tryNow')}</p><p className="mt-1 text-sm leading-5 text-[var(--ink)]">{lesson.action}</p></div>
                  {lesson.related.length > 0 && (
                    <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-[var(--ink-muted)]">
                      <span>{t('learning.relatedLabel')}</span>
                      {lesson.related.map((link) => (
                        <span key={link} title={link} className="max-w-[16rem] truncate rounded-full bg-[var(--paper-inset)] px-2 py-0.5">{link.split('/').pop()?.replace(/\.md$/, '') ?? link}</span>
                      ))}
                    </div>
                  )}
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <button type="button" onClick={() => toggleLessonComplete(lesson)} className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium ${done ? 'bg-[var(--success-bg)] text-[var(--on-success)]' : 'bg-[var(--accent)] text-[var(--on-accent)]'}`}>{done ? <CircleCheck className="h-4 w-4" /> : <Check className="h-4 w-4" />}{done ? t('learning.completed') : t('learning.markComplete')}</button>
                    <button type="button" onClick={() => discussLesson(lesson)} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--line)] px-3 py-2 text-sm text-[var(--ink)] hover:bg-[var(--hover-bg)]"><MessageCircle className="h-4 w-4" />{t('learning.discuss')}</button>
                    <span className="ml-auto flex gap-1">
                      <button type="button" aria-label={t('learning.feedbackUseful')} aria-pressed={lesson.feedback === 'useful'} onClick={() => saveLessonFeedback(lesson, 'useful')} className={`rounded-md p-2 ${lesson.feedback === 'useful' ? 'text-[var(--accent)]' : 'text-[var(--ink-muted)]'}`}><ThumbsUp className="h-4 w-4" /></button>
                      <button type="button" aria-label={t('learning.feedbackSkip')} aria-pressed={lesson.feedback === 'skip'} onClick={() => saveLessonFeedback(lesson, 'skip')} className={`rounded-md p-2 ${lesson.feedback === 'skip' ? 'text-[var(--accent)]' : 'text-[var(--ink-muted)]'}`}><ThumbsDown className="h-4 w-4" /></button>
                    </span>
                  </div>
                </article>;
              })}
            </div>
            )}
          </div>
        </div>
        )
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
