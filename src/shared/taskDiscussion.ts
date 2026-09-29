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
  learningDailyPush?: boolean;
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
