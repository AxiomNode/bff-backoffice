import { afterEach, describe, expect, it, vi } from "vitest";

import { loadConfig } from "../app/config.js";

const REQUIRED_ENV = {
  SERVICE_NAME: "bff-backoffice",
  SERVICE_PORT: "7011",
  ALLOWED_ORIGINS: "http://localhost:3000",
  USERS_SERVICE_URL: "http://microservice-users:7102",
} as const;

describe("loadConfig", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("loads defaults for optional upstream settings", () => {
    for (const [key, value] of Object.entries(REQUIRED_ENV)) {
      vi.stubEnv(key, value);
    }

    const config = loadConfig();

    expect(config).toMatchObject({
      SERVICE_NAME: "bff-backoffice",
      SERVICE_PORT: 7011,
      USERS_SERVICE_URL: "http://microservice-users:7102",
      QUIZZ_SERVICE_URL: "http://localhost:7100",
      WORDPASS_SERVICE_URL: "http://localhost:7101",
      BFF_MOBILE_URL: "http://localhost:7010",
      API_GATEWAY_URL: "http://localhost:7005",
      AI_ENGINE_STATS_URL: "http://localhost:7000",
      AI_ENGINE_API_URL: "http://localhost:7001",
      KUBERNETES_REQUEST_TIMEOUT_MS: 5000,
      KUBERNETES_OBSERVABILITY_ENABLED: true,
      UPSTREAM_TIMEOUT_MS: 15000,
      UPSTREAM_OPERATIONAL_SUMMARY_TIMEOUT_MS: 3000,
      UPSTREAM_METRICS_CACHE_TTL_MS: 5000,
      UPSTREAM_CATALOGS_CACHE_TTL_MS: 60000,
      UPSTREAM_CIRCUIT_FAILURE_THRESHOLD: 3,
      UPSTREAM_CIRCUIT_RESET_TIMEOUT_MS: 30000,
      METRICS_LOG_BUFFER_SIZE: 1000,
    });
  });

  it("rejects invalid configuration", () => {
    for (const [key, value] of Object.entries(REQUIRED_ENV)) {
      vi.stubEnv(key, value);
    }
    vi.stubEnv("SERVICE_PORT", "0");
    vi.stubEnv("USERS_SERVICE_URL", "not-a-url");

    expect(() => loadConfig()).toThrow();
  });

  it("parses optional kubernetes flags and release metadata overrides", () => {
    for (const [key, value] of Object.entries(REQUIRED_ENV)) {
      vi.stubEnv(key, value);
    }
    vi.stubEnv("KUBERNETES_OBSERVABILITY_ENABLED", "false");
    vi.stubEnv("KUBERNETES_REQUEST_TIMEOUT_MS", "8000");
    vi.stubEnv("RELEASE_ENV", "stg");
    vi.stubEnv("RELEASE_VERSION", "abc1234");
    vi.stubEnv("RELEASE_DEPLOYED_AT", "2026-04-26 20:10 UTC");

    const config = loadConfig();

    expect(config.KUBERNETES_OBSERVABILITY_ENABLED).toBe(false);
    expect(config.KUBERNETES_REQUEST_TIMEOUT_MS).toBe(8000);
    expect(config.RELEASE_ENV).toBe("stg");
    expect(config.RELEASE_VERSION).toBe("abc1234");
    expect(config.RELEASE_DEPLOYED_AT).toBe("2026-04-26 20:10 UTC");
  });
});