import { createContext } from 'react';
import type { useWorkspaceFileService } from '@/hooks/useWorkspaceFileService';

/** Presentation only: files own card content; the existing Chat owns sends. */
export interface LearningChatState {
  workspacePath: string;
  sessionId?: string;
  fileService: ReturnType<typeof useWorkspaceFileService>;
  isActive: boolean;
  isBusy: boolean;
  changeSignal: number;
  discuss: (text: string) => Promise<boolean | void>;
}

export const LearningChatContext = createContext<LearningChatState | null>(null);
