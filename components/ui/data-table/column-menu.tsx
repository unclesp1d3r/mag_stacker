"use client";

import type { Table, VisibilityState } from "@tanstack/react-table";
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

export interface ColumnMenuProps<TData> {
  table: Table<TData>;
  /**
   * Reactive visibility map, passed in rather than read from `table` so this
   * memoized control re-renders under React Compiler when a column is toggled
   * (the `table` reference is stable even as its state mutates).
   */
  columnVisibility: VisibilityState;
}

/**
 * Column show/hide control (R18): a `DropdownMenu` of checkboxes driven by the
 * table's column-visibility state. Enforces the KTD-10 floor — the last
 * enabled non-actions column cannot be unchecked — and excludes the actions
 * column from the menu entirely.
 */
export function ColumnMenu<TData>({
  table,
  columnVisibility,
}: ColumnMenuProps<TData>) {
  const toggleableColumns = table
    .getAllLeafColumns()
    .filter((column) => column.id !== ACTIONS_COLUMN_ID && column.getCanHide());

  // Derive visibility from the reactive prop (default: visible unless the map
  // explicitly says false) so the count and checkboxes reflect the latest state.
  const isColumnVisible = (id: string) => columnVisibility[id] !== false;
  const visibleCount = toggleableColumns.filter((column) =>
    isColumnVisible(column.id),
  ).length;

  return (
    // Non-modal: the menu stays open while toggling and does not aria-hide the
    // table, so column changes are visible live (to users and assistive tech)
    // as each box is checked.
    <DropdownMenu modal={false}>
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
          const isVisible = isColumnVisible(column.id);
          const isFloor = isVisible && visibleCount <= 1;
          return (
            <DropdownMenuCheckboxItem
              key={column.id}
              checked={isVisible}
              disabled={isFloor}
              // Keep the menu open so a user can toggle several columns in one
              // pass (standard column-visibility UX); Radix otherwise closes it
              // on each select.
              onSelect={(event) => event.preventDefault()}
              onCheckedChange={(checked) =>
                column.toggleVisibility(checked === true)
              }
            >
              {label}
            </DropdownMenuCheckboxItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
