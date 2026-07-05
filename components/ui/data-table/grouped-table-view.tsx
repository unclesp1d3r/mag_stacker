"use client";

// U5: grouped rendering for owner-scoped roll-ups (magazines/firearms). Reuses
// the U1 wrapper's toolbar and header/cell styling but owns its own render
// tree (collapsible group headers + a flat "Shared with you" section) rather
// than delegating to `DataTable`, since the None-mode wrapper has no concept
// of groups (KTD-1: grouping order/aggregation is hand-rolled, the table
// library only supplies sort/column-visibility over each flat row set).

import type { Cell, Header, Row, SortingState } from "@tanstack/react-table";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Fragment, type ReactNode, useId, useRef, useState } from "react";
import type { GroupKey } from "@/src/domain/tables/grouping";
import { buildGroups } from "@/src/domain/tables/grouping";
import { cn } from "../cn";
import { EmptyState } from "../feedback";
import { DataTableToolbar } from "./data-table-toolbar";
import type { ColumnDef, TableViewState } from "./types";
import { resolveColumnLabel } from "./types";

/** Matches `data-table.tsx`'s outer frame so grouped and flat tables read as one system. */
const FRAME_CLASSNAME =
  "flex flex-col overflow-hidden rounded-[var(--radius-lg)] border border-line bg-paper-raised shadow-[var(--shadow-raised)]";

/** R17 easing, shared with `theme-toggle.tsx` / `toast.tsx`. */
const EXPAND_TRANSITION = { duration: 0.2, ease: [0.16, 1, 0.3, 1] as const };
const REDUCED_MOTION_TRANSITION = { duration: 0 };

export interface GroupedTableViewProps<
  TData extends { ownerId: string },
  Aggregate = undefined,
> {
  columns: ColumnDef<TData>[];
  data: TData[];
  ownerId: string;
  keyOf: (row: TData) => GroupKey;
  aggregateOf?: (members: TData[]) => Aggregate;
  renderAggregate?: (aggregate: Aggregate) => ReactNode;
  viewState: TableViewState;
  onViewStateChange: (next: TableViewState) => void;
  filterSlot?: ReactNode;
  groupingSlot?: ReactNode;
  defaultMemberSort?: SortingState;
  emptyFilterState?: ReactNode;
}

/**
 * Renders an owner-scoped roll-up: owned rows collapsed into count-desc/
 * name-asc ordered groups (R13) with keyboard-operable, Motion-animated
 * expand/collapse (R11, R15, R17), plus a flat "Shared with you" section for
 * borrowed rows (R10). No pagination in grouped mode (R14).
 */
export function GroupedTableView<
  TData extends { ownerId: string },
  Aggregate = undefined,
>({
  columns,
  data,
  ownerId,
  keyOf,
  aggregateOf,
  renderAggregate,
  viewState,
  onViewStateChange,
  filterSlot,
  groupingSlot,
  defaultMemberSort,
  emptyFilterState,
}: GroupedTableViewProps<TData, Aggregate>) {
  const idPrefix = useId();
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const headerButtonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const memberContainerRefs = useRef<Map<string, HTMLTableSectionElement>>(
    new Map(),
  );
  const prefersReducedMotion = useReducedMotion() ?? false;
  const transition = prefersReducedMotion
    ? REDUCED_MOTION_TRANSITION
    : EXPAND_TRANSITION;

  // Sort bridge (R13): an explicit user sort always wins; the caller-supplied
  // default (e.g. label ascending) applies only while no sort is set.
  const effectiveSorting: SortingState = viewState.sorting.length
    ? viewState.sorting
    : (defaultMemberSort ?? []);

  const ownedData = data.filter((row) => row.ownerId === ownerId);

  const table = useReactTable({
    data: ownedData,
    columns,
    state: {
      sorting: effectiveSorting,
      columnVisibility: viewState.columnVisibility,
    },
    onSortingChange: (updater) => {
      const next =
        typeof updater === "function" ? updater(effectiveSorting) : updater;
      onViewStateChange({ ...viewState, sorting: next });
    },
    onColumnVisibilityChange: (updater) => {
      const next =
        typeof updater === "function"
          ? updater(viewState.columnVisibility)
          : updater;
      onViewStateChange({ ...viewState, columnVisibility: next });
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  // Group metadata (order, name, count, aggregate) comes from the pure U3
  // engine; member *rows* for rendering come from this table's sorted row
  // model, bucketed by the same `keyOf`, so a click-to-sort reorders members
  // within each group without touching group order (R13).
  const { groups, borrowed } = buildGroups(data, {
    ownerId,
    keyOf,
    aggregateOf,
  });

  const rowsByGroupKey = table
    .getRowModel()
    .rows.reduce<Map<string, Row<TData>[]>>((accumulator, row) => {
      const { key } = keyOf(row.original);
      const existing = accumulator.get(key) ?? [];
      accumulator.set(key, [...existing, row]);
      return accumulator;
    }, new Map());

  const borrowedTable = useReactTable({
    data: borrowed,
    columns,
    state: { columnVisibility: viewState.columnVisibility },
    getCoreRowModel: getCoreRowModel(),
  });

  function setHeaderButtonRef(
    key: string,
    element: HTMLButtonElement | null,
  ): void {
    if (element) {
      headerButtonRefs.current.set(key, element);
    } else {
      headerButtonRefs.current.delete(key);
    }
  }

  function setMemberContainerRef(
    key: string,
    element: HTMLTableSectionElement | null,
  ): void {
    if (element) {
      memberContainerRefs.current.set(key, element);
    } else {
      memberContainerRefs.current.delete(key);
    }
  }

  // KTD-11c: collapsing a group whose member rows contain keyboard focus
  // returns focus to that group's header button, avoiding a WCAG 2.4.3
  // focus-loss when the focused element is hidden.
  function toggleGroup(key: string): void {
    const isCurrentlyExpanded = expandedKeys.has(key);
    if (!isCurrentlyExpanded) {
      setExpandedKeys((previous) => new Set(previous).add(key));
      return;
    }
    const container = memberContainerRefs.current.get(key);
    const focusWasInside = container?.contains(document.activeElement) ?? false;
    setExpandedKeys((previous) => {
      const next = new Set(previous);
      next.delete(key);
      return next;
    });
    if (focusWasInside) {
      headerButtonRefs.current.get(key)?.focus();
    }
  }

  const visibleColumnCount = table.getVisibleLeafColumns().length;
  const isFullyEmpty = data.length === 0;

  return (
    <div className={FRAME_CLASSNAME}>
      {/* Reactive slices (columnVisibility) are passed explicitly rather than
          read from `table` so the toolbar re-renders under React Compiler,
          which cannot see the stable `table` object mutate. */}
      <DataTableToolbar
        table={table}
        filterSlot={filterSlot}
        groupingSlot={groupingSlot}
        showPagination={false}
        columnVisibility={viewState.columnVisibility}
      />
      {isFullyEmpty && emptyFilterState ? (
        <div className="p-6">{emptyFilterState}</div>
      ) : (
        <div className="flex flex-col">
          <div className="overflow-x-auto">
            {groups.length > 0 ? (
              <table className="w-full border-collapse text-sm">
                <thead className="border-line-strong border-b-2 bg-paper-sunken">
                  <tr>
                    {(table.getHeaderGroups()[0]?.headers ?? []).map((header) =>
                      renderHeaderCell(header),
                    )}
                  </tr>
                </thead>
                {groups.map((group) => {
                  const isExpanded = expandedKeys.has(group.key);
                  const panelId = `${idPrefix}-group-${group.key}`;
                  const members = rowsByGroupKey.get(group.key) ?? [];

                  return (
                    <Fragment key={group.key}>
                      <tbody>
                        <tr className="border-line border-b bg-paper-sunken/60">
                          <td
                            colSpan={visibleColumnCount}
                            className="px-4 py-2"
                          >
                            <button
                              type="button"
                              ref={(element) =>
                                setHeaderButtonRef(group.key, element)
                              }
                              aria-expanded={isExpanded}
                              aria-controls={panelId}
                              onClick={() => toggleGroup(group.key)}
                              className="flex w-full items-center gap-2 rounded-[var(--radius)] px-1 py-1 text-left transition-colors hover:bg-blaze-soft/45"
                            >
                              <ChevronIcon expanded={isExpanded} />
                              <span className="font-semibold text-ink">
                                {group.name}
                              </span>
                              <span className="font-mono text-ink-soft text-xs tabular">
                                {group.count}{" "}
                                {group.count === 1 ? "item" : "items"}
                              </span>
                              {renderAggregate ? (
                                <span className="font-mono text-ink-soft text-xs tabular">
                                  {renderAggregate(group.aggregate)}
                                </span>
                              ) : null}
                            </button>
                          </td>
                        </tr>
                      </tbody>
                      <AnimatePresence>
                        {isExpanded ? (
                          <motion.tbody
                            key={`members-${group.key}`}
                            id={panelId}
                            ref={(element) =>
                              setMemberContainerRef(group.key, element)
                            }
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={transition}
                          >
                            {members.map((row) => (
                              <tr
                                key={row.id}
                                className="border-line border-b transition-colors duration-150 last:border-0 hover:bg-blaze-soft/45"
                              >
                                {row
                                  .getVisibleCells()
                                  .map((cell) => renderBodyCell(cell))}
                              </tr>
                            ))}
                          </motion.tbody>
                        ) : null}
                      </AnimatePresence>
                    </Fragment>
                  );
                })}
              </table>
            ) : (
              <div className="p-6">
                <EmptyState
                  title="No items to group"
                  description="Add some items or adjust your filters to see them grouped here."
                />
              </div>
            )}
          </div>
          <div className="border-line border-t">
            <div className="flex items-center gap-2 bg-paper-sunken px-4 py-3">
              <h3 className="font-mono font-semibold text-[0.65rem] text-ink-soft uppercase tracking-[0.14em]">
                Shared with you
              </h3>
              {borrowed.length > 0 ? (
                <span className="font-mono text-ink-soft text-xs tabular">
                  {borrowed.length}
                </span>
              ) : null}
            </div>
            {borrowed.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead className="border-line-strong border-b-2 bg-paper-sunken">
                    <tr>
                      {(borrowedTable.getHeaderGroups()[0]?.headers ?? []).map(
                        (header) => renderHeaderCell(header),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {borrowedTable.getRowModel().rows.map((row) => (
                      <tr
                        key={row.id}
                        className="border-line border-b transition-colors duration-150 last:border-0 hover:bg-blaze-soft/45"
                      >
                        {row
                          .getVisibleCells()
                          .map((cell) => renderBodyCell(cell))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-6">
                <EmptyState
                  title="Nothing shared with you"
                  description="Items other owners share with you will appear here."
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Shared header-cell rendering, identical to `data-table.tsx`'s inline markup. */
function renderHeaderCell<TData>(header: Header<TData, unknown>): ReactNode {
  const canSort = header.column.getCanSort();
  const sorted = header.column.getIsSorted();
  const ariaSort =
    sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : "none";
  const optIn = (header.column.columnDef as ColumnDef<TData>).optIn;
  const numeric = header.column.columnDef.meta?.numeric;
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
          {flexRender(header.column.columnDef.header, header.getContext())}
          <SortIcon state={sorted} />
        </button>
      ) : (
        flexRender(header.column.columnDef.header, header.getContext())
      )}
    </th>
  );
}

/** Shared body-cell rendering, identical to `data-table.tsx`'s inline markup. */
function renderBodyCell<TData>(cell: Cell<TData, unknown>): ReactNode {
  const optIn = (cell.column.columnDef as ColumnDef<TData>).optIn;
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
      {flexRender(cell.column.columnDef.cell, cell.getContext())}
    </td>
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

/** Group expand/collapse indicator: rotates 90° when expanded (CSS transition, not Motion). */
function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn(
        "shrink-0 text-ink-soft transition-transform duration-150",
        expanded && "rotate-90",
      )}
    >
      <path d="M6 4l4 4-4 4" />
    </svg>
  );
}
