import { describe, expect, test } from "bun:test";
import {
  createTable,
  getCoreRowModel,
  getSortedRowModel,
} from "@tanstack/table-core";
import { lastInventoriedSortValue } from "../last-inventoried";

/**
 * Direction-correctness test for the magazines table's "Last inventoried"
 * sort (KTD-4, #70 review). A never-inventoried magazine must sort as if
 * *infinitely old*: to the top when ascending (oldest-first), and to the
 * bottom when descending (newest-first) — i.e. it always follows direction,
 * landing at the "stale" end either way. An unparsable `lastInventoriedAt`
 * must sort the same way (PR #72 re-review): it's treated as maximally stale,
 * not as a mid-pack or crashing value.
 *
 * Built directly on `@tanstack/table-core` (the framework-agnostic core
 * `@tanstack/react-table` wraps) rather than rendering `useReactTable`
 * through React, so this is a plain headless unit test with no DOM/React
 * test harness required. The column config below imports the real
 * `lastInventoriedSortValue` accessor from `last-inventoried.ts` (the same one
 * `magazines-view.tsx` uses), so this test can't drift from the column it's
 * meant to cover.
 */

interface Row {
  id: string;
  lastInventoriedAt: string | null;
}

const NOW = Date.now();
const DAY_MS = 86_400_000;

const rows: Row[] = [
  { id: "10d", lastInventoriedAt: new Date(NOW - 10 * DAY_MS).toISOString() },
  {
    id: "200d",
    lastInventoriedAt: new Date(NOW - 200 * DAY_MS).toISOString(),
  },
  { id: "never", lastInventoriedAt: null },
  { id: "unparsable", lastInventoriedAt: "not-a-date" },
];

/**
 * Builds a headless table over `rows` with the given sort direction, using
 * the "lastInventoried" column config from `magazines-view.tsx`: a numeric
 * accessor (`lastInventoriedSortValue`, `-Infinity` for never-inventoried or
 * unparsable, i.e. infinitely old) sorted with the built-in `"basic"`
 * comparator. Unlike `sortUndefined`, a plain numeric comparator is
 * direction-correct by construction — TanStack negates its result for `desc`,
 * so `-Infinity` naturally lands at whichever end "oldest" belongs on.
 *
 * A prior version of this test (and of the column) used
 * `accessorFn: (m) => m.lastInventoriedAt ?? undefined` with
 * `sortUndefined: "first"`, which pins undefined values to the top
 * regardless of direction — confirmed RED here (descending kept
 * never-inventoried at the top instead of the bottom) before the fix below.
 */
function sortedIds(desc: boolean): string[] {
  const table = createTable<Row>({
    data: rows,
    columns: [
      {
        id: "lastInventoried",
        accessorFn: (m: Row) => lastInventoriedSortValue(m.lastInventoriedAt),
        sortingFn: "basic",
      },
    ],
    state: { sorting: [{ id: "lastInventoried", desc }] },
    onStateChange: () => {},
    renderFallbackValue: null,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });
  return table.getSortedRowModel().rows.map((row) => row.original.id);
}

describe("Last inventoried column sort (direction-correct never-inventoried handling)", () => {
  test("ascending (oldest-first) sorts never-inventoried and unparsable to the top", () => {
    const sorted = sortedIds(false);
    expect(sorted.slice(0, 2).sort()).toEqual(["never", "unparsable"].sort());
    expect(sorted.slice(2)).toEqual(["200d", "10d"]);
  });

  test("descending (newest-first) sorts never-inventoried and unparsable to the bottom", () => {
    const sorted = sortedIds(true);
    expect(sorted.slice(0, 2)).toEqual(["10d", "200d"]);
    expect(sorted.slice(2).sort()).toEqual(["never", "unparsable"].sort());
  });
});
