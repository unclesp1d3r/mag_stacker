"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useRef, useState } from "react";
import { ShareControl } from "@/app/(app)/grants/share-control";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DataTable,
  DataTableSkeleton,
} from "@/components/ui/data-table/data-table";
import {
  ACTIONS_COLUMN_ID,
  type ColumnDef,
  createDefaultTableViewState,
  type TableViewState,
} from "@/components/ui/data-table/types";
import { Badge, EmptyState } from "@/components/ui/feedback";
import { Card } from "@/components/ui/surface";
import { useDeleteConfirmation } from "@/hooks/use-delete-confirmation";
import { useRowFlash } from "@/hooks/use-row-flash";
import { useTableViewState } from "@/hooks/use-table-view-state";
import { isLowStock } from "@/src/domain/ammo/validate";
import { deleteAmmoAction } from "./actions";
import { AmmoForm, lotDisplayName } from "./ammo-form";

export interface AmmoListItem {
  id: string;
  ownerId: string;
  brand: string;
  caliber: string;
  type: string;
  grain: number;
  quantityRounds: number;
  lowStockThreshold: number;
  acquiredDate: string | null;
  notes: string;
}

interface AmmoViewProps {
  ammo: AmmoListItem[];
  currentUserId: string;
  /** Calibers seeded from the curated list + the owner's in-use calibers (R60). */
  caliberSuggestions: string[];
}

type FormState = { open: false } | { open: true };

function orDash(value: string) {
  return value.trim() !== "" ? (
    value
  ) : (
    <span className="text-muted-foreground">—</span>
  );
}

export function AmmoView({
  ammo,
  currentUserId,
  caliberSuggestions,
}: AmmoViewProps) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>({ open: false });
  const { flashId, flash } = useRowFlash();
  const del = useDeleteConfirmation<AmmoListItem>({
    entityLabel: "Lot",
    getName: lotDisplayName,
    remove: deleteAmmoAction,
  });
  // `del.request` is a stable `useState` setter; depend column defs on it (not
  // the whole `del`, which is a fresh object each render) so `columns` doesn't
  // rebuild on every dialog open/close and remount the actions cell (dropping
  // focus restore and ShareControl's own dialog state) — mirrors magazines/
  // firearms views.
  const requestDelete = del.request;

  // Same-caliber lots get a non-sensitive id-fragment suffix on the row link's
  // accessible name so a screen-reader link list stays unambiguous (R17/R52),
  // mirroring the magazines/firearms views' dedup on their own link column.
  const caliberCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of ammo)
      counts.set(a.caliber, (counts.get(a.caliber) ?? 0) + 1);
    return counts;
  }, [ammo]);
  // Ref-read keeps `linkLabel` (and thus `columns`) stable across data
  // refetches, so a list refresh (e.g. after a ShareControl grant) doesn't
  // rebuild columns and remount the actions cell mid-dialog.
  const caliberCountsRef = useRef(caliberCounts);
  caliberCountsRef.current = caliberCounts;
  const linkLabel = useCallback(
    (item: AmmoListItem): string | undefined =>
      (caliberCountsRef.current.get(item.caliber) ?? 0) > 1
        ? `${item.caliber} (#${item.id.slice(0, 6)})`
        : undefined,
    [],
  );

  const columns = useMemo<ColumnDef<AmmoListItem>[]>(
    () => [
      {
        accessorKey: "caliber",
        id: "caliber",
        header: "Caliber",
        meta: { label: "Caliber" },
        cell: ({ row }) => (
          <Link
            href={`/ammo/${row.original.id}`}
            aria-label={linkLabel(row.original)}
            className="font-medium text-primary hover:underline"
          >
            {row.original.caliber}
          </Link>
        ),
      },
      {
        accessorKey: "brand",
        id: "brand",
        header: "Brand",
        meta: { label: "Brand" },
        cell: ({ getValue }) => orDash(getValue<string>()),
      },
      {
        accessorKey: "type",
        id: "type",
        header: "Type",
        meta: { label: "Type" },
        cell: ({ getValue }) => orDash(getValue<string>()),
      },
      {
        accessorKey: "grain",
        id: "grain",
        header: "Grain",
        meta: { numeric: true, label: "Grain" },
      },
      {
        accessorKey: "quantityRounds",
        id: "quantityRounds",
        header: "Qty (rds)",
        meta: { numeric: true, label: "Qty (rds)" },
      },
      {
        accessorKey: "lowStockThreshold",
        id: "lowStockThreshold",
        header: "Low-stock at",
        meta: { numeric: true, label: "Low-stock at" },
      },
      {
        id: "status",
        header: "Status",
        meta: { label: "Status" },
        enableSorting: false,
        cell: ({ row }) =>
          isLowStock(row.original) ? (
            <Badge tone="destructive">Low stock</Badge>
          ) : null,
      },
      {
        accessorKey: "acquiredDate",
        id: "acquiredDate",
        header: "Acquired",
        meta: { label: "Acquired" },
        optIn: true,
      },
      {
        accessorKey: "notes",
        id: "notes",
        header: "Notes",
        meta: { label: "Notes" },
        optIn: true,
      },
      {
        id: ACTIONS_COLUMN_ID,
        header: () => <span className="sr-only">Actions</span>,
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => {
          const item = row.original;
          // Ammo is edit-capable-shareable (unlike magazines), but the list's
          // quick actions stay owner-only, mirroring firearms — an edit-grantee
          // manages edits from the detail page, not the row.
          return item.ownerId === currentUserId ? (
            <div className="flex justify-end gap-1">
              <ShareControl
                parentType="ammo"
                parentId={item.id}
                itemName={lotDisplayName(item)}
              />
              <Button
                variant="destructive"
                size="sm"
                onClick={() => requestDelete(item)}
              >
                Delete
              </Button>
            </div>
          ) : null;
        },
      },
    ],
    [currentUserId, requestDelete, linkLabel],
  );

  const { viewState, setViewState, mounted } =
    useTableViewState<TableViewState>(
      "ammo",
      createDefaultTableViewState(columns),
    );

  function onTableViewStateChange(next: TableViewState): void {
    setViewState(next);
  }

  function refresh(touchedId?: string) {
    setForm({ open: false });
    if (touchedId) flash(touchedId);
    router.refresh();
  }

  function openCreate() {
    setForm({ open: true });
  }

  return (
    <div className="space-y-5">
      {/* The cold-start empty state carries its own add CTA; only show this
          toolbar button once there's inventory to act on (mirrors magazines/
          firearms views). */}
      {!form.open && ammo.length > 0 ? (
        <div className="flex justify-end">
          <Button onClick={openCreate}>Add lot</Button>
        </div>
      ) : null}

      {form.open ? (
        <Card>
          <h2 className="mb-4 text-sm font-semibold text-foreground">
            New lot
          </h2>
          <AmmoForm
            caliberSuggestions={caliberSuggestions}
            onDone={refresh}
            onCancel={() => setForm({ open: false })}
          />
        </Card>
      ) : null}

      {ammo.length === 0 && !form.open ? (
        <EmptyState
          title="No ammo on hand"
          description="Add a lot to track rounds and low-stock alerts."
          action={<Button onClick={openCreate}>Add your first lot</Button>}
        />
      ) : ammo.length > 0 ? (
        !mounted ? (
          <DataTableSkeleton />
        ) : (
          <DataTable
            columns={columns}
            data={ammo}
            viewState={viewState}
            onViewStateChange={onTableViewStateChange}
            mounted
            isRowFlashed={(a) => a.id === flashId}
          />
        )
      ) : null}

      <ConfirmDialog
        open={del.target !== null}
        title={`Delete “${del.target ? lotDisplayName(del.target) : ""}”?`}
        description="This removes the lot from your inventory and can't be undone."
        pending={del.pending}
        onConfirm={del.confirm}
        onCancel={del.cancel}
      />
    </div>
  );
}
