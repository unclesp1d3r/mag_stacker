import { eq } from "drizzle-orm";
import { resolveCreateOwner } from "@/src/auth/authorize";
import { NotFoundError } from "@/src/auth/errors";
import { bulkAddCost, mutationLimiter } from "@/src/auth/rate-limit";
import { getVisibleIds } from "@/src/auth/visibility";
import { db, type Transaction } from "@/src/db/client";
import { withIdempotency } from "@/src/db/idempotency";
import { magazine, magazineFirearm, user } from "@/src/db/schema";
import { ValidationError } from "@/src/domain/errors";
import { dedupeFirearmIds } from "@/src/domain/magazines/compatibility";
import {
  MAGPUL_LABEL_ALLOWED_RE,
  MAX_LABEL_LENGTH,
  normalizeMagpulLabel,
} from "@/src/domain/magazines/constants";
import { recordPrefix } from "@/src/domain/magazines/prefixes";
import type { MagazineWithCompatibility } from "@/src/domain/magazines/service";
import {
  type MagazineFields,
  type MagazineValidationCode,
  validateMagazine,
} from "@/src/domain/magazines/validate";
import { generateLabels, nextLabelStart } from "./labels";

/**
 * Bulk add (U10). Creates N magazines from a template with the parity label
 * algorithm, sequence continuation, deep-copied compatibility, single-transaction
 * atomicity (R57), create-on-behalf ownership (KTD-5), and idempotency (KTD-9).
 */

export interface BulkAddTemplate extends MagazineFields {
  acquiredDate?: string | null;
  notes?: string;
  compatibleFirearmIds?: string[];
}

export interface BulkAddOptions {
  /** Create-on-behalf target owner; defaults to the acting user. */
  ownerId?: string;
  /** Client-generated key for double-submit protection (R69). */
  idempotencyKey?: string;
}

export async function bulkAddMagazines(
  actorId: string,
  template: BulkAddTemplate,
  count: number,
  labelPrefix: string,
  options: BulkAddOptions = {},
): Promise<MagazineWithCompatibility[]> {
  // Validate the template with addCount=count before any write (R53).
  const codes = validateMagazine(template, count);
  if (codes.length > 0) throw new ValidationError(codes);

  // Bound write load (KTD-10); throws RateLimitError before touching the store.
  await mutationLimiter.consume(actorId, bulkAddCost(count));

  const firearmIds = dedupeFirearmIds(template.compatibleFirearmIds ?? []);

  const run = async (tx: Transaction): Promise<MagazineWithCompatibility[]> => {
    const owner = await resolveCreateOwner(tx, actorId, options.ownerId);

    // The owner's Magpul mode governs (KTD-2). When on, the generated labels
    // must satisfy the same dot-matrix constraint as single add/edit.
    const [ownerRow] = await tx
      .select({ magpulMode: user.magpulMode })
      .from(user)
      .where(eq(user.id, owner))
      .limit(1);
    if (!ownerRow) throw new NotFoundError();
    const ownerMagpulMode = ownerRow.magpulMode ?? false;
    // Normalize the prefix (uppercase + outer-trim) so generated labels store
    // and sequence-continue consistently with single add. Off-mode still trims:
    // an untrimmed prefix would generate "US 01" labels but record the trimmed
    // "US", desyncing the sequence scan (R55) from what was written.
    const effectivePrefix = ownerMagpulMode
      ? normalizeMagpulLabel(labelPrefix)
      : labelPrefix.trim();

    // Every template link must be visible to the acting user (R37), checked in
    // the same transaction so a concurrent revoke cannot race the create.
    if (firearmIds.length > 0) {
      const visible = await getVisibleIds(tx, actorId, "firearm");
      for (const id of firearmIds) {
        if (!visible.has(id)) {
          throw new NotFoundError(
            `compatible firearm ${id} is not visible to the actor`,
          );
        }
      }
    }

    // Continue the label sequence past the owner's highest matching label (R55).
    const existing = await tx
      .select({ label: magazine.label })
      .from(magazine)
      .where(eq(magazine.ownerId, owner));
    const start = nextLabelStart(
      existing.map((r) => r.label),
      effectivePrefix,
    );
    const labels = generateLabels(effectivePrefix, count, start);

    // Reject the whole batch (R57 atomicity) if Magpul mode is on and any
    // generated label breaks the charset or 4-char cap — e.g. a prefix with
    // disallowed characters, or a prefix+sequence that runs past 4 chars.
    // Empty labels (blank prefix) stay valid. Reject, never truncate (R5).
    if (ownerMagpulMode) {
      const offending = labels.find(
        (label) =>
          !MAGPUL_LABEL_ALLOWED_RE.test(label) ||
          label.length > MAX_LABEL_LENGTH,
      );
      if (offending !== undefined) {
        const codes: MagazineValidationCode[] = [];
        if (!MAGPUL_LABEL_ALLOWED_RE.test(offending))
          codes.push("invalidMagpulLabel");
        if (offending.length > MAX_LABEL_LENGTH)
          codes.push("magpulLabelTooLong");
        throw new ValidationError(codes);
      }
    }

    const created = await tx
      .insert(magazine)
      .values(
        labels.map((label) => ({
          ownerId: owner,
          brandModel: template.brandModel,
          caliber: template.caliber,
          baseCapacity: template.baseCapacity,
          extensionRounds: template.extensionRounds,
          label,
          acquiredDate: template.acquiredDate ?? null,
          notes: template.notes ?? "",
        })),
      )
      .returning();

    // Remember the prefix the owner used (#22), no-op when blank. Same tx, so a
    // rolled-back batch leaves the list unchanged.
    await recordPrefix(tx, owner, effectivePrefix);

    // Each magazine gets its own (deep-copied) compatibility rows (R56).
    if (firearmIds.length > 0) {
      const linkRows = created.flatMap((mag) =>
        firearmIds.map((firearmId, ordinal) => ({
          magazineId: mag.id,
          firearmId,
          ordinal,
        })),
      );
      await tx.insert(magazineFirearm).values(linkRows);
    }

    return created.map((mag) => ({
      ...mag,
      compatibleFirearmIds: [...firearmIds],
    }));
  };

  if (options.idempotencyKey) {
    return withIdempotency(actorId, options.idempotencyKey, run);
  }
  return db.transaction(run);
}
