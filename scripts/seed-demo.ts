import { eq } from "drizzle-orm";
import { db } from "@/src/db/client";
import {
  accessory,
  ammo,
  firearm,
  magazine,
  magazineLabelPrefix,
} from "@/src/db/inventory-schema";
import {
  bulkMagazines,
  DEMO_ACCESSORIES,
  DEMO_AMMO,
  DEMO_FIREARMS,
  DEMO_MAGAZINES,
} from "@/src/demo/inventory";
import { createAccessory } from "@/src/domain/accessories/service";
import { createAmmo } from "@/src/domain/ammo/service";
import { createFirearm } from "@/src/domain/firearms/service";
import { createMagazine } from "@/src/domain/magazines/service";

/**
 * Demo inventory seed for a local/dev database.
 *
 * Writes the sample collection from `src/demo/inventory.ts` through the domain
 * services rather than inserting rows directly, so seeded data goes through the
 * same validation, owner resolution, and label normalization the UI does — a
 * seed that the app itself would reject is worse than no seed at all.
 *
 * Idempotent by default: if the target owner already has inventory the script
 * reports and exits without writing, so it's safe to re-run while iterating.
 * `--reset` (or `SEED_RESET=1`) wipes that owner's inventory first. The
 * destructive path stays opt-in even though the local dev DB is disposable —
 * this script reads whatever `DATABASE_URL` is set, and that isn't always the
 * database you think it is.
 *
 *   bun run seed:demo
 *   bun run seed:demo -- --reset
 *
 * Seeds the account named by SEED_EMAIL, falling back to ADMIN_EMAIL.
 */

/**
 * Clear the owner's inventory in one transaction.
 *
 * The transaction is the point: five sequential auto-committing deletes would
 * leave a half-wiped account if any one of them failed, and because the probe
 * below is what decides whether to seed, a later run could then report "already
 * has inventory; nothing to do" over data the failed run had already destroyed.
 * All or nothing instead.
 *
 * Child-first ordering: accessories reference firearms, so they go before
 * firearms. `magazine_firearm` rows cascade from either side.
 */
async function resetInventory(ownerId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(accessory).where(eq(accessory.ownerId, ownerId));
    await tx.delete(ammo).where(eq(ammo.ownerId, ownerId));
    await tx.delete(magazine).where(eq(magazine.ownerId, ownerId));
    await tx.delete(firearm).where(eq(firearm.ownerId, ownerId));
    await tx
      .delete(magazineLabelPrefix)
      .where(eq(magazineLabelPrefix.ownerId, ownerId));
  });
}

/**
 * True when the owner holds ANY seeded inventory.
 *
 * Every owned table is checked, not just `firearm`: an account holding only
 * magazines, ammo, or unmounted accessories would otherwise read as empty, so a
 * plain run would stack a second copy of the demo set on top of it and
 * `--reset` would leave those rows behind.
 */
async function hasInventory(ownerId: string): Promise<boolean> {
  const counts = await Promise.all([
    db
      .select({ id: firearm.id })
      .from(firearm)
      .where(eq(firearm.ownerId, ownerId))
      .limit(1),
    db
      .select({ id: magazine.id })
      .from(magazine)
      .where(eq(magazine.ownerId, ownerId))
      .limit(1),
    db
      .select({ id: ammo.id })
      .from(ammo)
      .where(eq(ammo.ownerId, ownerId))
      .limit(1),
    db
      .select({ id: accessory.id })
      .from(accessory)
      .where(eq(accessory.ownerId, ownerId))
      .limit(1),
  ]);
  return counts.some((rows) => rows.length > 0);
}

async function seed(ownerId: string): Promise<void> {
  // Firearms first — accessories mount to them by name, so we need their ids.
  const firearmIdByName = new Map<string, string>();
  for (const f of DEMO_FIREARMS) {
    const row = await createFirearm(ownerId, f);
    firearmIdByName.set(f.name, row.id);
  }

  // Magazine↔firearm compatibility is a core relationship (it drives the
  // "compatible magazines" count and the summary's by-firearm roll-up), so the
  // demo set has to populate it or those surfaces all read zero. Caliber is the
  // real-world rule and matches how an owner would actually link them.
  const firearmIdsByCaliber = new Map<string, string[]>();
  for (const f of DEMO_FIREARMS) {
    const id = firearmIdByName.get(f.name);
    if (!id) continue;
    firearmIdsByCaliber.set(f.caliber, [
      ...(firearmIdsByCaliber.get(f.caliber) ?? []),
      id,
    ]);
  }

  const magazines = [...DEMO_MAGAZINES, ...bulkMagazines()];
  for (const m of magazines) {
    await createMagazine(ownerId, {
      brandModel: m.brandModel,
      caliber: m.caliber,
      baseCapacity: m.baseCapacity,
      extensionRounds: m.extensionRounds ?? 0,
      label: m.label,
      labelPrefix: m.labelPrefix,
      compatibleFirearmIds: firearmIdsByCaliber.get(m.caliber) ?? [],
    });
  }

  for (const a of DEMO_AMMO) {
    await createAmmo(ownerId, a);
  }

  for (const s of DEMO_ACCESSORIES) {
    // An unknown mount name is a typo in the demo data, not an unmounted
    // accessory — fail loudly rather than silently seeding it detached.
    let firearmId: string | null = null;
    if (s.mount) {
      const mounted = firearmIdByName.get(s.mount);
      if (!mounted) {
        throw new Error(
          `Demo accessory "${s.model ?? s.category}" mounts to unknown firearm "${s.mount}".`,
        );
      }
      firearmId = mounted;
    }
    await createAccessory(ownerId, {
      category: s.category,
      brand: s.brand,
      model: s.model,
      serialNumber: s.serialNumber,
      costCents: s.costCents ?? null,
      isNfa: s.isNfa ?? false,
      firearmId,
    });
  }

  console.log(
    `Seeded ${DEMO_FIREARMS.length} firearms, ${magazines.length} magazines, ` +
      `${DEMO_AMMO.length} ammo lots, ${DEMO_ACCESSORIES.length} accessories.`,
  );
}

async function main(): Promise<void> {
  const email = process.env.SEED_EMAIL ?? process.env.ADMIN_EMAIL;
  if (!email) {
    throw new Error(
      "SEED_EMAIL or ADMIN_EMAIL must be set to pick the account to seed (see .env.example).",
    );
  }

  const owner = await db.query.user.findFirst({
    where: (u, { eq: matches }) => matches(u.email, email),
  });
  if (!owner) {
    throw new Error(
      "No account found for the configured SEED_EMAIL/ADMIN_EMAIL. Run `bun run seed:admin` first.",
    );
  }

  const shouldReset =
    process.argv.includes("--reset") || process.env.SEED_RESET === "1";

  if (await hasInventory(owner.id)) {
    if (!shouldReset) {
      console.log(
        "The target account already has inventory; nothing to do. Re-run with --reset to replace it.",
      );
      return;
    }
    console.log("Clearing existing inventory for the target account…");
    await resetInventory(owner.id);
  }

  await seed(owner.id);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Demo seed failed:", error);
    process.exit(1);
  });
