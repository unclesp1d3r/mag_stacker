import { describe, expect, test } from "bun:test";
import {
  createTable,
  getCoreRowModel,
  getSortedRowModel,
} from "@tanstack/table-core";

/**
 * Direction-correctness test for the magazines table's "Last inventoried"
 * sort (KTD-4, #70 review). A never-inventoried magazine must sort as if
 * *infinitely old*: to the top when ascending (oldest-first), and to the
 * bottom when descending (newest-first) — i.e. it always follows direction,
 * landing at the "stale" end either way.
 *
 * Built directly on `@tanstack/table-core` (the framework-agnostic core
 * `@tanstack/react-table` wraps) rather than rendering `useReactTable`
 * through React, so this is a plain headless unit test with no DOM/React
 * test harness required. The column config below mirrors the "lastInventoried"
 * column in `magazines-view.tsx` — kept in sync by hand since that column is
 * defined inline in a client component and isn't itself exported.
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
];

/**
 * Builds a headless table over `rows` with the given sort direction, using
 * the "lastInventoried" column config from `magazines-view.tsx`: a numeric
 * accessor (never-inventoried = `Number.NEGATIVE_INFINITY`, i.e. infinitely
 * old) sorted with the built-in `"basic"` comparator. Unlike `sortUndefined`,
 * a plain numeric comparator is direction-correct by construction — TanStack
 * negates its result for `desc`, so `-Infinity` naturally lands at whichever
 * end "oldest" belongs on.
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
        accessorFn: (m: Row) =>
          m.lastInventoriedAt
            ? Date.parse(m.lastInventoriedAt)
            : Number.NEGATIVE_INFINITY,
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
  test("ascending (oldest-first) sorts never-inventoried to the top", () => {
    expect(sortedIds(false)).toEqual(["never", "200d", "10d"]);
  });

  test("descending (newest-first) sorts never-inventoried to the bottom", () => {
    expect(sortedIds(true)).toEqual(["10d", "200d", "never"]);
  });
});
