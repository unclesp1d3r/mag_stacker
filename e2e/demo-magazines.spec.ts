import { authTest } from "./fixtures/auth";
import {
  captureThemed,
  demoContext,
  seedDemoData,
  skipUnlessDemo,
} from "./fixtures/demo-seed";

/**
 * README demo assets for the magazines list. Gated behind DEMO=1 — regenerate:
 *   DEMO=1 bun run test:e2e e2e/demo-magazines.spec.ts
 */
const test = authTest("demo-magazines");
test.describe.configure({ retries: 0 });

test("capture magazines README screenshots", async ({ browser }) => {
  skipUnlessDemo(test);
  const ctx = await demoContext(browser, "demo-magazines");
  const page = await ctx.newPage();
  try {
    await seedDemoData(page);
    await page.goto("/magazines");
    await page.getByRole("row").filter({ hasText: "PMAG" }).first().waitFor();
    await captureThemed(page, "light", "magazines-light.png");
    await captureThemed(page, "dark", "magazines-dark.png");
  } finally {
    await ctx.close();
  }
});
