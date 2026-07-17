import { describe, expect, test } from "bun:test";
import pino from "pino";
import { magazineDisplayName } from "@/src/domain/magazines/display";
import { ACTION_LABEL_MAX, logAction } from "../action-log";
import { runWithContext } from "../context";
import type { LogEnv } from "../env";
import { buildLoggerOptions } from "../logger";

/**
 * `logAction` defaults to the real (lazy, worker-thread-backed) module
 * logger, so tests inject a logger built against an in-memory capture
 * stream instead — same pattern as `logger.test.ts` — via `logAction`'s
 * optional second parameter.
 */
class CaptureStream implements pino.DestinationStream {
  lines: string[] = [];
  write(msg: string): void {
    this.lines.push(msg);
  }
  parsed(): Record<string, unknown>[] {
    return this.lines.map((line) => JSON.parse(line));
  }
}

function testEnv(overrides: Partial<LogEnv> = {}): LogEnv {
  return {
    level: "info",
    file: undefined,
    rotation: "10M",
    format: "json",
    ...overrides,
  };
}

function captureLogger(): { stream: CaptureStream; log: pino.Logger } {
  const stream = new CaptureStream();
  const log = pino(buildLoggerOptions(testEnv()), stream);
  return { stream, log };
}

interface ActionRecord {
  msg: string;
  correlationId?: string;
  action: {
    verb: string;
    actor?: string;
    actorId?: string;
    objectType: string;
    objectLabel: string;
  };
}

describe("logAction — create/delete lines (AE6)", () => {
  test("firearm create emits a human-readable line naming the actor + object", () => {
    const { stream, log } = captureLogger();

    runWithContext(
      {
        correlationId: "cid1",
        entrypoint: "firearms",
        actorId: "u1",
        actorName: "alice",
      },
      () => {
        logAction(
          { verb: "created", objectType: "firearm", objectLabel: "Glock 19" },
          log,
        );
      },
    );

    const record = stream.parsed()[0] as unknown as ActionRecord;
    expect(record.msg).toBe('alice created firearm "Glock 19"');
    expect(record.correlationId).toBe("cid1");
    expect(record.action).toMatchObject({
      verb: "created",
      actor: "alice",
      actorId: "u1",
      objectType: "firearm",
      objectLabel: "Glock 19",
    });
  });

  test("includes the resolved ownerId as a per-line field when provided", () => {
    const { stream, log } = captureLogger();

    runWithContext(
      { correlationId: "cid1", entrypoint: "firearms", actorId: "u1" },
      () => {
        logAction(
          {
            verb: "created",
            objectType: "firearm",
            objectLabel: "Glock 19",
            // create-on-behalf: the owner differs from the acting user (KTD-4).
            ownerId: "owner-2",
          },
          log,
        );
      },
    );

    const record = stream.parsed()[0] as unknown as ActionRecord;
    expect((record.action as { ownerId?: string }).ownerId).toBe("owner-2");
  });

  test("magazine delete emits an equivalent line", () => {
    const { stream, log } = captureLogger();

    runWithContext(
      {
        correlationId: "cid2",
        entrypoint: "magazines",
        actorId: "u2",
        actorName: "bob",
      },
      () => {
        logAction(
          { verb: "deleted", objectType: "magazine", objectLabel: "PMAG" },
          log,
        );
      },
    );

    const record = stream.parsed()[0] as unknown as ActionRecord;
    expect(record.msg).toBe('bob deleted magazine "PMAG"');
    expect(record.correlationId).toBe("cid2");
    expect(record.action).toMatchObject({
      verb: "deleted",
      actor: "bob",
      actorId: "u2",
      objectType: "magazine",
      objectLabel: "PMAG",
    });
  });

  test("a label longer than the max is truncated in the message and fields", () => {
    const { stream, log } = captureLogger();
    const longLabel = "x".repeat(ACTION_LABEL_MAX + 20);
    const truncated = "x".repeat(ACTION_LABEL_MAX);

    runWithContext(
      { correlationId: "cid3", actorId: "u1", actorName: "alice" },
      () => {
        logAction(
          { verb: "created", objectType: "firearm", objectLabel: longLabel },
          log,
        );
      },
    );

    const record = stream.parsed()[0] as unknown as ActionRecord;
    expect(record.msg).toBe(`alice created firearm "${truncated}"`);
    expect(record.action.objectLabel).toBe(truncated);
    expect(record.action.objectLabel.length).toBe(ACTION_LABEL_MAX);
  });

  test("no actor name in context falls back to actorId", () => {
    const { stream, log } = captureLogger();

    runWithContext({ correlationId: "cid4", actorId: "u9" }, () => {
      logAction(
        { verb: "created", objectType: "firearm", objectLabel: "Rifle" },
        log,
      );
    });

    const record = stream.parsed()[0] as unknown as ActionRecord;
    expect(record.msg).toBe('u9 created firearm "Rifle"');
  });

  test('no actor id or name in context falls back to "unknown", still emits', () => {
    const { stream, log } = captureLogger();

    runWithContext({ correlationId: "cid5" }, () => {
      logAction(
        { verb: "deleted", objectType: "magazine", objectLabel: "Unnamed" },
        log,
      );
    });

    expect(stream.lines).toHaveLength(1);
    const record = stream.parsed()[0] as unknown as ActionRecord;
    expect(record.msg).toBe('unknown deleted magazine "Unnamed"');
  });

  test('no ambient context at all still emits, with actor "unknown"', () => {
    const { stream, log } = captureLogger();

    logAction(
      { verb: "created", objectType: "firearm", objectLabel: "No Context" },
      log,
    );

    expect(stream.lines).toHaveLength(1);
    const record = stream.parsed()[0] as unknown as ActionRecord;
    expect(record.msg).toBe('unknown created firearm "No Context"');
    expect(record.correlationId).toBeUndefined();
  });
});

describe("magazineDisplayName", () => {
  test("returns the trimmed label when present", () => {
    expect(
      magazineDisplayName({ label: "  My PMAG  ", brandModel: "PMAG" }),
    ).toBe("My PMAG");
  });

  test("falls back to brandModel when label is empty", () => {
    expect(magazineDisplayName({ label: "", brandModel: "PMAG" })).toBe("PMAG");
  });

  test("falls back to brandModel when label is whitespace-only", () => {
    expect(magazineDisplayName({ label: "   ", brandModel: "PMAG" })).toBe(
      "PMAG",
    );
  });
});
