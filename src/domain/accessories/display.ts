/**
 * Accessory display-label + money formatting helpers (U5). Pure — no DB, no
 * React — mirrors `src/domain/firearms/display.ts`'s shape.
 */

export interface AccessoryNameFields {
  category: string;
  brand: string;
  model: string;
}

/**
 * Primary label: "Brand Model" when either is present, else the category
 * (the one required field, mirroring `lotDisplayName`'s caliber fallback).
 */
export function accessoryDisplayName(a: AccessoryNameFields): string {
  const parts = [a.brand.trim(), a.model.trim()].filter((v) => v !== "");
  return parts.length > 0 ? parts.join(" ") : a.category;
}

/** Formats integer cents as a dollar string (e.g. `1250` -> `"$12.50"`), or null when unset. */
export function formatCostCents(cents: number | null): string | null {
  if (cents === null) return null;
  return `$${(cents / 100).toFixed(2)}`;
}

/** Integer cents -> a dollars input string (`""` when unset), for pre-filling the edit form. */
export function costCentsToInputValue(cents: number | null): string {
  return cents === null ? "" : (cents / 100).toFixed(2);
}

/**
 * Dollars input string -> integer cents, or null when blank. Non-numeric
 * input becomes `NaN`, which `validateAccessory`'s `invalidCostCents` check
 * rejects visibly instead of silently saving 0/null (mirrors ammo-form's
 * `num` guard).
 */
export function parseCostInputToCents(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  return Math.round(Number(trimmed) * 100);
}
