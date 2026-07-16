/**
 * Boundary validation for `LOG_*` environment configuration (R1, R2, R5, R6, R7).
 *
 * Pure by default (`process.env`); `resolveLogEnv` also accepts an injected
 * env record so tests can pin behavior without mutating global state.
 */

const LOG_LEVELS = [
  "fatal",
  "error",
  "warn",
  "info",
  "debug",
  "trace",
] as const;

/** Pino's minimum-emitted-level values, in ascending verbosity. */
export type LogLevel = (typeof LOG_LEVELS)[number];

const LOG_FORMATS = ["json", "pretty"] as const;

/** Output shape for the stdout target: raw JSON or human-readable pretty. */
export type LogFormat = (typeof LOG_FORMATS)[number];

/** Default rotation threshold passed to `pino-roll` when `LOG_FILE` is set (A2). */
export const LOG_FILE_ROTATION_DEFAULT = "10M";

/** Resolved, typed logging configuration derived from `LOG_*` env vars. */
export interface LogEnv {
  /** Minimum emitted level (R6). */
  level: LogLevel;
  /** Absolute/relative path for the opt-in rotating file; `undefined` = stdout-only (R5). */
  file: string | undefined;
  /** Rotation threshold string passed to `pino-roll`, e.g. `10M` or `daily` (R7). */
  rotation: string;
  /** stdout target format: raw JSON in prod, pretty in dev by default (R2). */
  format: LogFormat;
}

function isLogLevel(value: string | undefined): value is LogLevel {
  return LOG_LEVELS.includes(value as LogLevel);
}

function isLogFormat(value: string | undefined): value is LogFormat {
  return LOG_FORMATS.includes(value as LogFormat);
}

function resolveLevel(env: NodeJS.ProcessEnv, isProduction: boolean): LogLevel {
  const raw = env.LOG_LEVEL;
  if (isLogLevel(raw)) return raw;
  return isProduction ? "info" : "debug";
}

function resolveFormat(
  env: NodeJS.ProcessEnv,
  isProduction: boolean,
): LogFormat {
  const raw = env.LOG_FORMAT;
  if (isLogFormat(raw)) return raw;
  return isProduction ? "json" : "pretty";
}

function resolveFile(env: NodeJS.ProcessEnv): string | undefined {
  const raw = env.LOG_FILE;
  return raw && raw.trim() !== "" ? raw : undefined;
}

function resolveRotation(env: NodeJS.ProcessEnv): string {
  const raw = env.LOG_FILE_ROTATION;
  return raw && raw.trim() !== "" ? raw : LOG_FILE_ROTATION_DEFAULT;
}

/**
 * Parse and validate `LOG_LEVEL`, `LOG_FILE`, `LOG_FILE_ROTATION`, and
 * `LOG_FORMAT` from the given env record (defaults to `process.env`).
 *
 * Invalid or unset `LOG_LEVEL`/`LOG_FORMAT` fall back to `NODE_ENV`-derived
 * defaults rather than throwing — logging configuration must never block boot.
 */
export function resolveLogEnv(env: NodeJS.ProcessEnv = process.env): LogEnv {
  const isProduction = env.NODE_ENV === "production";
  return {
    level: resolveLevel(env, isProduction),
    file: resolveFile(env),
    rotation: resolveRotation(env),
    format: resolveFormat(env, isProduction),
  };
}
