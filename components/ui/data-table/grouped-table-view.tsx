"use client";

// U5: grouped rendering for owner-scoped roll-ups (magazines/firearms). Reuses
// the U1 wrapper's toolbar and header/cell styling but owns its own render
// tree (collapsible group headers + a flat "Shared with you" section) rather
// than delegating to `DataTable`, since the None-mode wrapper has no concept
// of groups (KTD-1: grouping order/aggregation is hand-rolled, the table
// library only supplies sort/column-visibility over each flat row set).
//
// Expand/collapse is Radix `Collapsible` (via shadcn's `components/ui/collapsible`)
// rather than hand-rolled `expandedKeys` state: Radix owns open-state, keyboard
// interaction, focus, and `aria-expanded`/`aria-controls` (with valid
// Radix-generated ids — the previous version built ids from raw group keys
// containing spaces like `"PMAG 30|9mm|10|0"`, which are invalid HTML ids and
// caused the in-browser hang this rewrite fixes).

import type { Cell, Header, Row, SortingState } from "@tanstack/react-table";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
 * name-asc ordered groups (R13) with keyboard-operable, Radix-animated
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

  const groupHeaders = table.getHeaderGroups()[0]?.headers ?? [];

  const borrowedTable = useReactTable({
    data: borrowed,
    columns,
    state: { columnVisibility: viewState.columnVisibility },
    getCoreRowModel: getCoreRowModel(),
  });

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
          {/* Single horizontal-scroll container for wide member tables (R19).
              Lives OUTSIDE the per-group Collapsibles, so it isn't what Radix's
              content-height ResizeObserver measures — avoiding the scrollbar
              thrash that a per-table `overflow-x-auto` caused on expand. */}
          <div className="flex flex-col divide-y divide-border overflow-x-auto">
            {groups.length === 0 ? (
              <div className="p-6">
                <EmptyState
                  title="No items to group"
                  description="Add some items or adjust your filters to see them grouped here."
                />
              </div>
            ) : (
              groups.map((group) => (
                <GroupPanel
                  key={group.key}
                  name={group.name}
                  count={group.count}
                  aggregateLabel={
                    renderAggregate ? renderAggregate(group.aggregate) : null
                  }
                  headers={groupHeaders}
                  members={rowsByGroupKey.get(group.key) ?? []}
                />
              ))
            )}
          </div>
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

interface GroupPanelProps<TData> {
  name: string;
  count: number;
  aggregateLabel: ReactNode;
  headers: Header<TData, unknown>[];
  members: Row<TData>[];
}

/**
 * One roll-up group: a Radix `Collapsible` whose trigger is the group summary
 * row (name, count, optional aggregate) and whose content is a standalone
 * `<Table>` for that group's members. Collapsed by default (R11) — Radix owns
 * open state, keyboard activation, focus, and `aria-expanded`/`aria-controls`
 * with valid generated ids, so no manual `expandedKeys` state or focus-return
 * bookkeeping is needed here (fixes the prior in-browser hang, R15).
 */
function GroupPanel<TData>({
  name,
  count,
  aggregateLabel,
  headers,
  members,
}: GroupPanelProps<TData>) {
  return (
    <Collapsible defaultOpen={false}>
      <CollapsibleTrigger className="group flex w-full items-center gap-2 px-4 py-2 text-left transition-colors hover:bg-accent/60">
        <ChevronRight
          aria-hidden="true"
          className="size-3 shrink-0 text-muted-foreground transition-transform duration-150 group-data-[state=open]:rotate-90"
        />
        <span className="font-semibold text-foreground">{name}</span>
        <span className="font-mono text-muted-foreground text-xs tabular">
          {count} {count === 1 ? "item" : "items"}
        </span>
        {aggregateLabel ? (
          <span className="font-mono text-muted-foreground text-xs tabular">
            {aggregateLabel}
          </span>
        ) : null}
      </CollapsibleTrigger>
      {/* Instant reveal (no height animation). The Radix height-animation path
          (`animate-collapsible-*` reading `--radix-collapsible-content-height`)
          drives a ResizeObserver re-measure of the member table; combined with
          the table's own horizontal-scroll container under software rendering
          (headless CI has no GPU) it thrashes and blocks the main thread on
          expand. Dropping the animation keeps the collapse (R11) robust; R17's
          motion degrades to instant, an acceptable tradeoff for correctness. */}
      <CollapsibleContent>
        {/* Plain <table>, NOT shadcn's <Table>: the latter wraps in a hardcoded
            `overflow-x-auto` div, whose horizontal scrollbar toggling makes
            Radix Collapsible's content-height ResizeObserver thrash under
            software rendering (headless CI), blocking the main thread on expand.
            Horizontal overflow is handled by one container around the whole
            groups region instead (R19). */}
        <table className="w-full caption-bottom text-sm">
          <TableHeader>
            <TableRow>
              {headers.map((header) => renderHeaderCell(header))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((row) => (
              <TableRow key={row.id}>
                {row.getVisibleCells().map((cell) => renderBodyCell(cell))}
              </TableRow>
            ))}
          </TableBody>
        </table>
      </CollapsibleContent>
    </Collapsible>
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
