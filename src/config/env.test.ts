import { beforeEach, describe, expect, it } from "vitest";
import { loadEnv, resetEnvCacheForTests } from "./env.js";

const REQUIRED: NodeJS.ProcessEnv = {
  DATABASE_URL: "postgresql://drivesync:drivesync@localhost:5432/drivesync",
  REDIS_URL: "redis://localhost:6379",
  API_KEY_PEPPER: "test-pepper",
  GOOGLE_SERVICE_ACCOUNT_EMAIL: "test@example.com",
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: "test-key",
  OPENAI_API_KEY: "test-key",
  PINECONE_API_KEY: "test-key",
};

beforeEach(() => {
  resetEnvCacheForTests();
});

describe("loadEnv", () => {
  it("applies defaults when optional vars are omitted", () => {
    const env = loadEnv(REQUIRED);
    expect(env.NODE_ENV).toBe("development");
    expect(env.PORT).toBe(3000);
    expect(env.EMBEDDING_PROVIDER).toBe("openai");
    expect(env.VECTOR_STORE).toBe("pinecone");
    expect(env.SYNC_CRON).toBe("*/15 * * * *");
    expect(env.MCP_SERVER_PORT).toBe(3001);
    expect(env.OPENAI_EMBEDDING_DIMENSIONS).toBeUndefined();
    expect(env.MAX_EXTRACT_BYTES).toBe(25 * 1024 * 1024);
    expect(env.EXTRACT_TIMEOUT_MS).toBe(30_000);
    expect(env.GOOGLE_DOCS_EXPORT_FORMAT).toBe("text");
  });

  it("parses the v2.1 extraction vars when set", () => {
    const env = loadEnv({
      ...REQUIRED,
      MAX_EXTRACT_BYTES: "1048576",
      EXTRACT_TIMEOUT_MS: "5000",
      GOOGLE_DOCS_EXPORT_FORMAT: "markdown",
    });
    expect(env.MAX_EXTRACT_BYTES).toBe(1048576);
    expect(env.EXTRACT_TIMEOUT_MS).toBe(5000);
    expect(env.GOOGLE_DOCS_EXPORT_FORMAT).toBe("markdown");
  });

  it.each([
    ["MAX_EXTRACT_BYTES", "-1"],
    ["MAX_EXTRACT_BYTES", "lots"],
    ["EXTRACT_TIMEOUT_MS", "0"],
    ["EXTRACT_TIMEOUT_MS", "soon"],
    ["GOOGLE_DOCS_EXPORT_FORMAT", "html"],
  ])("fails fast on an invalid %s (%s)", (key, value) => {
    expect(() => loadEnv({ ...REQUIRED, [key]: value })).toThrow(new RegExp(key));
  });

  it("parses OPENAI_EMBEDDING_DIMENSIONS when set", () => {
    const env = loadEnv({ ...REQUIRED, OPENAI_EMBEDDING_DIMENSIONS: "512" });
    expect(env.OPENAI_EMBEDDING_DIMENSIONS).toBe(512);
  });

  it("coerces numeric string vars to numbers", () => {
    const env = loadEnv({ ...REQUIRED, PORT: "4000", DRIVE_RATE_LIMIT_PER_ACCOUNT: "10" });
    expect(env.PORT).toBe(4000);
    expect(env.DRIVE_RATE_LIMIT_PER_ACCOUNT).toBe(10);
  });

  it.each(Object.keys(REQUIRED))("throws when %s is missing", (key) => {
    const source = { ...REQUIRED };
    delete source[key];
    expect(() => loadEnv(source)).toThrow(/Invalid environment configuration/);
  });

  it("rejects an unrecognized NODE_ENV", () => {
    expect(() => loadEnv({ ...REQUIRED, NODE_ENV: "staging" })).toThrow();
  });

  it("caches the result across calls", () => {
    const first = loadEnv(REQUIRED);
    const second = loadEnv({ ...REQUIRED, PORT: "9999" });
    expect(second).toBe(first);
    expect(second.PORT).toBe(3000);
  });
});
