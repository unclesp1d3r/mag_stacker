/**
 * Demo inventory — the single definition of the sample collection.
 *
 * Two consumers, deliberately different shapes at the edges:
 *
 * - `scripts/seed-demo.ts` writes these straight through the domain services,
 *   so the values here are already in persisted form (numbers, `costCents`,
 *   controlled `type`/`action` tokens).
 * - `e2e/fixtures/demo-seed.ts` types them into forms for the README captures,
 *   so it stringifies at the call site (`String(m.baseCapacity)`, dollars from
 *   cents). That conversion lives with the caller that needs it rather than in
 *   a shared adapter — one caller, one line each.
 *
 * This module imports only pure domain constants — never anything from
 * `e2e/fixtures/`, which would drag Playwright into the plain Bun seed script.
 */

import { format } from "date-fns";
import type {
  FirearmAction,
  FirearmType,
} from "@/src/domain/firearms/constants";
import { MAX_LABEL_LENGTH } from "@/src/domain/magazines/constants";

export interface DemoFirearmSeed {
  name: string;
  caliber: string;
  type: FirearmType;
  action: FirearmAction;
  isNfa?: boolean;
  /**
   * Days before "now" this firearm was acquired (service-intervals plan,
   * R22/U6). A day COUNT, not a stored date — `isoDateDaysAgo` resolves it
   * relative to whenever the seed actually runs, so the demo keeps showing a
   * mix of due and not-due service rules indefinitely rather than going
   * stale the day after it was written. Omitted means no acquired date (the
   * origin date falls back to record creation, KTD9).
   */
  acquiredDaysAgo?: number;
}

export interface DemoMagazineSeed {
  brandModel: string;
  caliber: string;
  baseCapacity: number;
  extensionRounds?: number;
  label?: string;
  labelPrefix?: string;
}

export interface DemoAmmoSeed {
  brand: string;
  caliber: string;
  /** Load type — free text (FMJ / JHP / ...), never a controlled set (R6). */
  type: string;
  grain: number;
  quantityRounds: number;
  lowStockThreshold: number;
}

export interface DemoAccessorySeed {
  category: string;
  brand?: string;
  model?: string;
  serialNumber?: string;
  costCents?: number;
  isNfa?: boolean;
  /** Mount target, by firearm `name` — resolved to an id at seed time. */
  mount?: DemoFirearmName;
}

export const DEMO_FIREARMS = [
  {
    name: 'BCM 11.5" SBR',
    caliber: "5.56 NATO",
    type: "rifle",
    action: "semi-auto",
    isNfa: true,
    acquiredDaysAgo: 900,
  },
  {
    name: "SIG P320 XCarry",
    caliber: "9mm",
    type: "pistol",
    action: "semi-auto",
    isNfa: false,
    acquiredDaysAgo: 400,
  },
  {
    name: "Glock 19 Gen5",
    caliber: "9mm",
    type: "pistol",
    action: "semi-auto",
    isNfa: false,
    acquiredDaysAgo: 150,
  },
] as const satisfies readonly DemoFirearmSeed[];

/**
 * ISO calendar date (`YYYY-MM-DD`) `daysAgo` days before "now", built from
 * local Y/M/D components rather than a UTC offset (service-intervals plan
 * KTD5) — matches how the derivation core compares calendar days, so a seed
 * fixture built here lands on the same local day a viewer's due computation
 * measures against. `date-fns`'s `format` reads the same local Y/M/D getters
 * `setDate`'s local calendar-day rollover already leaves in place, so this is
 * behavior-equivalent to (and replaces) a manual padStart build.
 */
export function isoDateDaysAgo(daysAgo: number): string {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return format(date, "yyyy-MM-dd");
}

/**
 * The firearm names this module declares. `DemoAccessorySeed.mount` is typed to
 * this, so renaming a firearm without updating its accessories is a typecheck
 * error rather than a throw partway through seeding.
 */
export type DemoFirearmName = (typeof DEMO_FIREARMS)[number]["name"];

/**
 * Category default rule seeds (service-intervals plan, U10) — arms the whole
 * collection from "settings" before any item is visited (F1), the same way an
 * owner would. Days-only thresholds keep the demo's due state legible without
 * also having to seed range-session rows to drive the sessions/rounds axes.
 */
export interface DemoServiceDefaultSeed {
  scope: "firearm" | "accessory";
  category: string;
  name: string;
  intervalDays?: number | null;
  intervalSessions?: number | null;
  intervalRounds?: number | null;
}

export const DEMO_SERVICE_DEFAULTS: readonly DemoServiceDefaultSeed[] = [
  { scope: "firearm", category: "rifle", name: "Cleaning", intervalDays: 180 },
  { scope: "firearm", category: "rifle", name: "Barrel", intervalDays: 730 },
  {
    scope: "firearm",
    category: "pistol",
    name: "Cleaning",
    intervalDays: 120,
  },
];

/**
 * Per-item overrides and suppressions (F3, AE1, AE5) — a couple, not a whole
 * second default set, so the demo shows divergence without obscuring the
 * live-inheritance story the defaults above already tell.
 */
export interface DemoServiceOverrideSeed {
  firearmName: DemoFirearmName;
  name: string;
  suppressed?: boolean;
  intervalDays?: number | null;
}

export const DEMO_SERVICE_OVERRIDES: readonly DemoServiceOverrideSeed[] = [
  // The SBR sees harder use than an average rifle, so its barrel interval is
  // tightened well below the rifle default — the override stands even after
  // the default later changes (F3/AE1).
  { firearmName: 'BCM 11.5" SBR', name: "Barrel", intervalDays: 365 },
  // A nightstand gun the owner doesn't want nagged about — a suppressed rule
  // never surfaces as due, however overdue it would otherwise read (AE5).
  { firearmName: "Glock 19 Gen5", name: "Cleaning", suppressed: true },
];

/**
 * Service history (R14/R17) — `daysAgo` is relative to seed time (like
 * `DemoFirearmSeed.acquiredDaysAgo`), resolved through `isoDateDaysAgo`.
 * Logging the SBR's Cleaning rule recently means its panel shows one due rule
 * (Barrel, overridden above) beside one not-due rule (Cleaning) at the same
 * time — the mix a demo where everything is due would never prove.
 */
export interface DemoServiceHistorySeed {
  firearmName: DemoFirearmName;
  ruleName: string;
  daysAgo: number;
  notes?: string;
}

export const DEMO_SERVICE_HISTORY: readonly DemoServiceHistorySeed[] = [
  {
    firearmName: 'BCM 11.5" SBR',
    ruleName: "Cleaning",
    daysAgo: 30,
    notes: "Wiped down and lubed after the range.",
  },
];

/** The curated three used by the README captures. */
export const DEMO_MAGAZINES: readonly DemoMagazineSeed[] = [
  {
    brandModel: "Magpul PMAG 30 GEN M3",
    caliber: "5.56 NATO",
    baseCapacity: 30,
  },
  { brandModel: "Glock OEM 17-round", caliber: "9mm", baseCapacity: 17 },
  { brandModel: "SIG P320 21-round", caliber: "9mm", baseCapacity: 21 },
];

export const DEMO_AMMO: readonly DemoAmmoSeed[] = [
  {
    brand: "Federal",
    caliber: "5.56 NATO",
    type: "FMJ",
    grain: 55,
    quantityRounds: 500,
    lowStockThreshold: 0,
  },
  {
    brand: "Speer Gold Dot",
    caliber: "9mm",
    type: "JHP",
    grain: 124,
    quantityRounds: 150,
    lowStockThreshold: 200,
  },
];

export const DEMO_ACCESSORIES: readonly DemoAccessorySeed[] = [
  {
    category: "Optic",
    brand: "Aimpoint",
    model: "CompM5",
    serialNumber: "AP-CM5-88213",
    costCents: 85_000,
    mount: 'BCM 11.5" SBR',
  },
  {
    category: "Suppressor",
    brand: "SureFire",
    model: "SOCOM556-RC2",
    serialNumber: "S556-04217",
    costCents: 110_000,
    isNfa: true,
    mount: 'BCM 11.5" SBR',
  },
  {
    category: "Trigger",
    brand: "Geissele",
    model: "SSA-E",
    costCents: 24_000,
    mount: 'BCM 11.5" SBR',
  },
  {
    category: "Light",
    brand: "SureFire",
    model: "X300U-B",
    serialNumber: "X300-11902",
    costCents: 31_000,
    mount: "SIG P320 XCarry",
  },
  {
    category: "Optic",
    brand: "Trijicon",
    model: "ACOG TA31",
    serialNumber: "ACOG-7781",
    costCents: 150_000,
  },
];

/**
 * Numbered magazine lines, expanded by `bulkMagazines()`.
 *
 * The curated three above are enough for a README screenshot but nowhere near
 * enough to judge the dense table — no pagination, no sort that means anything,
 * no column of labels to check tabular alignment against. These lines expand to
 * a realistic multi-caliber locker and exercise the label auto-numbering prefix
 * list (#22) at the same time.
 */
/**
 * One numbered magazine line. `extensionRounds` is optional because most lines
 * have none; a named interface (rather than an `as const` array of differently
 * shaped literals) is what lets `bulkMagazines` read the field directly instead
 * of probing for it with `in`.
 */
interface BulkMagazineLine {
  /**
   * Label prefix. Kept to two characters because Magpul mode caps a label at
   * `MAX_LABEL_LENGTH` (4) dot-matrix cells — see the budget check below.
   */
  readonly prefix: string;
  readonly brandModel: string;
  readonly caliber: string;
  readonly baseCapacity: number;
  readonly extensionRounds?: number;
  readonly count: number;
}

const BULK_MAGAZINE_LINES: readonly BulkMagazineLine[] = [
  {
    prefix: "AR",
    brandModel: "Magpul PMAG 30 GEN M3",
    caliber: "5.56 NATO",
    baseCapacity: 30,
    count: 12,
  },
  {
    prefix: "GL",
    brandModel: "Glock OEM 15-round",
    caliber: "9mm",
    baseCapacity: 15,
    extensionRounds: 2,
    count: 8,
  },
  {
    prefix: "SG",
    brandModel: "SIG P320 21-round",
    caliber: "9mm",
    baseCapacity: 21,
    count: 6,
  },
  {
    prefix: "AK",
    brandModel: "Magpul PMAG 30 AK/AKM",
    caliber: "7.62x39",
    baseCapacity: 30,
    count: 4,
  },
];

/** Two digits so labels sort lexically the way they sort numerically. */
const LABEL_DIGITS = 2;

/**
 * Expand `BULK_MAGAZINE_LINES` into individually-labeled magazines.
 *
 * Labels must fit the Magpul dot-matrix rule — `MAX_LABEL_LENGTH` (4) cells of
 * `A-Z`, `0-9`, and hyphen — because `createMagazine` enforces it for any owner
 * with Magpul mode enabled. An earlier version generated `AR-01` / `P320-01`
 * (5-7 characters), which meant `just db-seed` failed outright with
 * `magpulLabelTooLong` for such an owner; it only appeared to work because the
 * seeded admin defaults to `magpulMode: false`. Two-character prefixes plus two
 * digits spend the budget exactly, so there is no room for a hyphen.
 */
export function bulkMagazines(): DemoMagazineSeed[] {
  return BULK_MAGAZINE_LINES.flatMap((line) => {
    const label = (index: number) =>
      `${line.prefix}${String(index + 1).padStart(LABEL_DIGITS, "0")}`;
    // Guards the budget at the source: a longer prefix or a third digit is a
    // seed-authoring mistake, not something to discover as a validation error
    // partway through writing rows.
    if (label(line.count - 1).length > MAX_LABEL_LENGTH) {
      throw new Error(
        `Demo magazine prefix "${line.prefix}" with ${line.count} entries exceeds the ${MAX_LABEL_LENGTH}-character Magpul label budget.`,
      );
    }
    return Array.from({ length: line.count }, (_, i) => ({
      brandModel: line.brandModel,
      caliber: line.caliber,
      baseCapacity: line.baseCapacity,
      extensionRounds: line.extensionRounds ?? 0,
      label: label(i),
      labelPrefix: line.prefix,
    }));
  });
}
