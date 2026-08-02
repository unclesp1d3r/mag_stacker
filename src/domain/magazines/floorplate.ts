/**
 * Floorplate cell-count lookup (U2, KTD4; R3, R4, R5). Pure — no DB, no
 * React.
 *
 * Resolves a magazine's free-text `brandModel` to how many PMAG Gen M3 dot
 * cells its floorplate holds, per one face (the Product Contract's
 * session-settled "a floorplate's cell count means one face" decision). The
 * list is a built-in, code-only lookup — not owner-editable (also
 * session-settled) — and evolves through code changes the same way
 * `src/domain/firearms/constants.ts` evolves its taxonomy lists, not through
 * a UI.
 *
 * A miss is not harmless: it renders under R4's 4-cell fallback, which is
 * confidently wrong guidance for a magazine that actually holds fewer cells.
 * That is why every entry — including 4-cell models — is listed explicitly
 * (KTD4): a match means a *confirmed* count, and a wrong count on a matched
 * entry is worse than an unrecognized model, because the unrecognized case
 * at least carries R4's "unverified" caveat.
 */

/** Fallback cell count for a `brandModel` matching no known entry (R4). */
export const FALLBACK_CELL_COUNT = 4;

interface ModelCellCountEntry {
  /** Human-readable label for the entry; not matched against, documentation only. */
  readonly name: string;
  /** Every token must appear (as a substring) in the normalized model for a match. */
  readonly tokens: readonly string[];
  /** Per-face dot cell count for this family. */
  readonly cells: number;
}

/**
 * Ordered most-specific-first (KTD4): the first entry whose tokens all match
 * wins. Keyed on the distinctive family marker alone — never a brand token
 * like `PMAG` — because `MAGPUL` does not contain the substring `PMAG`, and
 * requiring it would reject the natural shorthand `Magpul GL9`.
 *
 * Expected to grow as counts are sourced and cross-checked (see the plan's
 * Dependencies section). A wrong count here is worse than a missing entry: a
 * matched entry carries no "unverified" caveat, so an error is silently
 * presented as confirmed.
 */
export const MODEL_CELL_COUNTS: readonly ModelCellCountEntry[] = [
  { name: "GL9 family", tokens: ["GL9"], cells: 2 },
  {
    name: "PMAG 20 LR/SR GEN M3 (Magpul naming)",
    tokens: ["LRSR"],
    cells: 4,
  },
  {
    name: "7.62x51 PMAG (caliber spelled into the model string)",
    tokens: ["762X51"],
    cells: 4,
  },
];

/** Uppercases and strips every character outside `A-Z0-9` into one dense token. */
export function normalizeModel(brandModel: string): string {
  return brandModel.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export interface CellCountResolution {
  cells: number;
  matched: boolean;
}

/**
 * Resolves `brandModel` to a per-face cell count. Matches by required-
 * substring containment against the normalized model, first match wins
 * (KTD4). An empty, whitespace-only, or unrecognized `brandModel` returns
 * the fallback with `matched: false` — never throws.
 */
export function resolveCellCount(brandModel: string): CellCountResolution {
  const normalized = normalizeModel(brandModel);

  for (const entry of MODEL_CELL_COUNTS) {
    if (entry.tokens.every((token) => normalized.includes(token))) {
      return { cells: entry.cells, matched: true };
    }
  }

  return { cells: FALLBACK_CELL_COUNT, matched: false };
}
