import { expect, test } from "@playwright/test";

/**
 * Unauthenticated health contract (issue #14, R1/R3) against the production
 * build the launcher boots. Because this runs through the compiled `proxy.ts`
 * matcher, it is the regression guard for the `/api/health` exclusion (KTD3):
 * a 3xx here means the auth gate swallowed the probe and redirected it to
 * `/login`. No `storageState` is loaded on purpose — the request must carry no
 * session cookie.
 */
test.describe("GET /api/health (U2)", () => {
  test("covers AE1: answers 200 and the ok body with no session", async ({
    request,
  }) => {
    const response = await request.get("/api/health", { maxRedirects: 0 });
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("no-store");
    expect(await response.json()).toEqual({ status: "ok", db: "ok" });
  });

  test("sibling paths under the health prefix stay auth-gated", async ({
    request,
  }) => {
    for (const path of ["/api/healthz", "/api/health/anything"]) {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status(), path).toBeGreaterThanOrEqual(300);
      expect(response.status(), path).toBeLessThan(400);
      expect(response.headers().location, path).toContain("/login");
    }
  });

  test("HEAD answers 200 with an empty body", async ({ request }) => {
    const response = await request.head("/api/health", { maxRedirects: 0 });
    expect(response.status()).toBe(200);
    expect(await response.text()).toBe("");
  });
});
