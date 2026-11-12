import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import Fastify from "fastify";

import { isDevelopmentLikeEnv } from "../app/config.js";
import { backofficeRoutes } from "../app/routes/backoffice.js";

vi.mock("../app/services/kubernetesObservability.js", () => ({
  fetchKubernetesOverview: vi.fn(),
}));

let tempDir = "";

function buildConfig(extra: Record<string, unknown> = {}) {
  return {
    SERVICE_NAME: "bff-backoffice",
    SERVICE_PORT: 7011,
    ALLOWED_ORIGINS: "http://localhost:3000",
    USERS_SERVICE_URL: "http://microservice-users:7102",
    API_GATEWAY_URL: "http://api-gateway:7005",
    AI_ENGINE_API_URL: "http://ai-engine-api:7001",
    BACKOFFICE_ROUTING_STATE_FILE: path.join(tempDir, "routing-state.json"),
    ...extra,
  } as never;
}

describe("isDevelopmentLikeEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is true only for development and test", () => {
    expect(isDevelopmentLikeEnv({ NODE_ENV: "development" })).toBe(true);
    expect(isDevelopmentLikeEnv({ NODE_ENV: "test" })).toBe(true);
    expect(isDevelopmentLikeEnv({ NODE_ENV: "production" })).toBe(false);
    expect(isDevelopmentLikeEnv({ NODE_ENV: "staging" })).toBe(false);
    expect(isDevelopmentLikeEnv({})).toBe(false);
  });

  it("reads process.env by default", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(isDevelopmentLikeEnv()).toBe(false);
  });
});

describe("routing target allowlist (fail closed)", () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "axiomnode-bff-allowlist-"));
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("denies service-target overrides when the allowlist is empty in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const app = Fastify();
    await backofficeRoutes(app, buildConfig());

    const response = await app.inject({
      method: "PUT",
      url: "/v1/backoffice/service-targets/microservice-users",
      payload: { baseUrl: "http://203.0.113.10:7102" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().message).toContain("ALLOWED_ROUTING_TARGET_HOSTS is empty");
    await app.close();
  });

  it("denies overrides when NODE_ENV is unset and the allowlist is blank", async () => {
    vi.stubEnv("NODE_ENV", "");
    const app = Fastify();
    await backofficeRoutes(app, buildConfig({ ALLOWED_ROUTING_TARGET_HOSTS: "   " }));

    const response = await app.inject({
      method: "PUT",
      url: "/v1/backoffice/service-targets/microservice-users",
      payload: { baseUrl: "http://microservice-users:7102" },
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it("keeps allowing overrides with an empty allowlist in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const app = Fastify();
    await backofficeRoutes(app, buildConfig());

    const response = await app.inject({
      method: "PUT",
      url: "/v1/backoffice/service-targets/microservice-users",
      payload: { baseUrl: "http://example.com:7102" },
    });

    expect(response.statusCode).toBe(200);
    await app.close();
  });

  it("rejects non-http(s) schemes even for allowed hosts", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const app = Fastify();
    await backofficeRoutes(app, buildConfig({ ALLOWED_ROUTING_TARGET_HOSTS: "localhost" }));

    for (const baseUrl of ["ftp://localhost:21", "file://localhost/etc/passwd"]) {
      const response = await app.inject({
        method: "PUT",
        url: "/v1/backoffice/service-targets/microservice-users",
        payload: { baseUrl },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().message).toBe("baseUrl must use http or https");
    }
    await app.close();
  });

  it("applies the allowlist to ai-engine presets and connections", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const app = Fastify();
    await backofficeRoutes(app, buildConfig({ ALLOWED_ROUTING_TARGET_HOSTS: "10.0.0.0/8" }));

    const denied = await app.inject({
      method: "POST",
      url: "/v1/backoffice/ai-engine/presets",
      payload: { name: "Public", host: "203.0.113.10", port: 7002 },
    });
    expect(denied.statusCode).toBe(400);
    expect(denied.json().message).toBe("host '203.0.113.10' is not allowed by ALLOWED_ROUTING_TARGET_HOSTS");

    const deniedConnection = await app.inject({
      method: "POST",
      url: "/v1/backoffice/ai-engine/connections",
      payload: { name: "Public", host: "203.0.113.10", port: 7002 },
    });
    expect(deniedConnection.statusCode).toBe(400);

    const allowed = await app.inject({
      method: "POST",
      url: "/v1/backoffice/ai-engine/presets",
      payload: { name: "Private", host: "10.1.2.3", port: 7002 },
    });
    expect(allowed.statusCode).toBe(201);
    await app.close();
  });

  it("denies ai-engine target changes with an empty allowlist in production without calling upstream", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const app = Fastify();
    await backofficeRoutes(app, buildConfig());

    const response = await app.inject({
      method: "PUT",
      url: "/v1/backoffice/ai-engine/target",
      payload: { host: "203.0.113.10", port: 7002 },
    });

    expect(response.statusCode).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("still loads the seeded ai-engine presets when the allowlist is empty in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const app = Fastify();
    await backofficeRoutes(app, buildConfig());

    const response = await app.inject({ method: "GET", url: "/v1/backoffice/ai-engine/presets" });

    expect(response.statusCode).toBe(200);
    expect(response.json().presets).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "workstation-public", host: "203.0.113.10" })]),
    );
    await app.close();
  });
});
