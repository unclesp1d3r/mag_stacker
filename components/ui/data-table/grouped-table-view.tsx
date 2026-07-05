"use client";

// U5: grouped rendering for owner-scoped roll-ups (magazines/firearms). Reuses
// the U1 wrapper's toolbar and header/cell styling but owns its own render
// tree (expandable group-header rows inside a single table + a flat "Shared
// with you" section) rather than delegating to `DataTable`, since the
// None-mode wrapper has no concept of groups (KTD-1: grouping order/
// aggregation is hand-rolled, the table library only supplies sort/
// column-visibility over each flat row set).
//
// Expand/collapse is a single `<table>` with group-header rows that toggle
// plain React state (a `Set<string>` of open group keys), NOT a per-group
// Radix `Collapsible`. Radix Collapsible measures each group's content height
// via a ResizeObserver, and the member table's own horizontal-scroll
// container toggling its scrollbar on expand made that observer thrash under
// headless/software rendering (GitHub CI has no GPU), hanging the renderer
// main thread. One `<table>`, one scroll container, and instant conditional
// rendering of member rows avoids all of that — at the cost of the height
// animation, an acceptable tradeoff for correctness (R17 degrades to instant).

import type { Cell, Header, Row, SortingState } from "@tanstack/react-table";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { Fragment, useCallback, useId, useMemo, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { GroupKey } from "@/src/domain/tables/grouping";
import { buildGroups } from "@/src/domain/tables/grouping";
import { cn } from "../cn";
import { EmptyState } from "../feedback";
import { DataTableToolbar } from "./data-table-toolbar";
import type { ColumnDef, TableViewState } from "./types";
import { resolveColumnLabel } from "./types";

/** Matches `data-table.tsx`'s outer frame so grouped and flat tables read as one system. */
const FRAME_CLASSNAME =
  "flex flex-col overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card shadow-[var(--shadow-raised)]";

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
 * name-asc ordered groups (R13) with keyboard-operable expand/collapse
 * (R11, R15), plus a flat "Shared with you" section for borrowed rows (R10).
 * No pagination in grouped mode (R14).
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
  // Sort bridge (R13): an explicit user sort always wins; the caller-supplied
  // default (e.g. label ascending) applies only while no sort is set.
  const effectiveSorting: SortingState = viewState.sorting.length
    ? viewState.sorting
    : (defaultMemberSort ?? []);

  // Memoize the row sets fed to the two useReactTable instances. A fresh
  // `filter(...)` array every render makes TanStack see "data changed" and fire
  // its autoReset logic → schedule a state update → re-render → new array →
  // an INFINITE render loop that pegs the main thread (it only surfaces once
  // this component re-renders on its own state, e.g. expanding a group).
  const ownedData = useMemo(
    () => data.filter((row) => row.ownerId === ownerId),
    [data, ownerId],
  );
  const borrowed = useMemo(
    () => data.filter((row) => row.ownerId !== ownerId),
    [data, ownerId],
  );

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
  // Only the group metadata (order, name, count, aggregate) is taken from the
  // engine here; `borrowed` is the memoized split above (kept stable for the
  // borrowed table's data).
  const { groups } = buildGroups(data, {
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

  const groupHeaders = table.getHeaderGroups()[0]?.headers ?? [];
  const visibleColumnCount = table.getVisibleLeafColumns().length;

  const borrowedTable = useReactTable({
    data: borrowed,
    columns,
    state: { columnVisibility: viewState.columnVisibility },
    getCoreRowModel: getCoreRowModel(),
  });

  // Expansion state (R11: collapsed by default) is a plain immutable `Set`,
  // not Radix Collapsible open-state — see the file header for why. `toggle`
  // always returns a NEW Set rather than mutating the current one.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const toggle = useCallback((key: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  // `group.key` values come from `keyOf` and may contain spaces/pipes (e.g.
  // `"PMAG 30|9mm|10|0"`), which are invalid HTML ids. `useId` plus the
  // group's array INDEX gives every panel a stable, valid id without
  // depending on the raw key (R15).
  const idPrefix = useId();

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
        <>
          {groups.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="No items to group"
                description="Add some items or adjust your filters to see them grouped here."
              />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>{groupHeaders.map(renderHeaderCell)}</TableRow>
              </TableHeader>
              <TableBody>
                {groups.map((group, groupIndex) => {
                  const isOpen = expanded.has(group.key);
                  const panelId = `${idPrefix}-group-${groupIndex}`;
                  const members = rowsByGroupKey.get(group.key) ?? [];
                  return (
                    <Fragment key={group.key}>
                      <TableRow>
                        <TableCell
                          colSpan={visibleColumnCount}
                          className="bg-muted/60 p-0"
                        >
                          <button
                            type="button"
                            aria-expanded={isOpen}
                            aria-controls={isOpen ? panelId : undefined}
                            onClick={() => toggle(group.key)}
                            className="flex w-full items-center gap-2 px-4 py-2 text-left hover:bg-accent/50"
                          >
                            <ChevronRight
                              aria-hidden="true"
                              className={cn(
                                "size-4 shrink-0 text-muted-foreground transition-transform",
                                isOpen && "rotate-90",
                              )}
                            />
                            <span className="font-semibold text-foreground">
                              {group.name}
                            </span>
                            <span className="font-mono text-muted-foreground text-xs tabular">
                              {group.count}{" "}
                              {group.count === 1 ? "item" : "items"}
                            </span>
                            {renderAggregate ? (
                              <span className="font-mono text-muted-foreground text-xs tabular">
                                {renderAggregate(group.aggregate)}
                              </span>
                            ) : null}
                          </button>
                        </TableCell>
                      </TableRow>
                      {/* Member rows: plain conditional render, no Collapsible
                          and no height animation — instant reveal is the
                          whole point of this rewrite. */}
                      {isOpen &&
                        members.map((row, memberIndex) => (
                          <TableRow
                            key={row.id}
                            id={memberIndex === 0 ? panelId : undefined}
                          >
                            {row.getVisibleCells().map(renderBodyCell)}
                          </TableRow>
                        ))}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          )}
          <div className="border-border border-t">
            <header className="flex items-center gap-2 bg-muted px-4 py-3">
              <h3 className="font-mono font-semibold text-[0.65rem] text-muted-foreground uppercase tracking-[0.14em]">
                Shared with you
              </h3>
              {borrowed.length > 0 ? (
                <span className="font-mono text-muted-foreground text-xs tabular">
                  {borrowed.length}
                </span>
              ) : null}
            </header>
            {borrowed.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    {(borrowedTable.getHeaderGroups()[0]?.headers ?? []).map(
                      (header) => renderHeaderCell(header),
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {borrowedTable.getRowModel().rows.map((row) => (
                    <TableRow key={row.id}>
                      {row
                        .getVisibleCells()
                        .map((cell) => renderBodyCell(cell))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="p-6">
                <EmptyState
                  title="Nothing shared with you"
                  description="Items other owners share with you will appear here."
                />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** Shared header-cell rendering, identical to `data-table.tsx`'s markup. */
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
    <TableHead
      key={header.id}
      scope="col"
      aria-sort={canSort ? ariaSort : undefined}
      className={cn(
        "px-4 py-3 font-mono text-[0.65rem] text-muted-foreground uppercase tracking-[0.14em]",
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
            "inline-flex items-center gap-1 text-inherit hover:text-foreground",
            numeric && "flex-row-reverse",
          )}
        >
          {flexRender(header.column.columnDef.header, header.getContext())}
          <SortIcon state={sorted} />
        </button>
      ) : (
        flexRender(header.column.columnDef.header, header.getContext())
      )}
    </TableHead>
  );
}

/** Shared body-cell rendering, identical to `data-table.tsx`'s markup. */
function renderBodyCell<TData>(cell: Cell<TData, unknown>): ReactNode {
  const optIn = (cell.column.columnDef as ColumnDef<TData>).optIn;
  const numeric = cell.column.columnDef.meta?.numeric;
  return (
    <TableCell
      key={cell.id}
      className={cn(
        "px-4 py-3 align-middle whitespace-normal",
        numeric && "text-right font-mono tabular",
        optIn && "hidden md:table-cell",
      )}
    >
      {flexRender(cell.column.columnDef.cell, cell.getContext())}
    </TableCell>
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
