import { describe, expect, test } from "bun:test";
import {
  parseViewState,
  serializeViewState,
  viewStateStorageKey,
} from "../view-state-storage";

interface SampleState {
  sort: string;
  pageSize: number;
}

const DEFAULTS: SampleState = { sort: "label", pageSize: 25 };

describe("viewStateStorageKey (KTD-7)", () => {
  test("builds the per-table versioned key", () => {
    expect(viewStateStorageKey("magazines")).toBe(
      "magstacker:table:magazines:v1",
    );
  });
});

describe("parseViewState fail-safe (KTD-7)", () => {
  test("valid v1 envelope round-trips through serialize/parse", () => {
    const state: SampleState = { sort: "caliber", pageSize: 50 };
    const raw = serializeViewState(state);

    expect(parseViewState(raw, DEFAULTS)).toEqual(state);
  });

  test("null (missing key) returns defaults", () => {
    expect(parseViewState(null, DEFAULTS)).toEqual(DEFAULTS);
  });

  test("malformed JSON returns defaults, never throws", () => {
    expect(parseViewState("{not json", DEFAULTS)).toEqual(DEFAULTS);
  });

  test("wrong version returns defaults", () => {
    const raw = JSON.stringify({
      version: 2,
      state: { sort: "x", pageSize: 9 },
    });

    expect(parseViewState(raw, DEFAULTS)).toEqual(DEFAULTS);
  });

  test("missing version returns defaults", () => {
    const raw = JSON.stringify({ state: { sort: "x", pageSize: 9 } });

    expect(parseViewState(raw, DEFAULTS)).toEqual(DEFAULTS);
  });

  test("non-object state returns defaults", () => {
    const raw = JSON.stringify({ version: 1, state: "nope" });

    expect(parseViewState(raw, DEFAULTS)).toEqual(DEFAULTS);
  });

  test("a JSON primitive (not an envelope) returns defaults", () => {
    expect(parseViewState("42", DEFAULTS)).toEqual(DEFAULTS);
    expect(parseViewState("null", DEFAULTS)).toEqual(DEFAULTS);
  });

  test("a partial same-version state is merged over defaults (forward-compat)", () => {
    const raw = JSON.stringify({ version: 1, state: { pageSize: 100 } });

    // sort falls back to the default; pageSize is taken from storage.
    expect(parseViewState(raw, DEFAULTS)).toEqual({
      sort: "label",
      pageSize: 100,
    });
  });

  test("does not mutate the caller's defaults object", () => {
    const raw = JSON.stringify({ version: 1, state: { pageSize: 100 } });
    parseViewState(raw, DEFAULTS);

    expect(DEFAULTS).toEqual({ sort: "label", pageSize: 25 });
  });
});

interface NestedState {
  pageSize: number;
  columnVisibility: Record<string, boolean>;
}

describe("parseViewState nested-object merge (forward-compat, KTD-4)", () => {
  test("a nested object gains keys the current defaults have but the stored entry lacks", () => {
    // Stored before a new opt-in column "photos" existed.
    const raw = JSON.stringify({
      version: 1,
      state: { pageSize: 25, columnVisibility: { notes: false } },
    });
    // Current defaults added "photos" (a new opt-in column) — no version bump.
    const defaults: NestedState = {
      pageSize: 25,
      columnVisibility: { notes: false, photos: false },
    };

    // photos must stay hidden (default), not silently become visible.
    expect(parseViewState(raw, defaults)).toEqual({
      pageSize: 25,
      columnVisibility: { notes: false, photos: false },
    });
  });

  test("an array field is replaced wholesale, never spread into an object", () => {
    // Regression: a `SortingState`-style array must not be key-merged into
    // `{ "0": … }` — it stays a real array.
    interface WithArray {
      sorting: Array<{ id: string; desc: boolean }>;
      pageSize: number;
    }
    const raw = JSON.stringify({
      version: 1,
      state: { sorting: [{ id: "email", desc: true }], pageSize: 10 },
    });
    const defaults: WithArray = { sorting: [], pageSize: 25 };

    const result = parseViewState(raw, defaults);
    expect(Array.isArray(result.sorting)).toBe(true);
    expect(result.sorting).toEqual([{ id: "email", desc: true }]);
    expect(result.pageSize).toBe(10);
  });

  test("stored nested values override the matching default keys", () => {
    const raw = JSON.stringify({
      version: 1,
      state: { pageSize: 25, columnVisibility: { notes: true } },
    });
    const defaults: NestedState = {
      pageSize: 25,
      columnVisibility: { notes: false, photos: false },
    };

    // The user's explicit choice (notes visible) is preserved; new key defaults.
    expect(parseViewState(raw, defaults)).toEqual({
      pageSize: 25,
      columnVisibility: { notes: true, photos: false },
    });
  });
});
