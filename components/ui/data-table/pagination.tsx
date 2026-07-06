"use client";

import type { Table } from "@tanstack/react-table";
import { useId } from "react";
import { Button } from "../button";
import { Select } from "../select";
import { PAGE_SIZE_OPTIONS } from "./types";

export interface PaginationProps<TData> {
  table: Table<TData>;
  /**
   * Reactive values, passed in rather than read from `table.getState()` so this
   * memoized control re-renders under React Compiler (the `table` reference is
   * stable even as its internal state mutates). Actions still call `table`
   * methods, which read fresh state at call time.
   */
  pageIndex: number;
  pageSize: number;
  rowCount: number;
}

/** Prev/next buttons plus a page-size select (R18); shows the current range and page (KTD-5). */
export function Pagination<TData>({
  table,
  pageIndex,
  pageSize,
  rowCount,
}: PaginationProps<TData>) {
  const pageSizeId = useId();
  const pageCount = rowCount === 0 ? 0 : Math.ceil(rowCount / pageSize);
  const rangeStart = rowCount === 0 ? 0 : pageIndex * pageSize + 1;
  const rangeEnd = Math.min(rowCount, (pageIndex + 1) * pageSize);
  const canPrevious = pageIndex > 0;
  const canNext = pageIndex < pageCount - 1;

  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="font-mono text-xs text-ink-faint tabular">
        {rowCount === 0 ? "0 of 0" : `${rangeStart}–${rangeEnd} of ${rowCount}`}
      </span>
      <div className="flex items-center gap-2">
        <label
          htmlFor={pageSizeId}
          className="font-mono text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-ink-faint"
        >
          Rows
        </label>
        <Select
          id={pageSizeId}
          value={pageSize}
          onChange={(event) => table.setPageSize(Number(event.target.value))}
          className="h-8 w-[4.5rem] px-2 text-xs"
        >
          {PAGE_SIZE_OPTIONS.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          aria-label="Previous page"
          disabled={!canPrevious}
          onClick={() => table.previousPage()}
        >
          Prev
        </Button>
        <span className="font-mono text-xs text-ink-faint tabular">
          {pageCount === 0
            ? "Page 0 of 0"
            : `Page ${pageIndex + 1} of ${pageCount}`}
        </span>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Next page"
          disabled={!canNext}
          onClick={() => table.nextPage()}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
