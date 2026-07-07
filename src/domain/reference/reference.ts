import { and, inArray, ne } from "drizzle-orm";
import { getVisibleIds } from "@/src/auth/visibility";
import { CALIBERS_RAW, MANUFACTURERS_RAW } from "@/src/data/raw";
import type { DbOrTx } from "@/src/db/client";
import { ammo, firearm, magazine } from "@/src/db/schema";

// ---------------------------------------------------------------------------
// Text-file headers to strip during parse.
// ---------------------------------------------------------------------------

const CALIBER_HEADERS = new Set([
  "Cartridge",
  "Common Rifle Caliber Name",
  "Handgun Cartridge",
]);

// ---------------------------------------------------------------------------
// Internal parse helper
// ---------------------------------------------------------------------------

/**
 * Splits `content` on newlines, trims each line, drops blanks and any line
 * that appears in `headers`, case-sensitive deduplicates, then sorts ascending.
 * Returns a new array each call.
 */
function parseTextLines(content: string, headers?: Set<string>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (headers?.has(line)) continue;
    if (seen.has(line)) continue;
    seen.add(line);
    result.push(line);
  }
  return result.sort((a, b) => a.localeCompare(b));
}

// ---------------------------------------------------------------------------
// Module-level parse cache — loaded once, never mutated.
// ---------------------------------------------------------------------------

const CALIBER_CACHE: readonly string[] = parseTextLines(
  CALIBERS_RAW,
  CALIBER_HEADERS,
);

const MANUFACTURER_CACHE: readonly string[] = parseTextLines(MANUFACTURERS_RAW);

// ---------------------------------------------------------------------------
// Pure exports — R74: no DB connection required.
// ---------------------------------------------------------------------------

/**
 * Returns the curated list of standard calibers, sorted ascending.
 * R59: every call returns a fresh copy; callers cannot mutate the cache.
 * R74: pure — no DB connection required.
 */
export function standardCalibers(): string[] {
  return [...CALIBER_CACHE];
}

/**
 * Returns the curated list of firearm manufacturers, sorted ascending.
 * R59: every call returns a fresh copy; callers cannot mutate the cache.
 * R74: pure — no DB connection required.
 */
export function manufacturers(): string[] {
  return [...MANUFACTURER_CACHE];
}

// ---------------------------------------------------------------------------
// DB-dependent exports
// ---------------------------------------------------------------------------

/**
 * Returns distinct non-blank calibers from the user's visible firearms,
 * magazines, and ammo lots (owned ∪ granted), sorted ascending (R60).
 */
export async function distinctCalibers(
  db: DbOrTx,
  userId: string,
): Promise<string[]> {
  const [firearmIds, magazineIds, ammoIds] = await Promise.all([
    getVisibleIds(db, userId, "firearm"),
    getVisibleIds(db, userId, "magazine"),
    getVisibleIds(db, userId, "ammo"),
  ]);

  // The three per-table lookups are independent — run them as one batch
  // (result order is irrelevant: values land in a Set and sort at the end).
  const distinctFrom = (
    table: typeof firearm | typeof magazine | typeof ammo,
    ids: Set<string>,
  ) =>
    ids.size > 0
      ? db
          .selectDistinct({ caliber: table.caliber })
          .from(table)
          .where(and(inArray(table.id, [...ids]), ne(table.caliber, "")))
      : Promise.resolve([]);

  const rows = await Promise.all([
    distinctFrom(firearm, firearmIds),
    distinctFrom(magazine, magazineIds),
    distinctFrom(ammo, ammoIds),
  ]);

  const seen = new Set<string>();
  for (const { caliber } of rows.flat()) seen.add(caliber);

  return [...seen].sort((a, b) => a.localeCompare(b));
}

/**
 * Returns the union of the curated caliber list and the user's distinct
 * in-use calibers, sorted ascending (R60 — write / input path).
 */
export async function calibersForInput(
  db: DbOrTx,
  userId: string,
): Promise<string[]> {
  const distinct = await distinctCalibers(db, userId);
  const merged = new Set<string>([...CALIBER_CACHE, ...distinct]);
  return [...merged].sort((a, b) => a.localeCompare(b));
}

/**
 * Returns calibers actually present in the user's visible inventory,
 * sorted ascending (R60 — read / filter path).
 * Delegates to {@link distinctCalibers}.
 */
export async function calibersForFilter(
  db: DbOrTx,
  userId: string,
): Promise<string[]> {
  return distinctCalibers(db, userId);
}
