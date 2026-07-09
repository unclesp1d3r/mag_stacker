"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useRef, useState } from "react";
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
import {
  accessoryDisplayName,
  formatCostCents,
} from "@/src/domain/accessories/display";
import { AccessoryForm, type EditableFirearmOption } from "./accessory-form";
import { deleteAccessoryAction } from "./actions";

export interface AccessoryListItem {
  id: string;
  ownerId: string;
  category: string;
  brand: string;
  model: string;
  installedDate: string | null;
  costCents: number | null;
  notes: string;
  isNfa: boolean;
  currentFirearmId: string | null;
}

interface AccessoriesViewProps {
  accessories: AccessoryListItem[];
  currentUserId: string;
  /** Firearms the actor can mount to (owner or edit permission, R17). */
  editableFirearms: EditableFirearmOption[];
  /** Display names for every firearm visible to the actor, for the
   * mounted-firearm indicator column. */
  firearmNames: Record<string, string>;
  /** Firearm to pre-select as the mount target, from a firearm detail page's
   * "Add accessory" link (F1). Auto-opens the create form when present. */
  initialMountFirearmId?: string;
}

type FormState = { open: false } | { open: true };

function orDash(value: string) {
  return value.trim() !== "" ? (
    value
  ) : (
    <span className="text-muted-foreground">—</span>
  );
}

export function AccessoriesView({
  accessories,
  currentUserId,
  editableFirearms,
  firearmNames,
  initialMountFirearmId,
}: AccessoriesViewProps) {
  const router = useRouter();
  // Auto-open the create form pre-mounted to a firearm when arriving from that
  // firearm's "Add accessory" link (F1).
  const [form, setForm] = useState<FormState>(
    initialMountFirearmId ? { open: true } : { open: false },
  );
  const { flashId, flash } = useRowFlash();
  const del = useDeleteConfirmation<AccessoryListItem>({
    entityLabel: "Accessory",
    getName: accessoryDisplayName,
    remove: deleteAccessoryAction,
  });
  // `del.request` is a stable `useState` setter; depend column defs on it (not
  // the whole `del`, which is a fresh object each render) so `columns` doesn't
  // rebuild on every dialog open/close and remount the actions cell — mirrors
  // ammo/magazines/firearms views.
  const requestDelete = del.request;

  // Same-category items get a non-sensitive id-fragment suffix on the row
  // link's accessible name so a screen-reader link list stays unambiguous
  // (R17/R52-style), mirroring the ammo view's dedup on its caliber column.
  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of accessories)
      counts.set(a.category, (counts.get(a.category) ?? 0) + 1);
    return counts;
  }, [accessories]);
  const categoryCountsRef = useRef(categoryCounts);
  categoryCountsRef.current = categoryCounts;
  const linkLabel = useCallback(
    (item: AccessoryListItem): string | undefined =>
      (categoryCountsRef.current.get(item.category) ?? 0) > 1
        ? `${item.category} (#${item.id.slice(0, 6)})`
        : undefined,
    [],
  );

  const columns = useMemo<ColumnDef<AccessoryListItem>[]>(
    () => [
      {
        accessorKey: "category",
        id: "category",
        header: "Category",
        meta: { label: "Category" },
        cell: ({ row }) => (
          <Link
            href={`/accessories/${row.original.id}`}
            aria-label={linkLabel(row.original)}
            className="font-medium text-primary hover:underline"
          >
            {row.original.category}
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
        accessorKey: "model",
        id: "model",
        header: "Model",
        meta: { label: "Model" },
        cell: ({ getValue }) => orDash(getValue<string>()),
      },
      {
        id: "mount",
        header: "Mounted on",
        meta: { label: "Mounted on" },
        enableSorting: false,
        cell: ({ row }) => {
          const firearmId = row.original.currentFirearmId;
          if (!firearmId) return orDash("");
          return (
            <Link
              href={`/firearms/${firearmId}`}
              className="text-primary hover:underline"
            >
              {firearmNames[firearmId] ?? "Unknown firearm"}
            </Link>
          );
        },
      },
      {
        id: "isNfa",
        header: "NFA",
        meta: { label: "NFA" },
        enableSorting: false,
        cell: ({ row }) =>
          row.original.isNfa ? <Badge tone="destructive">NFA</Badge> : null,
      },
      {
        id: "cost",
        header: "Cost",
        meta: { numeric: true, label: "Cost" },
        cell: ({ row }) => formatCostCents(row.original.costCents) ?? "—",
      },
      {
        accessorKey: "installedDate",
        id: "installedDate",
        header: "Installed",
        meta: { label: "Installed" },
        optIn: true,
        cell: ({ getValue }) => orDash(getValue<string | null>() ?? ""),
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
          // Accessories are not independently shareable (R7) — no
          // ShareControl. Quick delete stays owner-only, mirroring firearms/
          // ammo: an edit-grantee manages a mounted accessory from the
          // firearm's detail page (U6), not this row.
          return item.ownerId === currentUserId ? (
            <div className="flex justify-end gap-1">
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
    [currentUserId, requestDelete, linkLabel, firearmNames],
  );

  const { viewState, setViewState, mounted } =
    useTableViewState<TableViewState>(
      "accessories",
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
          toolbar button once there's inventory to act on (mirrors ammo/
          magazines/firearms views). */}
      {!form.open && accessories.length > 0 ? (
        <div className="flex justify-end">
          <Button onClick={openCreate}>Add accessory</Button>
        </div>
      ) : null}

      {form.open ? (
        <Card>
          <h2 className="mb-4 text-sm font-semibold text-foreground">
            New accessory
          </h2>
          <AccessoryForm
            editableFirearms={editableFirearms}
            initialFirearmId={initialMountFirearmId}
            onDone={refresh}
            onCancel={() => setForm({ open: false })}
          />
        </Card>
      ) : null}

      {accessories.length === 0 && !form.open ? (
        <EmptyState
          title="No accessories yet"
          description="Add a part to track where it's mounted, its cost, and NFA status."
          action={
            <Button onClick={openCreate}>Add your first accessory</Button>
          }
        />
      ) : accessories.length > 0 ? (
        !mounted ? (
          <DataTableSkeleton />
        ) : (
          <DataTable
            columns={columns}
            data={accessories}
            viewState={viewState}
            onViewStateChange={onTableViewStateChange}
            mounted
            isRowFlashed={(a) => a.id === flashId}
          />
        )
      ) : null}

      <ConfirmDialog
        open={del.target !== null}
        title={`Delete “${del.target ? accessoryDisplayName(del.target) : ""}”?`}
        description="This removes the accessory from your inventory and can't be undone."
        pending={del.pending}
        onConfirm={del.confirm}
        onCancel={del.cancel}
      />
    </div>
  );
}
