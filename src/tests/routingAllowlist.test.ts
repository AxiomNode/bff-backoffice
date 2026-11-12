import { afterEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";

import { isDevelopmentLikeEnv } from "../app/config.js";
import { backofficeRoutes } from "../app/routes/backoffice.js";

function buildConfig(extra: Record<string, unknown> = {}) {
  return {
    SERVICE_NAME: "bff-backoffice",
    SERVICE_PORT: 7011,
    ALLOWED_ORIGINS: "http://localhost:3000",
    USERS_SERVICE_URL: "http://microservice-users:7102",
    API_GATEWAY_URL: "http://api-gateway:7005",
    AI_ENGINE_API_URL: "http://ai-engine-api:7001",
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

function targetResponse(host: string, port: number) {
  return new Response(
    JSON.stringify({
      source: "override",
      label: null,
      host,
      protocol: "http",
      port,
      llamaBaseUrl: `http://${host}:${port}/v1/completions`,
      envLlamaBaseUrl: "http://llama-workstation.invalid:7002/v1/completions",
      updatedAt: "2026-04-19T00:00:00.000Z",
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("ai-engine target allowlist (fail closed)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("denies target changes with an empty allowlist in production without calling upstream", async () => {
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
    expect(response.json().message).toContain("ALLOWED_ROUTING_TARGET_HOSTS is empty");
    expect(fetchMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("denies target changes when NODE_ENV is unset and the allowlist is blank", async () => {
    vi.stubEnv("NODE_ENV", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const app = Fastify();
    await backofficeRoutes(app, buildConfig({ ALLOWED_ROUTING_TARGET_HOSTS: "   " }));

    const response = await app.inject({
      method: "PUT",
      url: "/v1/backoffice/ai-engine/target",
      payload: { host: "10.1.2.3", port: 7002 },
    });

    expect(response.statusCode).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("keeps allowing target changes with an empty allowlist in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(targetResponse("example.com", 7002)));
    vi.stubGlobal("fetch", fetchMock);
    const app = Fastify();
    await backofficeRoutes(app, buildConfig());

    const response = await app.inject({
      method: "PUT",
      url: "/v1/backoffice/ai-engine/target",
      payload: { host: "example.com", port: 7002 },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ source: "override", host: "example.com" });
    await app.close();
  });

  it("applies the allowlist hosts and CIDRs to the ai-engine target", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(targetResponse("10.1.2.3", 7002)));
    vi.stubGlobal("fetch", fetchMock);
    const app = Fastify();
    await backofficeRoutes(app, buildConfig({ ALLOWED_ROUTING_TARGET_HOSTS: "10.0.0.0/8" }));

    const denied = await app.inject({
      method: "PUT",
      url: "/v1/backoffice/ai-engine/target",
      payload: { host: "203.0.113.10", port: 7002 },
    });
    expect(denied.statusCode).toBe(400);
    expect(denied.json().message).toBe("host '203.0.113.10' is not allowed by ALLOWED_ROUTING_TARGET_HOSTS");
    expect(fetchMock).not.toHaveBeenCalled();

    const allowed = await app.inject({
      method: "PUT",
      url: "/v1/backoffice/ai-engine/target",
      payload: { host: "10.1.2.3", port: 7002 },
    });
    expect(allowed.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://ai-engine-api:7001/internal/admin/llama-target",
      expect.objectContaining({ method: "PUT" }),
    );
    await app.close();
  });

  it("does not apply the allowlist to resetting the target", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(targetResponse("llama-workstation.invalid", 7002)));
    vi.stubGlobal("fetch", fetchMock);
    const app = Fastify();
    await backofficeRoutes(app, buildConfig());

    const response = await app.inject({ method: "DELETE", url: "/v1/backoffice/ai-engine/target" });

    expect(response.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://ai-engine-api:7001/internal/admin/llama-target",
      expect.objectContaining({ method: "DELETE" }),
    );
    await app.close();
  });
});
