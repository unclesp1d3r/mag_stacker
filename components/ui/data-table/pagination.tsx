"use client";

import type { Table } from "@tanstack/react-table";
import { useId } from "react";
import { Button } from "../button";
import { Select } from "../select";
import { PAGE_SIZE_OPTIONS } from "./types";

/** Prev/next buttons plus a page-size select (R18); shows the current range and page (KTD-5). */
export function Pagination<TData>({ table }: { table: Table<TData> }) {
  const pageSizeId = useId();
  const { pageIndex, pageSize } = table.getState().pagination;
  const rowCount = table.getPrePaginationRowModel().rows.length;
  const pageCount = table.getPageCount();
  const rangeStart = rowCount === 0 ? 0 : pageIndex * pageSize + 1;
  const rangeEnd = Math.min(rowCount, (pageIndex + 1) * pageSize);

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
          disabled={!table.getCanPreviousPage()}
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
          disabled={!table.getCanNextPage()}
          onClick={() => table.nextPage()}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
