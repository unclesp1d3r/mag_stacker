import { beforeEach, describe, expect, mock, test } from "bun:test";
import { getContext } from "../context";

/**
 * Unit tests for the U3 entry-point wrappers (R10, R19, KTD-4). Mocks
 * `@/src/auth/session` (`mock.module`, mirroring the pattern in
 * `app/(app)/firearms/__tests__/documents-actions.test.ts`) rather than
 * exercising a real session, so these run without `DATABASE_URL`.
 */

let currentUser: { id: string; name: string } | null = {
  id: "u1",
  name: "Alice",
};
let sessionShouldThrow = false;
mock.module("@/src/auth/session", () => ({
  getCurrentUser: async () => {
    if (sessionShouldThrow) throw new Error("session backend down");
    return currentUser;
  },
}));

const { withActionContext, withAdminActionContext, withRequestContext } =
  await import("../entry-context");

beforeEach(() => {
  currentUser = { id: "u1", name: "Alice" };
  sessionShouldThrow = false;
});

describe("withActionContext", () => {
  test("two log-context reads inside one invocation share a correlationId; a second invocation gets a different one", async () => {
    let firstRead: string | undefined;
    let secondRead: string | undefined;
    await withActionContext("test-module", async () => {
      firstRead = getContext()?.correlationId;
      secondRead = getContext()?.correlationId;
      return { ok: true };
    });
    expect(firstRead).toBeDefined();
    expect(firstRead).toBe(secondRead);

    let thirdRead: string | undefined;
    await withActionContext("test-module", async () => {
      thirdRead = getContext()?.correlationId;
      return { ok: true };
    });
    expect(thirdRead).toBeDefined();
    expect(thirdRead).not.toBe(firstRead);
  });

  test("seeds the context with the resolved actor id and name", async () => {
    let seenActorId: string | undefined;
    let seenActorName: string | undefined;
    await withActionContext("test-module", async () => {
      seenActorId = getContext()?.actorId;
      seenActorName = getContext()?.actorName;
      return { ok: true };
    });
    expect(seenActorId).toBe("u1");
    expect(seenActorName).toBe("Alice");
  });

  test("a session-resolution failure returns an error ActionResult instead of rejecting", async () => {
    sessionShouldThrow = true;
    let seenCorrelationId: string | undefined;

    // Should resolve (not reject) to a toActionError-shaped result, and the
    // base correlation context is established before session resolution.
    const result = await withActionContext("test-module", async () => {
      seenCorrelationId = getContext()?.correlationId;
      return { ok: true };
    });

    expect(result.ok).toBe(false);
    // Handler never ran, so it never read the context.
    expect(seenCorrelationId).toBeUndefined();
  });

  test("drops an email-shaped actor name so it can't leak past key-based redaction", async () => {
    currentUser = { id: "u1", name: "alice@example.com" };
    let seenActorName: string | undefined;
    let seenActorId: string | undefined;
    await withActionContext("test-module", async () => {
      seenActorName = getContext()?.actorName;
      seenActorId = getContext()?.actorId;
      return { ok: true };
    });
    // The email-shaped name is dropped; actorId (a safe UUID) still identifies
    // the actor, and logAction/the mixin fall back to it.
    expect(seenActorName).toBeUndefined();
    expect(seenActorId).toBe("u1");
  });

  test("a handler returning {ok:true,data} passes it through unchanged", async () => {
    const result = await withActionContext("test-module", async (userId) => ({
      ok: true,
      data: { id: `created-by-${userId}` },
    }));

    expect(result).toEqual({ ok: true, data: { id: "created-by-u1" } });
  });

  test("a handler that throws yields a toActionError-shaped ActionResult", async () => {
    const result = await withActionContext("test-module", async () => {
      throw new Error("boom");
    });

    expect(result.ok).toBe(false);
  });

  test("unauthenticated getCurrentUser returns an error ActionResult without invoking the handler", async () => {
    currentUser = null;
    let handlerCalled = false;

    const result = await withActionContext("test-module", async () => {
      handlerCalled = true;
      return { ok: true };
    });

    expect(handlerCalled).toBe(false);
    expect(result.ok).toBe(false);
  });
});

describe("withAdminActionContext", () => {
  test("seeds actorId/actorName from the resolved user and passes the full user to the handler", async () => {
    currentUser = { id: "admin-1", name: "Admin" };
    let seenUser: unknown;
    let seenActorId: string | undefined;
    let seenActorName: string | undefined;

    const result = await withAdminActionContext("users", async (user) => {
      seenUser = user;
      seenActorId = getContext()?.actorId;
      seenActorName = getContext()?.actorName;
      return { ok: true };
    });

    expect(seenUser).toEqual(currentUser);
    expect(seenActorId).toBe("admin-1");
    expect(seenActorName).toBe("Admin");
    expect(result).toEqual({ ok: true });
  });

  test("passes null to the handler when unauthenticated, still seeding a correlationId", async () => {
    currentUser = null;
    let seenUser: unknown = "not-called";
    let seenCorrelationId: string | undefined;

    await withAdminActionContext("users", async (user) => {
      seenUser = user;
      seenCorrelationId = getContext()?.correlationId;
      return { ok: true };
    });

    expect(seenUser).toBeNull();
    expect(seenCorrelationId).toBeDefined();
  });

  test("does not catch a thrown error — it propagates to the caller", async () => {
    await expect(
      withAdminActionContext("users", async () => {
        throw new Error("Forbidden");
      }),
    ).rejects.toThrow("Forbidden");
  });
});

describe("withRequestContext", () => {
  test("the wrapped handler runs inside context and sees a minted correlationId", async () => {
    let seenId: string | undefined;
    const wrapped = withRequestContext("routes", async (_req: Request) => {
      seenId = getContext()?.correlationId;
      return new Response("ok");
    });

    const response = await wrapped(new Request("http://localhost/x"));

    expect(seenId).toBeDefined();
    expect(await response.text()).toBe("ok");
  });

  test("returns the handler's Response unchanged", async () => {
    const original = new Response("body", {
      status: 201,
      headers: { "x-test": "1" },
    });
    const wrapped = withRequestContext(
      "routes",
      async (_req: Request) => original,
    );

    const response = await wrapped(new Request("http://localhost/x"));

    expect(response).toBe(original);
  });

  test("honors an inbound x-request-id header instead of minting a new id", async () => {
    let seenId: string | undefined;
    const wrapped = withRequestContext("routes", async (_req: Request) => {
      seenId = getContext()?.correlationId;
      return new Response("ok");
    });

    await wrapped(
      new Request("http://localhost/x", {
        headers: { "x-request-id": "inbound-123" },
      }),
    );

    expect(seenId).toBe("inbound-123");
  });

  test("rejects an unsafe inbound x-request-id (PII injection) and mints a fresh id", async () => {
    let seenId: string | undefined;
    const wrapped = withRequestContext("routes", async (_req: Request) => {
      seenId = getContext()?.correlationId;
      return new Response("ok");
    });

    // An email-shaped id would land in logs unredacted if honored verbatim.
    await wrapped(
      new Request("http://localhost/x", {
        headers: { "x-request-id": "attacker@example.com" },
      }),
    );

    expect(seenId).not.toBe("attacker@example.com");
    expect(seenId).toBeDefined();
  });

  test("forwards additional arguments (e.g. Next.js's { params } route context) to the handler", async () => {
    let seenParams: { id: string } | undefined;
    const wrapped = withRequestContext(
      "routes",
      async (_req: Request, ctx: { params: { id: string } }) => {
        seenParams = ctx.params;
        return new Response("ok");
      },
    );

    await wrapped(new Request("http://localhost/x"), { params: { id: "42" } });

    expect(seenParams).toEqual({ id: "42" });
  });
});
