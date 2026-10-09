import type { ColumnDef } from "@/components/ui/data-table/types";
import { Data } from "@/components/ui/typography";
import {
  formatLastInventoried,
  lastInventoriedSortValue,
} from "./last-inventoried";

/**
 * The shared "Last inventoried" column (#70 magazines, #100 ammo): default
 * visible, sortable, absolute date or an em dash. Never-inventoried must sort
 * as if *infinitely old* — top when ascending (oldest-first), bottom when
 * descending (newest-first) — so the accessor returns a NUMBER (`-Infinity`
 * for never) and lets the built-in `"basic"` comparator handle it: TanStack
 * negates a comparator's result for `desc`, so `-Infinity` naturally flips
 * ends with direction. (`sortUndefined: "first"` would NOT do this — it
 * returns before that `desc` inversion, so it pins undefined rows to the top
 * regardless of sort direction.) The `cell` still reads the real value off
 * `row.original`, not the numeric accessor.
 */
export function lastInventoriedColumn<
  T extends { lastInventoriedAt: string | null },
>(): ColumnDef<T> {
  return {
    id: "lastInventoried",
    accessorFn: (item) => lastInventoriedSortValue(item.lastInventoriedAt),
    sortingFn: "basic",
    header: "Last inventoried",
    meta: { label: "Last inventoried" },
    cell: ({ row }) => (
      <Data>{formatLastInventoried(row.original.lastInventoriedAt)}</Data>
    ),
  };
}
