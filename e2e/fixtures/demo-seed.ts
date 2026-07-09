import { mkdir } from "node:fs/promises";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { storageStateFor } from "./auth";
import type { SpecUserKey } from "./user-pool";

/**
 * Shared sample data + helpers for the README demo specs (`e2e/demo-*.spec.ts`).
 *
 * Each demo spec authenticates as its own throwaway user, seeds this same
 * collection via `seedDemoData`, and captures its slice of the README assets —
 * so the sample data is defined once and reused everywhere. Demo specs are
 * gated behind `DEMO=1` (see `skipUnlessDemo`) so they don't run in the normal
 * CI suite; regenerate the images with:
 *
 *   DEMO=1 bun run test:e2e e2e/demo-accessories.spec.ts   # (or demo-*.spec.ts)
 *
 * ARIA/accessible-name selectors only — no data-testid.
 */

export const SHOTS_DIR = "docs/images";

/** Skip a demo spec unless DEMO=1 — keeps asset generation out of CI. */
export function skipUnlessDemo(test: {
  skip: (c: boolean, r: string) => void;
}) {
  test.skip(
    !process.env.DEMO,
    "README demo asset generation — run with DEMO=1",
  );
}

export const DEMO_FIREARMS = [
  {
    name: 'BCM 11.5" SBR',
    caliber: "5.56 NATO",
    type: "rifle",
    action: "semi-auto",
    nfa: true,
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
] as const;

export const DEMO_MAGAZINES = [
  {
    brandModel: "Magpul PMAG 30 GEN M3",
    caliber: "5.56 NATO",
    baseCapacity: "30",
  },
  { brandModel: "Glock OEM 17-round", caliber: "9mm", baseCapacity: "17" },
  { brandModel: "SIG P320 21-round", caliber: "9mm", baseCapacity: "21" },
] as const;

export const DEMO_AMMO = [
  { brand: "Federal", caliber: "5.56 NATO", loadType: "FMJ", quantity: "500" },
  {
    brand: "Speer Gold Dot",
    caliber: "9mm",
    loadType: "JHP",
    quantity: "150",
    lowStock: "200",
  },
] as const;

export interface AccessorySeed {
  category: string;
  brand?: string;
  model?: string;
  serial?: string;
  cost?: string;
  nfa?: boolean;
  mount?: string;
}

export const DEMO_ACCESSORIES: AccessorySeed[] = [
  {
    category: "Optic",
    brand: "Aimpoint",
    model: "CompM5",
    serial: "AP-CM5-88213",
    cost: "850.00",
    mount: 'BCM 11.5" SBR',
  },
  {
    category: "Suppressor",
    brand: "SureFire",
    model: "SOCOM556-RC2",
    serial: "S556-04217",
    cost: "1100.00",
    nfa: true,
    mount: 'BCM 11.5" SBR',
  },
  {
    category: "Trigger",
    brand: "Geissele",
    model: "SSA-E",
    cost: "240.00",
    mount: 'BCM 11.5" SBR',
  },
  {
    category: "Light",
    brand: "SureFire",
    model: "X300U-B",
    serial: "X300-11902",
    cost: "310.00",
    mount: "SIG P320 XCarry",
  },
  {
    category: "Optic",
    brand: "Trijicon",
    model: "ACOG TA31",
    serial: "ACOG-7781",
    cost: "1500.00",
  },
] as const;

/**
 * A high-DPI context for crisp screenshots, authenticated as `userKey`. Caller
 * closes it. Larger than the app's e2e default so tables/detail pages frame well.
 */
export async function demoContext(
  browser: Browser,
  userKey: SpecUserKey,
): Promise<BrowserContext> {
  return browser.newContext({
    storageState: storageStateFor(userKey),
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
}

/** Emulate the OS color scheme (the app defaults to `system`) and screenshot. */
export async function captureThemed(
  page: Page,
  theme: "light" | "dark",
  file: string,
  opts: { fullPage?: boolean } = {},
): Promise<void> {
  await mkdir(SHOTS_DIR, { recursive: true });
  await page.emulateMedia({ colorScheme: theme });
  await page.waitForTimeout(300);
  await page.screenshot({
    path: `${SHOTS_DIR}/${file}`,
    fullPage: opts.fullPage ?? false,
  });
}

/**
 * Seed the full sample collection (firearms → magazines → ammo → accessories)
 * via the UI on a fresh per-spec user. Idempotency is unnecessary — each demo
 * user starts empty. Reused by every demo spec so the sample data lives in one
 * place.
 */
export async function seedDemoData(page: Page): Promise<void> {
  // --- Firearms ---
  await page.goto("/firearms");
  for (let i = 0; i < DEMO_FIREARMS.length; i++) {
    const f = DEMO_FIREARMS[i];
    await page
      .getByRole("button", {
        name: i === 0 ? "Add your first firearm" : "Add firearm",
      })
      .click();
    const form = page.locator("form");
    await form.getByLabel(/^Name/).fill(f.name);
    await form.getByLabel("Caliber").fill(f.caliber);
    await form.getByLabel(/^Type/).selectOption(f.type);
    await form.getByLabel("Action").selectOption(f.action);
    if ("nfa" in f && f.nfa) {
      await form.getByLabel(/NFA-regulated item/).check();
    }
    await page.getByRole("button", { name: "Add firearm" }).click();
    await page.getByRole("link", { name: f.name }).first().waitFor();
  }

  // --- Magazines ---
  await page.goto("/magazines");
  for (let i = 0; i < DEMO_MAGAZINES.length; i++) {
    const m = DEMO_MAGAZINES[i];
    await page
      .getByRole("button", {
        name: i === 0 ? "Add your first magazine" : "Add magazine",
      })
      .click();
    const form = page.locator("form");
    await form.getByLabel("Brand / model").fill(m.brandModel);
    await form.getByLabel("Caliber").fill(m.caliber);
    await form.getByLabel("Base capacity").fill(m.baseCapacity);
    await page.getByRole("button", { name: "Add magazine" }).click();
    await page
      .getByRole("row")
      .filter({ hasText: m.brandModel })
      .first()
      .waitFor();
  }

  // --- Ammo ---
  await page.goto("/ammo");
  for (let i = 0; i < DEMO_AMMO.length; i++) {
    const a = DEMO_AMMO[i];
    await page
      .getByRole("button", {
        name: i === 0 ? "Add your first lot" : "Add lot",
      })
      .click();
    const form = page.locator("form");
    await form.getByLabel("Brand").fill(a.brand);
    await form.getByLabel("Caliber").fill(a.caliber);
    await form.getByLabel("Load type").fill(a.loadType);
    await form.getByLabel(/^Quantity/).fill(a.quantity);
    if ("lowStock" in a && a.lowStock) {
      await form.getByLabel(/Low-stock threshold/).fill(a.lowStock);
    }
    await page.getByRole("button", { name: "Add lot" }).click();
    await page.getByRole("row").filter({ hasText: a.brand }).first().waitFor();
  }

  // --- Accessories ---
  await page.goto("/accessories");
  for (let i = 0; i < DEMO_ACCESSORIES.length; i++) {
    const s = DEMO_ACCESSORIES[i];
    await page
      .getByRole("button", {
        name: i === 0 ? "Add your first accessory" : "Add accessory",
      })
      .click();
    const form = page.locator("form");
    await form.getByLabel("Category").fill(s.category);
    if (s.brand) await form.getByLabel("Brand").fill(s.brand);
    if (s.model) await form.getByLabel("Model").fill(s.model);
    if (s.mount) {
      await form
        .getByLabel("Mount on firearm")
        .selectOption({ label: s.mount });
    }
    if (s.serial) await form.getByLabel("Serial number").fill(s.serial);
    if (s.cost) await form.getByLabel("Cost").fill(s.cost);
    if (s.nfa) await form.getByLabel("NFA-regulated item").check();
    await page.getByRole("button", { name: "Add accessory" }).click();
    await page
      .getByRole("row")
      .filter({ hasText: s.model ?? s.category })
      .first()
      .waitFor();
  }
}

/** The SBR firearm's detail URL id, read from the firearms list. */
export async function sbrFirearmId(page: Page): Promise<string> {
  await page.goto("/firearms");
  const href = await page
    .getByRole("link", { name: 'BCM 11.5" SBR' })
    .getAttribute("href");
  return href?.split("/firearms/")[1] ?? "";
}
