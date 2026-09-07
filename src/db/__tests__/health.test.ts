import { describe, expect, test } from "bun:test";
import { validateFirearm } from "@/src/domain/firearms/validate";
import {
  DatabaseUnavailableError,
  isConnectionError,
  probeDatabase,
  withDatabase,
} from "../health";

describe("database health surface (U12, R74)", () => {
  test("isConnectionError recognizes socket and Postgres connection codes", () => {
    expect(isConnectionError({ code: "ECONNREFUSED" })).toBe(true);
    expect(isConnectionError({ code: "08006" })).toBe(true);
    expect(isConnectionError(new Error("plain error"))).toBe(false);
    expect(isConnectionError(null)).toBe(false);
  });

  test("withDatabase maps a connection failure to a clear, non-leaking error", async () => {
    const conn = Object.assign(
      new Error("connect ECONNREFUSED 10.0.0.5:5432"),
      {
        code: "ECONNREFUSED",
      },
    );
    await expect(
      withDatabase(() => Promise.reject(conn)),
    ).rejects.toBeInstanceOf(DatabaseUnavailableError);
    // The message does not leak the original connection detail.
    await withDatabase(() => Promise.reject(conn)).catch((e: unknown) => {
      expect((e as Error).message).not.toContain("10.0.0.5");
    });
  });

  test("withDatabase passes through non-connection errors unchanged", async () => {
    const other = new Error("constraint violation");
    await expect(withDatabase(() => Promise.reject(other))).rejects.toBe(other);
  });

  test("withDatabase returns the value on success", async () => {
    expect(await withDatabase(() => Promise.resolve(42))).toBe(42);
  });

  test("a pure validation call succeeds with no database (R74)", () => {
    expect(
      validateFirearm({
        name: "",
        caliber: "9mm",
        type: "pistol",
        action: "semi-auto",
      }),
    ).toEqual(["emptyName"]);
  });

  test("probeDatabase returns true against a reachable database over its own client (KTD2)", async () => {
    expect(await probeDatabase()).toBe(true);
  });

  test("probeDatabase single-flights concurrent callers onto one probe", async () => {
    const first = probeDatabase();
    const second = probeDatabase();
    expect(second).toBe(first);
    expect(await first).toBe(true);
    // Once settled, the next call is a fresh probe.
    expect(probeDatabase()).not.toBe(first);
  });
});
