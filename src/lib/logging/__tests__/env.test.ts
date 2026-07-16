import { describe, expect, test } from "bun:test";
import { LOG_FILE_ROTATION_DEFAULT, resolveLogEnv } from "../env";

function envRecord(
  overrides: Partial<NodeJS.ProcessEnv> = {},
): NodeJS.ProcessEnv {
  return { ...overrides } as NodeJS.ProcessEnv;
}

describe("resolveLogEnv — defaults", () => {
  test("defaults level to info and format to json in production", () => {
    const env = resolveLogEnv(envRecord({ NODE_ENV: "production" }));
    expect(env.level).toBe("info");
    expect(env.format).toBe("json");
  });

  test("defaults level to debug and format to pretty outside production", () => {
    const env = resolveLogEnv(envRecord({ NODE_ENV: "development" }));
    expect(env.level).toBe("debug");
    expect(env.format).toBe("pretty");
  });

  test("defaults rotation to LOG_FILE_ROTATION_DEFAULT", () => {
    const env = resolveLogEnv(envRecord({}));
    expect(env.rotation).toBe(LOG_FILE_ROTATION_DEFAULT);
    expect(env.rotation).toBe("10M");
  });

  test("defaults file to undefined when LOG_FILE is unset", () => {
    const env = resolveLogEnv(envRecord({}));
    expect(env.file).toBeUndefined();
  });
});

describe("resolveLogEnv — overrides", () => {
  test("an explicit LOG_LEVEL wins over the NODE_ENV default", () => {
    const env = resolveLogEnv(
      envRecord({ NODE_ENV: "production", LOG_LEVEL: "trace" }),
    );
    expect(env.level).toBe("trace");
  });

  test("an invalid LOG_LEVEL falls back to the NODE_ENV default", () => {
    const env = resolveLogEnv(
      envRecord({ NODE_ENV: "production", LOG_LEVEL: "verbose" }),
    );
    expect(env.level).toBe("info");
  });

  test("an explicit LOG_FORMAT overrides the NODE_ENV default", () => {
    const env = resolveLogEnv(
      envRecord({ NODE_ENV: "production", LOG_FORMAT: "pretty" }),
    );
    expect(env.format).toBe("pretty");
  });

  test("an invalid LOG_FORMAT falls back to the NODE_ENV default", () => {
    const env = resolveLogEnv(
      envRecord({ NODE_ENV: "development", LOG_FORMAT: "xml" }),
    );
    expect(env.format).toBe("pretty");
  });

  test("LOG_FILE is used when set and non-empty", () => {
    const env = resolveLogEnv(envRecord({ LOG_FILE: "/var/log/app.log" }));
    expect(env.file).toBe("/var/log/app.log");
  });

  test("LOG_FILE_ROTATION overrides the default", () => {
    const env = resolveLogEnv(envRecord({ LOG_FILE_ROTATION: "daily" }));
    expect(env.rotation).toBe("daily");
  });
});
