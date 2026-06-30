import { describe, expect, test } from "bun:test";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";

const BASE = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";

// --- Proxy gate (pure, no DB) ----------------------------------------------
describe("proxy auth gate (optimistic, no DB)", () => {
  test("covers F1: an unauthenticated request to a gated route redirects to login", () => {
    const request = new NextRequest(new URL("/magazines", BASE));
    const response = proxy(request);
    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(response.status).toBeLessThan(400);
    const location = response.headers.get("location") ?? "";
    expect(location).toContain("/login");
    // The redirect carries no owned data — it is a bare redirect response.
    expect(response.headers.get("content-type") ?? "").not.toContain(
      "application/json",
    );
  });

  test("a request carrying a session cookie is allowed through (downstream still re-checks)", () => {
    const request = new NextRequest(new URL("/magazines", BASE), {
      headers: { cookie: "better-auth.session_token=forged.value" },
    });
    const response = proxy(request);
    // Optimistic pass — proxy does not validate; the page/action does (R66).
    expect(response.headers.get("location")).toBeNull();
  });
});

// --- Live auth flow via auth.handler (needs the DB + seeded admin) ----------
// The seeded admin (scripts/seed-admin.ts) must exist; run `bun run seed:admin`
// against the compose DB before these. Skipped when DATABASE_URL is unset.
const liveAuth = process.env.DATABASE_URL ? describe : describe.skip;

liveAuth("Better Auth HTTP surface", () => {
  // Import lazily so the pure proxy tests run without a DB.
  async function handler() {
    const { auth } = await import("@/auth");
    return auth.handler.bind(auth);
  }

  const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@example.com";
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "localadminpassword";

  // A fresh client IP per test isolates each from the DB-backed rate-limit
  // buckets so a re-run within the 60s window does not interfere.
  let ipCounter = 0;
  function freshIp(): string {
    ipCounter += 1;
    const run = Math.floor(Math.random() * 250) + 1;
    return `198.51.${run}.${ipCounter}`;
  }

  test("the health route returns ok", async () => {
    const h = await handler();
    const res = await h(new Request(`${BASE}/api/auth/ok`));
    expect(res.status).toBe(200);
  });

  test("there is no public sign-up path (R7)", async () => {
    const h = await handler();
    const res = await h(
      new Request(`${BASE}/api/auth/sign-up/email`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "intruder@example.com",
          password: "tryingtosignup123",
          name: "Intruder",
        }),
      }),
    );
    expect(res.status).not.toBe(200);
  });

  test("a valid email+password sign-in establishes a session that resolves the user", async () => {
    const h = await handler();
    const res = await h(
      new Request(`${BASE}/api/auth/sign-in/email`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": freshIp(),
        },
        body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
      }),
    );
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("session_token");

    // The session cookie resolves the user on a subsequent request.
    const cookie = setCookie.split(";")[0];
    const sessionRes = await h(
      new Request(`${BASE}/api/auth/get-session`, { headers: { cookie } }),
    );
    expect(sessionRes.status).toBe(200);
    const session = (await sessionRes.json()) as {
      user?: { email?: string };
    } | null;
    expect(session?.user?.email).toBe(ADMIN_EMAIL);
  });

  test("an admin endpoint without a session is rejected (R7)", async () => {
    const h = await handler();
    const res = await h(
      new Request(`${BASE}/api/auth/admin/list-users`, {
        method: "GET",
      }),
    );
    expect([401, 403]).toContain(res.status);
  });

  test("repeated wrong-password sign-ins are rate-limited within the window (R7a)", async () => {
    const h = await handler();
    const ip = freshIp();
    let sawRateLimit = false;
    // The /sign-in/email rule allows a few attempts per window; hammer past it
    // from one client IP.
    for (let i = 0; i < 12; i++) {
      const res = await h(
        new Request(`${BASE}/api/auth/sign-in/email`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-forwarded-for": ip,
          },
          body: JSON.stringify({
            email: ADMIN_EMAIL,
            password: "wrong-password",
          }),
        }),
      );
      if (res.status === 429) {
        sawRateLimit = true;
        break;
      }
    }
    expect(sawRateLimit).toBe(true);
  });
});
