import type { TaskExecutionMode } from './types/task';

export type TaskCreateMode = 'smart' | 'manual';

export type TaskCreateSource = 'sidebar' | 'task-center' | 'thought';

export interface TaskCreateIntent {
  id: string;
  initialMode: TaskCreateMode;
  source: TaskCreateSource;
  defaultWorkspacePath?: string;
  currentSessionId?: string | null;
  thought?: {
    id: string;
    content: string;
    tags: string[];
  };
  /** Optional learning flow defaults for the existing Task creation surface. */
  prefillName?: string;
  prefillTaskMd?: string;
  initialExecutionMode?: TaskExecutionMode;
  initialIntervalMinutes?: number;
  initialCronExpression?: string;
  initialCronTimezone?: string;
  /** Prefills the dialog's "AI may end this task itself" end condition.
   *  Habit-style recurring tasks (learning daily push / weekly review) pass
   *  false: every wake would otherwise carry the task-exit prompt, inviting
   *  the model to terminate an indefinite routine. */
  initialAiCanExit?: boolean;
  learningDailyPush?: boolean;
  /** Keep the task pinned to `defaultWorkspacePath` — the learning daily
   *  push must run inside the learning workspace so its contract and files
   *  are live context. Renders the dialog's workspace selector disabled. */
  lockWorkspace?: boolean;
}

export type TaskCreateRequest = Omit<TaskCreateIntent, 'id'>;

export interface TaskDiscussionRequest {
  content: string;
  workspaceId: string;
  workspacePath: string;
  sourceRecordId?: string;
}

export interface PreparedTaskDiscussion {
  discussionId: string;
  discussionDir: string;
  candidatesDir: string;
}
