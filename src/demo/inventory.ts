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
 * This module must stay dependency-free: `scripts/seed-demo.ts` is a plain Bun
 * script, and importing anything from `e2e/fixtures/` would drag Playwright in.
 */

export interface DemoFirearmSeed {
  name: string;
  caliber: string;
  /** A `FIREARM_TYPES` token — validated on write by the domain service. */
  type: string;
  /** A `FIREARM_ACTIONS` token — validated on write by the domain service. */
  action: string;
  isNfa?: boolean;
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
  mount?: string;
}

export const DEMO_FIREARMS: readonly DemoFirearmSeed[] = [
  {
    name: 'BCM 11.5" SBR',
    caliber: "5.56 NATO",
    type: "rifle",
    action: "semi-auto",
    isNfa: true,
  },
  {
    name: "SIG P320 XCarry",
    caliber: "9mm",
    type: "pistol",
    action: "semi-auto",
  },
  {
    name: "Glock 19 Gen5",
    caliber: "9mm",
    type: "pistol",
    action: "semi-auto",
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
const BULK_MAGAZINE_LINES = [
  {
    prefix: "AR",
    brandModel: "Magpul PMAG 30 GEN M3",
    caliber: "5.56 NATO",
    baseCapacity: 30,
    count: 12,
  },
  {
    prefix: "G19",
    brandModel: "Glock OEM 15-round",
    caliber: "9mm",
    baseCapacity: 15,
    extensionRounds: 2,
    count: 8,
  },
  {
    prefix: "P320",
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
] as const;

/** Two digits so labels sort lexically the way they sort numerically. */
const LABEL_DIGITS = 2;

/** Expand `BULK_MAGAZINE_LINES` into individually-labeled magazines. */
export function bulkMagazines(): DemoMagazineSeed[] {
  return BULK_MAGAZINE_LINES.flatMap((line) =>
    Array.from({ length: line.count }, (_, i) => ({
      brandModel: line.brandModel,
      caliber: line.caliber,
      baseCapacity: line.baseCapacity,
      extensionRounds: "extensionRounds" in line ? line.extensionRounds : 0,
      label: `${line.prefix}-${String(i + 1).padStart(LABEL_DIGITS, "0")}`,
      labelPrefix: line.prefix,
    })),
  );
}
