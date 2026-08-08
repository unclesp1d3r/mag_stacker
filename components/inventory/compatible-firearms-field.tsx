"use client";

import Link from "next/link";

/**
 * The "which firearms does this fit" checkbox picker, shared by the magazine
 * and accessory forms (#23 U6 — the issue's explicit DRY ask).
 *
 * Both parents express the SAME relation (`magazine_firearm` /
 * `accessory_firearm`) with the same ordinal semantics, so they get the same
 * control rather than two that drift apart in affordance, empty state, or
 * accessible naming.
 *
 * Selection order is meaningful: it becomes the stored ordinal, which is the
 * order the detail views read back. `onToggle` therefore appends on select
 * rather than re-sorting.
 *
 * Targeted in tests by its legend and each firearm's visible label — no
 * `data-testid` (#23 R18).
 */

export interface FirearmOption {
  id: string;
  name: string;
  /** Non-sensitive disambiguator for same-named firearms (never the serial, R52). */
  hint?: string;
}

interface CompatibleFirearmsFieldProps {
  /** Firearms the actor may link — already visibility-scoped by the caller. */
  options: FirearmOption[];
  /** Currently selected ids, in ordinal order. */
  selectedIds: string[];
  onToggle: (id: string) => void;
  /** Overrides the default legend (e.g. "Fits these firearms"). */
  legend?: string;
}

export function CompatibleFirearmsField({
  options,
  selectedIds,
  onToggle,
  legend = "Compatible firearms",
}: CompatibleFirearmsFieldProps) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium text-foreground">{legend}</legend>
      {options.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          <Link
            href="/firearms"
            className="font-medium text-primary underline-offset-2 hover:underline"
          >
            Add a firearm
          </Link>{" "}
          first to link compatibility.
        </p>
      ) : (
        <div className="max-h-44 overflow-y-auto rounded-md border border-border bg-card p-1">
          {options.map((f) => (
            <label
              key={f.id}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted"
            >
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={selectedIds.includes(f.id)}
                onChange={() => onToggle(f.id)}
              />
              <span>{f.name}</span>
              {f.hint ? (
                <span className="text-xs text-muted-foreground">
                  ({f.hint})
                </span>
              ) : null}
            </label>
          ))}
        </div>
      )}
    </fieldset>
  );
}

/**
 * Toggle one id in an ordinal-ordered selection: append on select (so the
 * stored ordinal follows the order the owner actually clicked), filter on
 * deselect. Returns a new array — never mutates the input.
 */
export function toggleCompatibleFirearm(
  selectedIds: string[],
  id: string,
): string[] {
  return selectedIds.includes(id)
    ? selectedIds.filter((x) => x !== id)
    : [...selectedIds, id];
}
