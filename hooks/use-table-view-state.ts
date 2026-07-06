"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  parseViewState,
  serializeViewState,
  viewStateStorageKey,
} from "@/src/domain/tables/view-state-storage";

export interface UseTableViewStateResult<T> {
  /** Current view state: `defaults` until mounted, then the persisted value. */
  viewState: T;
  /** Persist a new view state (immutable) and mirror it to localStorage. */
  setViewState: (next: T) => void;
  /**
   * `false` on the server and first client render, `true` after mount. The
   * shared `DataTable` renders a neutral skeleton while `false` so the restored
   * settings apply on the first real paint with no defaults-then-swap flash
   * (R3/KTD-7, mirroring `theme-toggle.tsx`).
   */
  mounted: boolean;
}

/**
 * Per-table view-state persistence (U2). Reads the saved state for `tableId`
 * from localStorage once on mount (never during SSR/first paint, to avoid a
 * hydration mismatch) and writes every subsequent change back. Storage failures
 * (private mode, quota) are swallowed — the in-memory state stays authoritative
 * so the table keeps working (fail-safe per KTD-7).
 */
export function useTableViewState<T extends object>(
  tableId: string,
  defaults: T,
): UseTableViewStateResult<T> {
  // Defaults are static per table; capture once so the mount effect can depend
  // only on `tableId` without re-running when a new `defaults` object identity
  // arrives on re-render.
  const defaultsRef = useRef(defaults);
  const [viewState, setInternal] = useState<T>(defaultsRef.current);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(viewStateStorageKey(tableId));
    } catch {
      // Storage unavailable (Safari private mode, blocked storage) — fall
      // back to defaults rather than leaving `mounted` stuck false.
    }
    setInternal(parseViewState(raw, defaultsRef.current));
    setMounted(true);
  }, [tableId]);

  const setViewState = useCallback(
    (next: T) => {
      setInternal(next);
      try {
        window.localStorage.setItem(
          viewStateStorageKey(tableId),
          serializeViewState(next),
        );
      } catch {
        // Storage unavailable or full — keep the in-memory state, never throw.
      }
    },
    [tableId],
  );

  return { viewState, setViewState, mounted };
}
