/**
 * Pure serialize/parse for per-table view state persisted to localStorage
 * (U2, KTD-7). No React, no DOM — the `useTableViewState` hook wraps these and
 * owns the actual `window.localStorage` reads/writes. Kept under `src/` so the
 * `bun test src` harness (the only unit harness this repo has) covers the
 * fail-safe path.
 *
 * Storage envelope: `{ version: 1, state: T }` under key
 * `magstacker:table:<tableId>:v1`. Any malformed, wrong-version, or
 * non-envelope input is discarded and the caller's defaults are returned —
 * never throws (R3/KTD-7 fail-safe).
 */

/** Schema version embedded in the stored envelope; bump to invalidate old entries. */
export const VIEW_STATE_VERSION = 1;

/** localStorage key for a table's persisted view state (KTD-7). */
export function viewStateStorageKey(tableId: string): string {
  return `magstacker:table:${tableId}:v1`;
}

interface ViewStateEnvelope<T> {
  version: number;
  state: T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Parse a stored envelope back into a view state, falling back to `defaults`
 * for any missing field (forward-compatible) and for any malformed input.
 * Returns a new object; never mutates `defaults`.
 */
export function parseViewState<T extends object>(
  raw: string | null,
  defaults: T,
): T {
  if (raw === null) {
    return { ...defaults };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...defaults };
  }

  if (!isRecord(parsed)) {
    return { ...defaults };
  }
  const envelope = parsed as Partial<ViewStateEnvelope<unknown>>;
  if (envelope.version !== VIEW_STATE_VERSION || !isRecord(envelope.state)) {
    return { ...defaults };
  }

  return { ...defaults, ...(envelope.state as Partial<T>) };
}

/** Serialize a view state into a versioned envelope for storage (KTD-7). */
export function serializeViewState<T>(state: T): string {
  const envelope: ViewStateEnvelope<T> = {
    version: VIEW_STATE_VERSION,
    state,
  };
  return JSON.stringify(envelope);
}
