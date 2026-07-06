import type {
  Column,
  RowData,
  SortingState,
  ColumnDef as TanStackColumnDef,
  VisibilityState,
} from "@tanstack/react-table";
import type { ReactNode } from "react";

// Extend TanStack's per-column `meta` bag (the officially documented module
// augmentation pattern) so every column definition can carry DESIGN.md-aware
// hints without an unsafe cast at each read site.
declare module "@tanstack/react-table" {
  interface ColumnMeta<TData extends RowData, TValue> {
    /** Right-align + tabular numerals for this column (DESIGN.md "Tabular Rule"). */
    numeric?: boolean;
    /** Human-readable label for the column-visibility menu when `header` isn't a plain string. */
    label?: string;
  }
}

/**
 * Column id reserved for a table's row-actions column. It is excluded from the
 * column-visibility menu entirely (KTD-10) rather than merely being the "last
 * enabled" floor.
 */
export const ACTIONS_COLUMN_ID = "actions";

/**
 * The shared column shape every table's column definitions use. Extends
 * TanStack's `ColumnDef` with `optIn`: a column a user opts into rather than
 * sees by default. Opt-in columns start hidden (KTD-4) and auto-collapse below
 * the `md` breakpoint even once shown (R19).
 */
export type ColumnDef<TData extends RowData = RowData> = TanStackColumnDef<
  TData,
  unknown
> & {
  optIn?: boolean;
};

/** Page-size choices offered by the pagination control (KTD-5). */
export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];
export const DEFAULT_PAGE_SIZE: PageSize = 25;

/**
 * A table's persistable view state: sort order, column visibility, and page
 * size. U1 owns this with an internal `useState` and the defaults below; U2
 * layers localStorage persistence on top via the controlled `viewState` /
 * `onViewStateChange` props on `DataTable`, without changing this shape.
 */
export interface TableViewState {
  sorting: SortingState;
  columnVisibility: VisibilityState;
  pageSize: PageSize;
}

/**
 * Resolves a column's stable id the same way TanStack does internally
 * (explicit `id`, else a string `accessorKey`). Used to key default column
 * visibility before the table instance exists.
 */
export function resolveColumnId<TData>(
  column: ColumnDef<TData>,
): string | undefined {
  if (column.id) {
    return column.id;
  }
  const accessorKey = (column as { accessorKey?: unknown }).accessorKey;
  return typeof accessorKey === "string" ? accessorKey : undefined;
}

/**
 * A column's human-readable label: `meta.label` when set, else the `header`
 * itself if it's a plain string, else undefined. Shared by the column-menu
 * (KTD-10: "only columns with a human-readable header appear") and the sort
 * toggle button's accessible-name fallback for non-string headers (R15).
 */
export function resolveColumnLabel<TData>(
  column: Column<TData, unknown>,
): string | undefined {
  const label = column.columnDef.meta?.label;
  if (label) {
    return label;
  }
  const header = column.columnDef.header;
  return typeof header === "string" ? header : undefined;
}

/**
 * Default view state for a column set: opt-in columns start hidden (KTD-4),
 * every other column starts visible, sort is unset, and page size is the
 * KTD-5 default. U2's persistence hook uses this same function to compute
 * fallback defaults when no saved state exists.
 */
export function createDefaultTableViewState<TData>(
  columns: ColumnDef<TData>[],
): TableViewState {
  const columnVisibility: VisibilityState = {};
  for (const column of columns) {
    const id = resolveColumnId(column);
    if (column.optIn && id) {
      columnVisibility[id] = false;
    }
  }
  return { sorting: [], columnVisibility, pageSize: DEFAULT_PAGE_SIZE };
}

/** Public props for the shared `DataTable` wrapper (branch-agnostic, KTD-2). */
export interface DataTableProps<TData> {
  columns: ColumnDef<TData>[];
  data: TData[];
  /**
   * Controlled view state. Supply together with `onViewStateChange` to let a
   * caller (U2's persistence hook) own storage; omit both to let `DataTable`
   * manage its own state with the defaults above.
   */
  viewState?: TableViewState;
  onViewStateChange?: (next: TableViewState) => void;
  /** Left-aligned toolbar slot for a table's client-side filter controls. */
  filterSlot?: ReactNode;
  /** Left-aligned toolbar slot for a table's grouping-mode control (U5-U7). */
  groupingSlot?: ReactNode;
  /** Rendered in place of the table body when `data` is empty (R16). */
  emptyState?: ReactNode;
  /**
   * Marks a row as freshly-touched so it gets the `data-flash` highlight
   * (preserves the `useRowFlash` affordance after create/edit/delete).
   */
  isRowFlashed?: (row: TData) => boolean;
  /**
   * `false` while a persistence hook (U2) restores saved state; the wrapper
   * renders a neutral skeleton until `true` so restored sort/columns/page-size
   * apply on the first real paint with no defaults-then-swap flash (R3/KTD-7).
   * Defaults to `true` for self-managed usage with no persistence.
   */
  mounted?: boolean;
  /**
   * Defaults to `true`. Grouped views (U5) pass `false` so all groups render
   * on a single page with no pagination (R14).
   */
  enablePagination?: boolean;
}
