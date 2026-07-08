"use client";

import Link from "next/link";
import { Badge, EmptyState } from "@/components/ui/feedback";
import { Card } from "@/components/ui/surface";

/**
 * The subset of an accessory row this section needs to render. Kept narrow
 * (rather than importing the full `Accessory` DB row type) so the page only
 * has to shape what's actually displayed.
 */
export interface MountedAccessoryRow {
  id: string;
  category: string;
  brand: string;
  model: string;
  isNfa: boolean;
  costCents: number | null;
}

interface MountedAccessoriesProps {
  firearmId: string;
  accessories: MountedAccessoryRow[];
  /** Derived sum of `costCents` across `accessories` (null treated as 0). Never stored (R9). */
  totalValueCents: number;
  /** True when the actor owns or has edit rights on the firearm (KTD7). */
  canEdit: boolean;
}

/** `costCents` → a formatted `$X.XX` string. */
function formatCostCents(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

/** Brand + model when either is set, else the category (mirrors firearm's name-fallback shape). */
function accessoryLabel(a: MountedAccessoryRow): string {
  const brandModel = [a.brand, a.model]
    .filter((s) => s.trim() !== "")
    .join(" ");
  return brandModel !== "" ? brandModel : a.category;
}

const addAccessoryButtonClass =
  "inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-transparent bg-primary px-3 text-sm font-medium text-primary-foreground transition-[filter,background-color,color,transform] duration-150 hover:brightness-105 active:translate-y-px active:brightness-95";

export function MountedAccessories({
  firearmId,
  accessories,
  totalValueCents,
  canEdit,
}: MountedAccessoriesProps) {
  return (
    <Card>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            Mounted accessories
          </h2>
          <p className="text-xs text-muted-foreground tabular">
            {accessories.length} accessor
            {accessories.length === 1 ? "y" : "ies"} ·{" "}
            {formatCostCents(totalValueCents)} total value
          </p>
        </div>
        {canEdit ? (
          // Pre-fills the mount target on the accessories create flow via the
          // `mountFirearm` query param (contract shared with the accessories
          // surface — see U6 report for reconciliation with U5).
          <Link
            href={`/accessories?mountFirearm=${firearmId}`}
            className={addAccessoryButtonClass}
          >
            Add accessory
          </Link>
        ) : null}
      </div>

      {accessories.length === 0 ? (
        <EmptyState
          title="No accessories mounted."
          description={
            canEdit
              ? "Add an accessory and mount it to this firearm."
              : undefined
          }
        />
      ) : (
        <ul className="divide-y divide-border">
          {accessories.map((a) => (
            <li
              key={a.id}
              className="flex items-center justify-between gap-3 py-2"
            >
              <Link
                href={`/accessories/${a.id}`}
                className="min-w-0 flex-1 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="block truncate text-sm font-medium text-foreground hover:underline">
                  {accessoryLabel(a)}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {a.category}
                </span>
              </Link>
              <div className="flex shrink-0 items-center gap-2">
                {a.isNfa ? <Badge tone="destructive">NFA</Badge> : null}
                <span className="tabular text-sm text-foreground">
                  {a.costCents !== null ? formatCostCents(a.costCents) : "—"}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
