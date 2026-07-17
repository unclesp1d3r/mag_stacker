import { describe, expect, test } from "bun:test";
import pino from "pino";
import { runWithContext } from "../context";
import type { LogEnv } from "../env";
import { buildLoggerOptions, buildTransportTargets } from "../logger";

/**
 * Pino transports are worker-thread based and hard to assert synchronously.
 * These tests build a logger with `pino(buildLoggerOptions(env), stream)`
 * against an in-memory capture stream, so level/redact/mixin are asserted
 * synchronously in-process without spawning the real file/pretty transports.
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

describe("buildLoggerOptions — level filtering (AE1)", () => {
  test("a debug call writes nothing at level info", () => {
    const stream = new CaptureStream();
    const log = pino(buildLoggerOptions(testEnv({ level: "info" })), stream);

    log.debug("should not appear");

    expect(stream.lines).toHaveLength(0);
  });

  test("an info call writes a line at level info", () => {
    const stream = new CaptureStream();
    const log = pino(buildLoggerOptions(testEnv({ level: "info" })), stream);

    log.info("should appear");

    expect(stream.lines).toHaveLength(1);
    expect(stream.parsed()[0]?.msg).toBe("should appear");
  });
});

describe("buildLoggerOptions — redaction (AE2)", () => {
  test("a structured serialNumber field is redacted", () => {
    const stream = new CaptureStream();
    const log = pino(buildLoggerOptions(testEnv()), stream);

    log.info({ firearm: { serialNumber: "SN123" } }, "firearm logged");

    const record = stream.parsed()[0] as {
      firearm: { serialNumber: string };
    };
    expect(record.firearm.serialNumber).toBe("[REDACTED]");
  });

  test("the same value interpolated into the message string is not redacted", () => {
    const stream = new CaptureStream();
    const log = pino(buildLoggerOptions(testEnv()), stream);

    log.info(`serial SN123`);

    const record = stream.parsed()[0] as { msg: string };
    expect(record.msg).toBe("serial SN123");
  });

  test("redacts email and *.email", () => {
    const stream = new CaptureStream();
    const log = pino(buildLoggerOptions(testEnv()), stream);

    log.info({ email: "a@b.com", user: { email: "c@d.com" } });

    const record = stream.parsed()[0] as {
      email: string;
      user: { email: string };
    };
    expect(record.email).toBe("[REDACTED]");
    expect(record.user.email).toBe("[REDACTED]");
  });

  test("redacts password and token", () => {
    const stream = new CaptureStream();
    const log = pino(buildLoggerOptions(testEnv()), stream);

    log.info({ password: "hunter2", token: "abc123" });

    const record = stream.parsed()[0] as { password: string; token: string };
    expect(record.password).toBe("[REDACTED]");
    expect(record.token).toBe("[REDACTED]");
  });

  test("redacts snake_case session_token", () => {
    const stream = new CaptureStream();
    const log = pino(buildLoggerOptions(testEnv()), stream);

    log.info({ session_token: "secret-session" });

    const record = stream.parsed()[0] as { session_token: string };
    expect(record.session_token).toBe("[REDACTED]");
  });

  test("redacts a one-level-nested accessToken", () => {
    const stream = new CaptureStream();
    const log = pino(buildLoggerOptions(testEnv()), stream);

    log.info({ account: { accessToken: "secret-oauth-token" } });

    const record = stream.parsed()[0] as {
      account: { accessToken: string };
    };
    expect(record.account.accessToken).toBe("[REDACTED]");
  });

  test("redacts a one-level-nested authorization", () => {
    const stream = new CaptureStream();
    const log = pino(buildLoggerOptions(testEnv()), stream);

    log.info({ req2: { authorization: "Bearer x" } });

    const record = stream.parsed()[0] as {
      req2: { authorization: string };
    };
    expect(record.req2.authorization).toBe("[REDACTED]");
  });
});

describe("buildLoggerOptions — mixin (correlation context)", () => {
  test("a line emitted inside runWithContext carries correlationId and entrypoint", () => {
    const stream = new CaptureStream();
    const log = pino(buildLoggerOptions(testEnv()), stream);

    runWithContext({ correlationId: "abc", entrypoint: "m" }, () => {
      log.info("with context");
    });

    const record = stream.parsed()[0] as {
      correlationId: string;
      entrypoint: string;
    };
    expect(record.correlationId).toBe("abc");
    expect(record.entrypoint).toBe("m");
  });

  test("a line emitted outside runWithContext carries no correlationId", () => {
    const stream = new CaptureStream();
    const log = pino(buildLoggerOptions(testEnv()), stream);

    log.info("no context");

    const record = stream.parsed()[0] as { correlationId?: string };
    expect(record.correlationId).toBeUndefined();
  });
});

describe("buildTransportTargets — format selection (AE4)", () => {
  test("format:pretty produces pino-pretty as the first target", () => {
    const targets = buildTransportTargets(testEnv({ format: "pretty" }));

    expect(targets[0]?.target).toBe("pino-pretty");
    expect(targets[0]?.options).toMatchObject({
      colorize: true,
      translateTime: "SYS:standard",
    });
  });

  test("format:json produces pino/file with destination 1 as the first target", () => {
    const targets = buildTransportTargets(testEnv({ format: "json" }));

    expect(targets[0]?.target).toBe("pino/file");
    expect(targets[0]?.options).toMatchObject({ destination: 1 });
  });
});

describe("buildTransportTargets — file opt-in (AE3 mechanism)", () => {
  test("with LOG_FILE unset, only the stdout target is present", () => {
    const targets = buildTransportTargets(testEnv({ file: undefined }));

    expect(targets).toHaveLength(1);
  });

  test("with LOG_FILE set, a pino-roll target is appended with the rotation option", () => {
    const targets = buildTransportTargets(
      testEnv({ file: "/var/log/app.log", rotation: "10M" }),
    );

    expect(targets).toHaveLength(2);
    expect(targets[1]?.target).toBe("pino-roll");
    expect(targets[1]?.options).toMatchObject({
      file: "/var/log/app.log",
      size: "10M",
      mkdir: true,
      limit: { count: 10 },
    });
  });

  test("a daily rotation value maps to the frequency option, not size", () => {
    const targets = buildTransportTargets(
      testEnv({ file: "/var/log/app.log", rotation: "daily" }),
    );

    expect(targets[1]?.options).toMatchObject({ frequency: "daily" });
    expect(
      (targets[1]?.options as Record<string, unknown> | undefined)?.size,
    ).toBeUndefined();
  });

  test("an uppercase frequency is normalized to lowercase for pino-roll", () => {
    const targets = buildTransportTargets(
      testEnv({ file: "/var/log/app.log", rotation: "DAILY" }),
    );

    // pino-roll only accepts the lowercase keyword — forward the normalized one.
    expect(targets[1]?.options).toMatchObject({ frequency: "daily" });
  });
});
