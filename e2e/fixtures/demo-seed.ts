import { mkdir } from "node:fs/promises";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import {
  DEMO_ACCESSORIES,
  DEMO_AMMO,
  DEMO_FIREARMS,
  DEMO_MAGAZINES,
} from "@/src/demo/inventory";
import { storageStateFor } from "./auth";
import type { SpecUserKey } from "./user-pool";

/**
 * Capture helpers for the README demo specs (`e2e/demo-*.spec.ts`).
 *
 * The sample collection itself lives in `src/demo/inventory.ts` so the plain
 * Bun seed script (`scripts/seed-demo.ts`) can share it without pulling
 * Playwright in. This module owns the UI-driven path: each demo spec
 * authenticates as its own throwaway user, types the same collection into the
 * real forms via `seedDemoData`, and captures its slice of the README assets.
 * The datasets are stored in persisted form (numbers, cents), so the form fills
 * below stringify at the point of use.
 *
 * Demo specs are gated behind `DEMO=1` (see `skipUnlessDemo`) so they don't run
 * in the normal CI suite; regenerate the images with:
 *
 *   DEMO=1 bun run test:e2e e2e/demo-accessories.spec.ts   # (or demo-*.spec.ts)
 *
 * ARIA/accessible-name selectors only — no data-testid.
 */

export {
  DEMO_ACCESSORIES,
  DEMO_AMMO,
  DEMO_FIREARMS,
  DEMO_MAGAZINES,
} from "@/src/demo/inventory";

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

/** Cents to the dollars-and-cents string the Cost field expects. */
const CENTS_PER_DOLLAR = 100;

function dollars(costCents: number): string {
  return (costCents / CENTS_PER_DOLLAR).toFixed(2);
}

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
    if (f.isNfa) {
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
    await form.getByLabel("Base capacity").fill(String(m.baseCapacity));
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
    await form.getByLabel("Load type").fill(a.type);
    await form.getByLabel("Grain").fill(String(a.grain));
    await form.getByLabel(/^Quantity/).fill(String(a.quantityRounds));
    if (a.lowStockThreshold > 0) {
      await form
        .getByLabel(/Low-stock threshold/)
        .fill(String(a.lowStockThreshold));
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
    await form.getByLabel("Type").selectOption(s.type);
    await form.getByLabel("Category").fill(s.category);
    if (s.brand) await form.getByLabel("Brand").fill(s.brand);
    if (s.model) await form.getByLabel("Model").fill(s.model);
    if (s.mount) {
      await form
        .getByLabel("Mount on firearm")
        .selectOption({ label: s.mount });
    }
    if (s.serialNumber)
      await form.getByLabel("Serial number").fill(s.serialNumber);
    if (s.costCents) await form.getByLabel("Cost").fill(dollars(s.costCents));
    if (s.isNfa) await form.getByLabel("NFA-regulated item").check();
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
