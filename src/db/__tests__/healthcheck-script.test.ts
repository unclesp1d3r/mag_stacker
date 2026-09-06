import { describe, expect, test } from "bun:test";
import { type FetchLike, healthUrl, probe } from "@/scripts/healthcheck";

/**
 * Exit-code contract of the container probe (issue #14, U3, KTD4). The script
 * is what Docker's HEALTHCHECK and the Compose `app` healthcheck run, so a
 * wrong mapping here would make an outage look healthy. Lives under `src/` so
 * `bun test src` and the pre-commit gate run it.
 */
function respondingWith(status: number): FetchLike {
  return async () => new Response(null, { status });
}

describe("scripts/healthcheck.ts (U3)", () => {
  test("builds the probe URL on port 3000 when PORT is unset", () => {
    expect(healthUrl({})).toBe("http://127.0.0.1:3000/api/health");
  });

  test("builds the probe URL on PORT when it is set", () => {
    expect(healthUrl({ PORT: "4100" })).toBe(
      "http://127.0.0.1:4100/api/health",
    );
  });

  test("falls back to port 3000 when PORT is not a valid port", () => {
    expect(healthUrl({ PORT: "not-a-port" })).toBe(
      "http://127.0.0.1:3000/api/health",
    );
    expect(healthUrl({ PORT: "0" })).toBe("http://127.0.0.1:3000/api/health");
    expect(healthUrl({ PORT: "70000" })).toBe(
      "http://127.0.0.1:3000/api/health",
    );
    expect(healthUrl({ PORT: "65535" })).toBe(
      "http://127.0.0.1:65535/api/health",
    );
  });

  test("status 200 maps to exit code 0", async () => {
    expect(await probe(respondingWith(200), {})).toBe(0);
  });

  test("status 503 maps to exit code 1", async () => {
    expect(await probe(respondingWith(503), {})).toBe(1);
  });

  test("a 307 redirect is not followed and maps to exit code 1", async () => {
    let redirectMode: string | undefined;
    const fetchImpl = (async (_input: unknown, init?: RequestInit) => {
      redirectMode = init?.redirect;
      return new Response(null, {
        status: 307,
        headers: { location: "/login" },
      });
    }) as FetchLike;
    expect(await probe(fetchImpl, {})).toBe(1);
    expect(redirectMode).toBe("manual");
  });

  test("a thrown network error maps to exit code 1", async () => {
    const fetchImpl: FetchLike = async () => {
      throw new TypeError("fetch failed");
    };
    expect(await probe(fetchImpl, {})).toBe(1);
  });
});
