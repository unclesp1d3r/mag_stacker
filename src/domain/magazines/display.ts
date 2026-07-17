/**
 * Magazine display-label resolution (U6). Pure — no DB, no React. Mirrors
 * `firearmDisplayName` (`src/domain/firearms/display.ts`): a magazine carries
 * a required canonical `brandModel` and an optional owner `label`. `label` is
 * `text().notNull().default("")` (see `src/db/inventory-schema.ts`), so an
 * unlabeled magazine has `label === ""` rather than `null` — the primary
 * label is the trimmed `label` when non-empty, else `brandModel`.
 */

export interface MagazineNameFields {
  label: string;
  brandModel: string;
}

/** The primary label: the (trimmed) label when present, else the brand/model. */
export function magazineDisplayName(m: MagazineNameFields): string {
  return m.label.trim() !== "" ? m.label.trim() : m.brandModel;
}
