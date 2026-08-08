/**
 * Accessory display-label + money formatting helpers (U5). Pure — no DB, no
 * React — mirrors `src/domain/firearms/display.ts`'s shape.
 */

import { accessoryTypeLabel } from "./constants";

export interface AccessoryNameFields {
  type: string;
  category: string;
  brand: string;
  model: string;
}

/**
 * Primary label: "Brand Model" when either is present, else the category, else
 * the type's display label.
 *
 * The final fallback exists because #23 R3 relaxed `category` to optional —
 * before that it was required and could always carry the label. An accessory
 * created with only a type would otherwise render as an empty string in the
 * list and detail heading, which reads as a broken row rather than a
 * minimally-described one.
 */
export function accessoryDisplayName(a: AccessoryNameFields): string {
  const parts = [a.brand.trim(), a.model.trim()].filter((v) => v !== "");
  if (parts.length > 0) return parts.join(" ");
  // Return the TRIMMED category, not the raw one: migration 0022 preserves
  // pre-existing categories verbatim, so padded values like "  light  " are
  // real stored data and would otherwise reach the link's accessible name.
  const category = a.category.trim();
  return category !== "" ? category : accessoryTypeLabel(a.type);
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
