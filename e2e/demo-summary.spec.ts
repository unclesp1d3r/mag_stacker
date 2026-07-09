import { authTest } from "./fixtures/auth";
import {
  captureThemed,
  demoContext,
  seedDemoData,
  skipUnlessDemo,
} from "./fixtures/demo-seed";

/**
 * README demo assets for the caliber summary. Gated behind DEMO=1 — regenerate:
 *   DEMO=1 bun run test:e2e e2e/demo-summary.spec.ts
 */
const test = authTest("demo-summary");
test.describe.configure({ retries: 0 });

test("capture summary README screenshots", async ({ browser }) => {
  skipUnlessDemo(test);
  const ctx = await demoContext(browser, "demo-summary");
  const page = await ctx.newPage();
  try {
    await seedDemoData(page);
    await page.goto("/summary");
    await page.getByText("Total ammo lots").waitFor();
    await captureThemed(page, "light", "summary-light.png", { fullPage: true });
    await captureThemed(page, "dark", "summary-dark.png", { fullPage: true });
  } finally {
    await ctx.close();
  }
});
