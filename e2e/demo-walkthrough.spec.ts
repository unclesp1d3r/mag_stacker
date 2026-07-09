import { copyFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { authTest, storageStateFor } from "./fixtures/auth";
import {
  SHOTS_DIR,
  sbrFirearmId,
  seedDemoData,
  skipUnlessDemo,
} from "./fixtures/demo-seed";

/**
 * README walkthrough recording. Records a webm to `docs/images/demo-walkthrough.webm`;
 * `just demo-images` converts it to `docs/images/demo.gif` with ffmpeg. Gated
 * behind DEMO=1. Regenerate:
 *   DEMO=1 bun run test:e2e e2e/demo-walkthrough.spec.ts
 *
 * A visible arrow cursor + subtitle bar are injected for legibility (re-injected
 * after every navigation, since they live in the DOM that navigation replaces).
 */
const test = authTest("demo-walkthrough");
test.describe.configure({ retries: 0 });

const WEBM = `${SHOTS_DIR}/demo-walkthrough.webm`;

async function injectOverlays(page: Page): Promise<void> {
  await page.evaluate(() => {
    if (!document.getElementById("demo-cursor")) {
      const cursor = document.createElement("div");
      cursor.id = "demo-cursor";
      cursor.innerHTML = `<svg width="26" height="26" viewBox="0 0 24 24" fill="none"><path d="M5 3L19 12L12 13L9 20L5 3Z" fill="white" stroke="black" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
      cursor.style.cssText =
        "position:fixed;z-index:2147483647;pointer-events:none;width:26px;height:26px;left:0;top:0;transition:left .12s,top .12s;filter:drop-shadow(1px 1px 2px rgba(0,0,0,.35));";
      document.body.appendChild(cursor);
      document.addEventListener("mousemove", (e) => {
        cursor.style.left = `${e.clientX}px`;
        cursor.style.top = `${e.clientY}px`;
      });
    }
    if (!document.getElementById("demo-subtitle")) {
      const bar = document.createElement("div");
      bar.id = "demo-subtitle";
      bar.style.cssText =
        'position:fixed;bottom:0;left:0;right:0;z-index:2147483646;text-align:center;padding:14px 24px;background:rgba(0,0,0,.78);color:#fff;font-family:-apple-system,"Segoe UI",sans-serif;font-size:18px;font-weight:600;letter-spacing:.2px;opacity:0;transition:opacity .3s;pointer-events:none;';
      document.body.appendChild(bar);
    }
  });
}

async function say(page: Page, text: string): Promise<void> {
  await page.evaluate((t) => {
    const bar = document.getElementById("demo-subtitle");
    if (!bar) return;
    bar.textContent = t;
    bar.style.opacity = t ? "1" : "0";
  }, text);
  if (text) await page.waitForTimeout(700);
}

async function moveTo(page: Page, x: number, y: number): Promise<void> {
  await page.mouse.move(x, y, { steps: 12 });
  await page.waitForTimeout(300);
}

async function go(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await injectOverlays(page);
}

test("record README walkthrough", async ({ browser }) => {
  skipUnlessDemo(test);
  await mkdir(SHOTS_DIR, { recursive: true });

  const ctx = await browser.newContext({
    storageState: storageStateFor("demo-walkthrough"),
    viewport: { width: 1280, height: 720 },
    recordVideo: {
      dir: `${SHOTS_DIR}/.video`,
      size: { width: 1280, height: 720 },
    },
  });
  const page = await ctx.newPage();

  try {
    await seedDemoData(page);

    await go(page, "/magazines");
    await say(page, "MagStacker — your collection, actually organized");
    await moveTo(page, 640, 320);
    await page.waitForTimeout(1400);

    const sbr = await sbrFirearmId(page);
    await injectOverlays(page);
    await go(page, `/firearms/${sbr}`);
    await say(page, "Firearms — and everything mounted on them");
    await page.evaluate(() =>
      window.scrollTo({ top: 520, behavior: "smooth" }),
    );
    await page.waitForTimeout(1800);

    await go(page, "/accessories");
    await say(page, "Track every part — cost, serial, NFA status");
    await moveTo(page, 640, 360);
    await page.waitForTimeout(1600);

    await go(page, "/summary");
    await say(page, "Roll it all up by caliber");
    await page.waitForTimeout(1600);

    await say(page, "Light or dark — your call");
    const toggle = page.getByRole("button", { name: /Theme:/ });
    const box = await toggle.boundingBox();
    if (box) await moveTo(page, box.x + box.width / 2, box.y + box.height / 2);
    await toggle.click();
    await page.waitForTimeout(1400);
    await toggle.click();
    await page.waitForTimeout(1200);
    await say(page, "");
    await page.waitForTimeout(600);
  } finally {
    await ctx.close();
    const video = page.video();
    if (video) {
      const src = await video.path();
      copyFileSync(src, WEBM);
    }
  }
});
