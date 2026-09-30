import { useEffect, useEffectEvent, useState } from 'react';

import type { WorkspacePathMove } from '@/utils/workspacePathMoves';
import { listenWithCleanup } from '@/utils/tauriListen';
import { useWorkspaceFileService } from './useWorkspaceFileService';

/**
 * Ref-counted workspace filesystem change signal.
 *
 * The existing `workspace:files-changed:<eventKey>` channel carries coarse
 * OS changes or exact committed app moves. Deliver identity changes before
 * consumers revalidate the tree / currently open file.
 */
export function useWorkspaceChangeSignal(
  workspacePath: string | null,
  enabled = true,
  onPathsMoved?: (moves: WorkspacePathMove[]) => void,
  onPathsChanged?: (paths: string[]) => void,
): number {
  const fileService = useWorkspaceFileService(workspacePath);
  const [signal, setSignal] = useState(0);
  const deliverMoves = useEffectEvent((moves: WorkspacePathMove[]) => {
    onPathsMoved?.(moves);
  });
  const deliverPaths = useEffectEvent((paths: string[]) => {
    onPathsChanged?.(paths);
  });

  useEffect(() => {
    if (!enabled || !fileService.isAvailable) return;

    const ac = new AbortController();
    let mounted = true;
    let token: string | null = null;

    (async () => {
      try {
        const handle = await fileService.watchStart();
        if (ac.signal.aborted) {
          await fileService.watchStop({ token: handle.token }).catch(() => {});
          return;
        }
        token = handle.token;
        await listenWithCleanup<string | { moves: WorkspacePathMove[] } | { paths: string[] }>(`workspace:files-changed:${handle.eventKey}`, (event) => {
          if (!mounted) return;
          if (typeof event.payload === 'object' && event.payload !== null) {
            if ('moves' in event.payload && Array.isArray(event.payload.moves)) {
              deliverMoves(event.payload.moves);
            } else if ('paths' in event.payload && Array.isArray(event.payload.paths)) {
              deliverPaths(event.payload.paths);
            }
          }
          setSignal((prev) => prev + 1);
        }, ac.signal);
      } catch (err) {
        console.warn('[useWorkspaceChangeSignal] watch start failed:', err);
      }
    })();

    return () => {
      mounted = false;
      ac.abort();
      if (token) {
        fileService.watchStop({ token }).catch(() => {});
      }
    };
  }, [enabled, fileService]);

  return signal;
}
