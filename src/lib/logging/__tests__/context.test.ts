import { describe, expect, test } from "bun:test";
import { getContext, mintCorrelationId, runWithContext } from "../context";

describe("runWithContext / getContext", () => {
  test("getContext returns the seeded fields inside the callback", () => {
    runWithContext(
      { correlationId: "cid-1", entrypoint: "firearms", actorId: "u1" },
      () => {
        const ctx = getContext();
        expect(ctx?.correlationId).toBe("cid-1");
        expect(ctx?.entrypoint).toBe("firearms");
        expect(ctx?.actorId).toBe("u1");
      },
    );
  });

  test("getContext returns undefined outside any runWithContext", () => {
    expect(getContext()).toBeUndefined();
  });

  test("a sibling call outside runWithContext does not see the store", () => {
    runWithContext({ correlationId: "cid-2" }, () => {
      expect(getContext()?.correlationId).toBe("cid-2");
    });

    expect(getContext()).toBeUndefined();
  });

  test("a call nested inside runWithContext sees the store", () => {
    function nested(): string | undefined {
      return getContext()?.correlationId;
    }

    runWithContext({ correlationId: "cid-3" }, () => {
      expect(nested()).toBe("cid-3");
    });
  });

  test("async work inside runWithContext still sees the store after an await", async () => {
    await runWithContext({ correlationId: "cid-async" }, async () => {
      await Promise.resolve();
      expect(getContext()?.correlationId).toBe("cid-async");
    });
  });
});

describe("mintCorrelationId", () => {
  test("returns distinct values across calls", () => {
    const a = mintCorrelationId();
    const b = mintCorrelationId();
    expect(a).not.toBe(b);
  });

  test("returns a well-formed UUID string", () => {
    const id = mintCorrelationId();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });
});
