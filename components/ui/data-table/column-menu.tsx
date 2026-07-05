"use client";

import type { Table } from "@tanstack/react-table";
import { Button } from "../button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../dropdown-menu";
import { ACTIONS_COLUMN_ID, resolveColumnLabel } from "./types";

/**
 * Column show/hide control (R18): a `DropdownMenu` of checkboxes driven by the
 * table's column-visibility state. Enforces the KTD-10 floor — the last
 * enabled non-actions column cannot be unchecked — and excludes the actions
 * column from the menu entirely.
 */
export function ColumnMenu<TData>({ table }: { table: Table<TData> }) {
  const toggleableColumns = table
    .getAllLeafColumns()
    .filter((column) => column.id !== ACTIONS_COLUMN_ID && column.getCanHide());

  const visibleCount = toggleableColumns.filter((column) =>
    column.getIsVisible(),
  ).length;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" aria-label="Toggle columns">
          Columns
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>Columns</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {toggleableColumns.map((column) => {
          const label = resolveColumnLabel(column);
          if (!label) {
            return null;
          }
          const isVisible = column.getIsVisible();
          const isFloor = isVisible && visibleCount <= 1;
          return (
            <DropdownMenuCheckboxItem
              key={column.id}
              checked={isVisible}
              disabled={isFloor}
              onCheckedChange={(checked) => column.toggleVisibility(checked)}
            >
              {label}
            </DropdownMenuCheckboxItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
