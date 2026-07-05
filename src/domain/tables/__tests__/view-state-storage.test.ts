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
