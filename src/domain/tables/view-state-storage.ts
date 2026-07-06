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
  return `magstacker:table:${tableId}:v${VIEW_STATE_VERSION}`;
}

interface ViewStateEnvelope<T> {
  version: number;
  state: T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * A plain object we deep-merge — NOT an array. Arrays (e.g. `sorting`, a
 * `SortingState`) must be replaced wholesale, never spread key-by-key (which
 * would turn `[{…}]` into `{ "0": {…} }`).
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && !Array.isArray(value);
}

/**
 * Merge stored state over defaults ONE LEVEL DEEP: a nested plain-object field
 * (e.g. `columnVisibility`, `filters`) is spread-merged with its default rather
 * than replaced wholesale, so keys the current defaults gained since the entry
 * was written (a new opt-in column, a new filter field) keep their default —
 * without a version bump. A flat spread would drop them, silently shipping a
 * new opt-in column as visible for returning users (KTD-4 regression).
 */
function mergeOverDefaults<T extends object>(
  defaults: T,
  state: Partial<T>,
): T {
  const result: T = { ...defaults };
  for (const key of Object.keys(state) as (keyof T)[]) {
    const stored = state[key];
    if (stored === undefined) {
      continue;
    }
    const fallback = defaults[key];
    result[key] =
      isPlainObject(stored) && isPlainObject(fallback)
        ? ({ ...fallback, ...stored } as T[keyof T])
        : (stored as T[keyof T]);
  }
  return result;
}

/**
 * Parse a stored envelope back into a view state, falling back to `defaults`
 * for any missing field (forward-compatible, one level deep) and for any
 * malformed input. Returns a new object; never mutates `defaults`.
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
  if (
    envelope.version !== VIEW_STATE_VERSION ||
    !isPlainObject(envelope.state)
  ) {
    return { ...defaults };
  }

  return mergeOverDefaults(defaults, envelope.state as Partial<T>);
}

/** Serialize a view state into a versioned envelope for storage (KTD-7). */
export function serializeViewState<T>(state: T): string {
  const envelope: ViewStateEnvelope<T> = {
    version: VIEW_STATE_VERSION,
    state,
  };
  return JSON.stringify(envelope);
}
