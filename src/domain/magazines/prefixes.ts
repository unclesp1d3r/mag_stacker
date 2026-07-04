import { asc, eq } from "drizzle-orm";
import { type DbOrTx, db } from "@/src/db/client";
import { magazine, magazineLabelPrefix } from "@/src/db/schema";
import { nextStartForPrefixes } from "@/src/domain/bulkadd/labels";

/**
 * Per-owner label-prefix list (#22). Owner-scoped read/record helpers over the
 * `magazine_label_prefix` table. The recorded prefix is the *effective* prefix
 * the caller used to generate labels (already Magpul-normalized when that mode
 * is on), so the stored list stays consistent with the labels that were written.
 * Grows-only in v1 — there is no delete/rename path (KTD-1).
 */

/**
 * Record `prefix` for `ownerId` if it is non-empty. Idempotent: a repeat of an
 * existing `(owner, prefix)` is a no-op via `ON CONFLICT DO NOTHING`. Must run
 * inside the same transaction as the magazine insert so a rolled-back create
 * leaves no orphaned prefix (KTD-5).
 */
export async function recordPrefix(
  database: DbOrTx,
  ownerId: string,
  prefix: string,
): Promise<void> {
  const trimmed = prefix.trim();
  if (trimmed === "") return;
  await database
    .insert(magazineLabelPrefix)
    .values({ ownerId, prefix: trimmed })
    .onConflictDoNothing();
}

/** The owner's prefixes, alphabetical. */
export async function listPrefixes(ownerId: string): Promise<string[]> {
  const rows = await db
    .select({ prefix: magazineLabelPrefix.prefix })
    .from(magazineLabelPrefix)
    .where(eq(magazineLabelPrefix.ownerId, ownerId))
    .orderBy(asc(magazineLabelPrefix.prefix));
  return rows.map((r) => r.prefix);
}

/**
 * Everything the single-add form needs to offer prefixes and prefill labels:
 * the owner's prefix list plus a `prefix -> next start` map computed from the
 * owner's full label set (not the filtered page view). Client prefills with the
 * pure `generateLabels`; a newly typed prefix absent from the map defaults to 1.
 */
export async function getPrefixData(ownerId: string): Promise<{
  prefixes: string[];
  nextStart: Record<string, number>;
}> {
  const [prefixRows, labelRows] = await Promise.all([
    db
      .select({ prefix: magazineLabelPrefix.prefix })
      .from(magazineLabelPrefix)
      .where(eq(magazineLabelPrefix.ownerId, ownerId))
      .orderBy(asc(magazineLabelPrefix.prefix)),
    db
      .select({ label: magazine.label })
      .from(magazine)
      .where(eq(magazine.ownerId, ownerId)),
  ]);
  const prefixes = prefixRows.map((r) => r.prefix);
  const nextStart = nextStartForPrefixes(
    labelRows.map((r) => r.label),
    prefixes,
  );
  return { prefixes, nextStart };
}
