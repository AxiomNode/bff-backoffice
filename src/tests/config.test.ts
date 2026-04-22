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
});