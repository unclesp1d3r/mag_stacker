import pino from "pino";
import { getContext } from "./context";
import type { LogEnv } from "./env";
import { resolveLogEnv } from "./env";
import { REDACT_CENSOR, REDACT_PATHS } from "./redact";

/**
 * Server-only guard (R3): `server-only` isn't a repo dependency, so fall back
 * to a runtime throw if this module is ever pulled into a client bundle.
 * (Import statements are hoisted regardless of source position, so this runs
 * before any of the logic below, matching what `import "server-only"` gives.)
 */
if (typeof window !== "undefined") {
  throw new Error(
    "src/lib/logging/logger.ts is server-only and must not be imported into client code.",
  );
}

const FREQUENCY_ROTATION_VALUES = new Set(["daily", "hourly"]);

/**
 * Split `env.rotation` into pino-roll's `size` or `frequency` option. The
 * literal values `daily`/`hourly` are time-based frequency; everything else
 * (e.g. `10M`, `500k`) is treated as a size threshold (KTD per A2).
 */
function rotationOption(
  rotation: string,
): { size: string } | { frequency: string } {
  return FREQUENCY_ROTATION_VALUES.has(rotation.toLowerCase())
    ? { frequency: rotation }
    : { size: rotation };
}

/**
 * Safe base fields merged onto every log line from the ambient ALS context
 * (R10). Only known-safe keys are forwarded — never arbitrary context data.
 */
function mixin(): Record<string, string> {
  const ctx = getContext();
  if (!ctx) return {};

  const fields: Record<string, string> = { correlationId: ctx.correlationId };
  if (ctx.entrypoint !== undefined) fields.entrypoint = ctx.entrypoint;
  if (ctx.actorId !== undefined) fields.actorId = ctx.actorId;
  if (ctx.actorName !== undefined) fields.actorName = ctx.actorName;
  if (ctx.ownerId !== undefined) fields.ownerId = ctx.ownerId;
  return fields;
}

/** Build the Pino logger options: level, redaction, and context mixin (R6, R8, R9, R10). */
export function buildLoggerOptions(env: LogEnv): pino.LoggerOptions {
  return {
    level: env.level,
    redact: { paths: REDACT_PATHS, censor: REDACT_CENSOR },
    mixin,
  };
}

/**
 * Build the transport targets array (R2, R4, R5, R7). stdout is always the
 * first target — `pino-pretty` in pretty mode, `pino/file` (raw JSON to fd 1)
 * otherwise. `pino-roll` is appended only when `env.file` is set.
 */
export function buildTransportTargets(
  env: LogEnv,
): pino.TransportTargetOptions[] {
  const stdoutTarget: pino.TransportTargetOptions =
    env.format === "pretty"
      ? {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "SYS:standard" },
        }
      : { target: "pino/file", options: { destination: 1 } };

  const targets: pino.TransportTargetOptions[] = [stdoutTarget];

  if (env.file) {
    targets.push({
      target: "pino-roll",
      options: {
        file: env.file,
        ...rotationOption(env.rotation),
        mkdir: true,
        limit: { count: 10 },
      },
    });
  }

  return targets;
}

function buildLogger(): pino.Logger {
  const env = resolveLogEnv();
  return pino(
    buildLoggerOptions(env),
    pino.transport({ targets: buildTransportTargets(env) }),
  );
}

/** Lazy proxy: forwards to the real logger built on first property access. */
function lazy<T extends object>(resolve: () => T): T {
  return new Proxy({} as T, {
    get(_target, prop) {
      const real = resolve() as object;
      const value = Reflect.get(real, prop, real);
      return typeof value === "function" ? value.bind(real) : value;
    },
  });
}

let activeLogger: pino.Logger | undefined;

/**
 * The single application-wide Pino logger (R1). Fans out to stdout (always)
 * and, when `LOG_FILE` is set, a rotating file — both driven from one call.
 *
 * Construction (and the worker-thread transports it spawns) is deferred to
 * first use, mirroring `src/db/client.ts`'s lazy-singleton pattern — so
 * importing this module (directly or via `./index`) never has the side
 * effect of spawning a real transport, which matters for `next build` and
 * for unit tests that only need `buildLoggerOptions`/`buildTransportTargets`.
 */
export const logger: pino.Logger = lazy(() => {
  if (!activeLogger) activeLogger = buildLogger();
  return activeLogger;
});

/** Per-module child logger — attaches `module` to every line without re-passing it. */
export function childLogger(module: string): pino.Logger {
  return logger.child({ module });
}
