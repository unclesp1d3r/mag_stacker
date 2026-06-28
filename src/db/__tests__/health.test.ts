import { describe, expect, test } from "bun:test";
import { validateFirearm } from "@/src/domain/firearms/validate";
import {
  checkDatabase,
  DatabaseUnavailableError,
  isConnectionError,
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
    expect(validateFirearm({ name: "", caliber: "9mm" })).toEqual([
      "emptyName",
    ]);
  });

  const live = process.env.DATABASE_URL ? test : test.skip;
  live("checkDatabase returns true against a reachable database", async () => {
    expect(await checkDatabase()).toBe(true);
  });
});
