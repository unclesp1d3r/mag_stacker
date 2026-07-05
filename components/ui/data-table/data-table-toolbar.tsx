"use client";

import type { Table, VisibilityState } from "@tanstack/react-table";
import type { ReactNode } from "react";
import { ColumnMenu } from "./column-menu";
import { Pagination } from "./pagination";

export interface DataTableToolbarProps<TData> {
  table: Table<TData>;
  filterSlot?: ReactNode;
  groupingSlot?: ReactNode;
  /** Pagination only renders in flat (None grouping mode) views (R14). */
  showPagination: boolean;
  /**
   * Reactive view-state slices forwarded to the memoized controls. They are
   * passed as values (not read from `table`) so the controls re-render under
   * React Compiler, which cannot see the stable `table` object mutate.
   */
  columnVisibility: VisibilityState;
  pageIndex: number;
  pageSize: number;
  rowCount: number;
}

/**
 * Toolbar row above the table: a left filter/grouping area and a right
 * column-menu + pagination area. Wraps to a second row below `md` (R19
 * reflow, KTD-11a).
 */
export function DataTableToolbar<TData>({
  table,
  filterSlot,
  groupingSlot,
  showPagination,
  columnVisibility,
  pageIndex,
  pageSize,
  rowCount,
}: DataTableToolbarProps<TData>) {
  return (
    <div className="flex flex-col gap-3 border-line border-b bg-paper-raised px-4 py-3 md:flex-row md:items-center md:justify-between">
      <div className="flex flex-1 flex-wrap items-center gap-2">
        {filterSlot}
        {groupingSlot}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-3">
        <ColumnMenu table={table} columnVisibility={columnVisibility} />
        {showPagination ? (
          <Pagination
            table={table}
            pageIndex={pageIndex}
            pageSize={pageSize}
            rowCount={rowCount}
          />
        ) : null}
      </div>
    </div>
  );
}
