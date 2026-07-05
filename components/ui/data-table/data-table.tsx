"use client";

// Branch decision (KTD-2): headless @tanstack/react-table + hand-styled Tailwind, not shadcn — see plan KTD-2 (custom DESIGN.md tokens, hand-rolled cn.ts, no existing Radix/CVA in the repo).

import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useState } from "react";
import { cn } from "../cn";
import { DataTableToolbar } from "./data-table-toolbar";
import type { ColumnDef, DataTableProps, TableViewState } from "./types";
import { createDefaultTableViewState, resolveColumnLabel } from "./types";

/** Number of placeholder rows shown in the pre-mount skeleton (RES-1). */
const SKELETON_ROWS = 6;

/** Shared outer frame classes, reused by the table and its skeleton so the
 * skeleton→content swap keeps the frame, toolbar, and header geometry stable. */
const FRAME_CLASSNAME =
  "flex flex-col overflow-hidden rounded-[var(--radius-lg)] border border-line bg-paper-raised shadow-[var(--shadow-raised)]";

/** Generic shared table wrapper: sort, column show/hide, and pagination over a flat row set. */
export function DataTable<TData>({
  columns,
  data,
  viewState,
  onViewStateChange,
  filterSlot,
  groupingSlot,
  emptyState,
  enablePagination = true,
  mounted = true,
  isRowFlashed,
}: DataTableProps<TData>) {
  const [internalViewState, setInternalViewState] = useState<TableViewState>(
    () => viewState ?? createDefaultTableViewState(columns),
  );
  const currentViewState = viewState ?? internalViewState;
  const [pageIndex, setPageIndex] = useState(0);

  function commitViewState(next: TableViewState): void {
    onViewStateChange?.(next);
    if (viewState === undefined) {
      setInternalViewState(next);
    }
  }

  const table = useReactTable({
    data,
    columns,
    state: {
      sorting: currentViewState.sorting,
      columnVisibility: currentViewState.columnVisibility,
      pagination: { pageIndex, pageSize: currentViewState.pageSize },
    },
    onSortingChange: (updater) => {
      const next =
        typeof updater === "function"
          ? updater(currentViewState.sorting)
          : updater;
      commitViewState({ ...currentViewState, sorting: next });
    },
    onColumnVisibilityChange: (updater) => {
      const next =
        typeof updater === "function"
          ? updater(currentViewState.columnVisibility)
          : updater;
      commitViewState({ ...currentViewState, columnVisibility: next });
    },
    onPaginationChange: (updater) => {
      const prev = { pageIndex, pageSize: currentViewState.pageSize };
      const next = typeof updater === "function" ? updater(prev) : updater;
      setPageIndex(next.pageIndex);
      if (next.pageSize !== currentViewState.pageSize) {
        commitViewState({
          ...currentViewState,
          pageSize: next.pageSize as TableViewState["pageSize"],
        });
      }
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    ...(enablePagination
      ? { getPaginationRowModel: getPaginationRowModel() }
      : {}),
  });

  const isEmpty = data.length === 0;

  if (!mounted) {
    return <DataTableSkeleton />;
  }

  return (
    <div className={FRAME_CLASSNAME}>
      {/* The reactive slices below are passed explicitly, not read from the
          referentially-stable `table` object. Under React Compiler
          (reactCompiler: true) the memoized toolbar children would otherwise
          never re-render — `table` never changes identity even as its internal
          state mutates — and would show stale controls. */}
      <DataTableToolbar
        table={table}
        filterSlot={filterSlot}
        groupingSlot={groupingSlot}
        showPagination={enablePagination}
        columnVisibility={currentViewState.columnVisibility}
        pageIndex={pageIndex}
        pageSize={currentViewState.pageSize}
        rowCount={table.getPrePaginationRowModel().rows.length}
      />
      {isEmpty && emptyState ? (
        <div className="p-6">{emptyState}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="border-line-strong border-b-2 bg-paper-sunken">
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => {
                    const canSort = header.column.getCanSort();
                    const sorted = header.column.getIsSorted();
                    const ariaSort =
                      sorted === "asc"
                        ? "ascending"
                        : sorted === "desc"
                          ? "descending"
                          : "none";
                    const optIn = (header.column.columnDef as ColumnDef<TData>)
                      .optIn;
                    const numeric = header.column.columnDef.meta?.numeric;
                    // flexRender'd header content usually carries its own
                    // accessible name (plain text). When it doesn't (a
                    // JSX/icon header), fall back to meta.label so the sort
                    // button still exposes a discoverable name (R15).
                    const headerIsPlainString =
                      typeof header.column.columnDef.header === "string";
                    const columnLabel = resolveColumnLabel(header.column);

                    return (
                      <th
                        key={header.id}
                        scope="col"
                        aria-sort={canSort ? ariaSort : undefined}
                        className={cn(
                          "px-4 py-3 text-left font-mono text-[0.65rem] font-semibold text-ink-soft uppercase tracking-[0.14em]",
                          numeric && "text-right",
                          optIn && "hidden md:table-cell",
                        )}
                      >
                        {header.isPlaceholder ? null : canSort ? (
                          <button
                            type="button"
                            onClick={header.column.getToggleSortingHandler()}
                            aria-label={
                              !headerIsPlainString && columnLabel
                                ? `Sort by ${columnLabel}`
                                : undefined
                            }
                            className={cn(
                              "inline-flex items-center gap-1 text-inherit hover:text-ink",
                              numeric && "flex-row-reverse",
                            )}
                          >
                            {flexRender(
                              header.column.columnDef.header,
                              header.getContext(),
                            )}
                            <SortIcon state={sorted} />
                          </button>
                        ) : (
                          flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )
                        )}
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  data-flash={isRowFlashed?.(row.original) ? "true" : undefined}
                  className="border-line border-b transition-colors duration-150 last:border-0 hover:bg-blaze-soft/45"
                >
                  {row.getVisibleCells().map((cell) => {
                    const optIn = (cell.column.columnDef as ColumnDef<TData>)
                      .optIn;
                    const numeric = cell.column.columnDef.meta?.numeric;
                    return (
                      <td
                        key={cell.id}
                        className={cn(
                          "px-4 py-3 align-middle text-ink",
                          numeric && "text-right font-mono tabular",
                          optIn && "hidden md:table-cell",
                        )}
                      >
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext(),
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * Neutral placeholder shown while a persistence hook restores saved view state
 * (R3/KTD-7). Reuses the real frame so the toolbar and header bands hold their
 * geometry across the skeleton→content swap; the body height settles to the
 * restored page size on mount (RES-1 accepted tradeoff).
 */
export function DataTableSkeleton() {
  return (
    <div className={FRAME_CLASSNAME} aria-busy="true" aria-hidden="true">
      {/* Toolbar band */}
      <div className="flex items-center justify-between border-line border-b bg-paper-raised px-4 py-3">
        <div className="h-8 w-40 animate-pulse rounded-[var(--radius)] bg-paper-sunken" />
        <div className="h-8 w-32 animate-pulse rounded-[var(--radius)] bg-paper-sunken" />
      </div>
      {/* Header band */}
      <div className="border-line-strong border-b-2 bg-paper-sunken px-4 py-3">
        <div className="h-3 w-24 animate-pulse rounded bg-line" />
      </div>
      {/* Body rows */}
      <div>
        {Array.from({ length: SKELETON_ROWS }, (_, index) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder rows, never reordered
            key={index}
            className="border-line border-b px-4 py-3 last:border-0"
          >
            <div className="h-3 w-full max-w-[28rem] animate-pulse rounded bg-paper-sunken" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Sort-direction indicator: dims when the column is unsorted, flips for descending. */
function SortIcon({ state }: { state: false | "asc" | "desc" }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      width="10"
      height="10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("shrink-0", state === false && "opacity-40")}
    >
      {state === "desc" ? (
        <path d="M4 6l4 4 4-4" />
      ) : (
        <path d="M4 10l4-4 4 4" />
      )}
    </svg>
  );
}
