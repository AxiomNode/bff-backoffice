import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import Fastify from "fastify";
import { backofficeRoutes } from "../app/routes/backoffice.js";

let tempStateDir = "";
let defaultStateFile = "";

function withStateFile<T extends Record<string, unknown>>(config: T): T & { BACKOFFICE_ROUTING_STATE_FILE: string } {
  return {
    ...config,
    BACKOFFICE_ROUTING_STATE_FILE: defaultStateFile,
  };
}

describe("backoffice routes", () => {
  beforeEach(async () => {
    tempStateDir = await mkdtemp(path.join(os.tmpdir(), "axiomnode-bff-test-"));
    defaultStateFile = path.join(tempStateDir, "routing-state.json");
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    if (tempStateDir) {
      await rm(tempStateDir, { recursive: true, force: true });
    }
    tempStateDir = "";
    defaultStateFile = "";
  });

  it("forwards leaderboard to microservice-users", async () => {
    const app = Fastify();

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ source: "users" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    vi.stubGlobal("fetch", fetchMock);

    await backofficeRoutes(app, withStateFile({
      SERVICE_NAME: "bff-backoffice",
      SERVICE_PORT: 7011,
      ALLOWED_ORIGINS: "http://localhost:3000",
      USERS_SERVICE_URL: "http://microservice-users:7102",
    }));

    const response = await app.inject({
      method: "GET",
      url: "/v1/backoffice/users/leaderboard?limit=10",
      headers: {
        "x-correlation-id": "corr-3",
        authorization: "Bearer staff-token",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ source: "users" });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://microservice-users:7102/users/leaderboard?limit=10",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          authorization: "Bearer staff-token",
          "x-correlation-id": "corr-3",
        }),
      }),
    );

    await app.close();
  });

  it("rejects invalid leaderboard query params before proxying", async () => {
    const app = Fastify();

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await backofficeRoutes(app, withStateFile({
      SERVICE_NAME: "bff-backoffice",
      SERVICE_PORT: 7011,
      ALLOWED_ORIGINS: "http://localhost:3000",
      USERS_SERVICE_URL: "http://microservice-users:7102",
    }));

    const response = await app.inject({
      method: "GET",
      url: "/v1/backoffice/users/leaderboard?limit=9999",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ message: "Invalid query parameters" });
    expect(fetchMock).not.toHaveBeenCalled();

    await app.close();
  });

  it("forwards manual history insertion for quiz service", async () => {
    const app = Fastify();

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ item: { id: "entry-1" } }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );

    vi.stubGlobal("fetch", fetchMock);

    await backofficeRoutes(app, withStateFile({
      SERVICE_NAME: "bff-backoffice",
      SERVICE_PORT: 7011,
      ALLOWED_ORIGINS: "http://localhost:3000",
      USERS_SERVICE_URL: "http://microservice-users:7102",
      QUIZZ_SERVICE_URL: "http://microservice-quizz:7100",
      WORDPASS_SERVICE_URL: "http://microservice-wordpass:7101",
    }));

    const response = await app.inject({
      method: "POST",
      url: "/v1/backoffice/services/microservice-quiz/data",
      headers: {
        authorization: "Bearer staff-token",
      },
      payload: {
        dataset: "history",
        categoryId: "9",
        language: "es",
        difficultyPercentage: 60,
        content: { question: "Q" },
      },
    });

    expect(response.statusCode).toBe(201);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://microservice-quizz:7100/games/history/manual",
      expect.objectContaining({
        method: "POST",
      }),
    );

    await app.close();
  });

  it("forwards manual history deletion for wordpass service", async () => {
    const app = Fastify();

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ deleted: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    vi.stubGlobal("fetch", fetchMock);

    await backofficeRoutes(app, withStateFile({
      SERVICE_NAME: "bff-backoffice",
      SERVICE_PORT: 7011,
      ALLOWED_ORIGINS: "http://localhost:3000",
      USERS_SERVICE_URL: "http://microservice-users:7102",
      QUIZZ_SERVICE_URL: "http://microservice-quizz:7100",
      WORDPASS_SERVICE_URL: "http://microservice-wordpass:7101",
    }));

    const response = await app.inject({
      method: "DELETE",
      url: "/v1/backoffice/services/microservice-wordpass/data/entry-7?dataset=history",
      headers: {
        authorization: "Bearer staff-token",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://microservice-wordpass:7101/games/history/entry-7",
      expect.objectContaining({
        method: "DELETE",
      }),
    );

    await app.close();
  });

  it("forwards game catalogs from microservice-quiz", async () => {
    const app = Fastify();

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ categories: [], languages: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    vi.stubGlobal("fetch", fetchMock);

    await backofficeRoutes(app, withStateFile({
      SERVICE_NAME: "bff-backoffice",
      SERVICE_PORT: 7011,
      ALLOWED_ORIGINS: "http://localhost:3000",
      USERS_SERVICE_URL: "http://microservice-users:7102",
      QUIZZ_SERVICE_URL: "http://microservice-quizz:7100",
    }));

    const response = await app.inject({
      method: "GET",
      url: "/v1/backoffice/services/microservice-quiz/catalogs",
      headers: {
        authorization: "Bearer staff-token",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://microservice-quizz:7100/catalogs",
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer staff-token",
        }),
      }),
    );

    await app.close();
  });

  it("includes X-API-Key when requesting ai-engine-stats metrics", async () => {
    const app = Fastify();

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    vi.stubGlobal("fetch", fetchMock);

    await backofficeRoutes(app, withStateFile({
      SERVICE_NAME: "bff-backoffice",
      SERVICE_PORT: 7011,
      ALLOWED_ORIGINS: "http://localhost:3000",
      USERS_SERVICE_URL: "http://microservice-users:7102",
      AI_ENGINE_STATS_URL: "http://ai-engine-stats:7000",
      AI_ENGINE_BRIDGE_API_KEY: "bridge-key-123",
    }));

    const response = await app.inject({
      method: "GET",
      url: "/v1/backoffice/services/ai-engine-stats/metrics",
    });

    expect(response.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://ai-engine-stats:7000/stats",
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-api-key": "bridge-key-123",
        }),
      }),
    );

    await app.close();
  });

  it("forwards critical headers when requesting ai-engine-stats metrics", async () => {
    const app = Fastify();

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    vi.stubGlobal("fetch", fetchMock);

    await backofficeRoutes(app, withStateFile({
      SERVICE_NAME: "bff-backoffice",
      SERVICE_PORT: 7011,
      ALLOWED_ORIGINS: "http://localhost:3000",
      USERS_SERVICE_URL: "http://microservice-users:7102",
      AI_ENGINE_STATS_URL: "http://ai-engine-stats:7000",
      AI_ENGINE_BRIDGE_API_KEY: "bridge-key-123",
    }));

    const response = await app.inject({
      method: "GET",
      url: "/v1/backoffice/services/ai-engine-stats/metrics",
      headers: {
        "x-correlation-id": "corr-bo-1",
        "x-firebase-id-token": "firebase-staff-token",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://ai-engine-stats:7000/stats",
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer firebase-staff-token",
          "x-firebase-id-token": "firebase-staff-token",
          "x-correlation-id": "corr-bo-1",
          "x-api-key": "bridge-key-123",
        }),
      }),
    );

    await app.close();
  });

  it("lists configurable service targets and applies runtime overrides", async () => {
    const app = Fastify();

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ categories: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    vi.stubGlobal("fetch", fetchMock);

    await backofficeRoutes(app, withStateFile({
      SERVICE_NAME: "bff-backoffice",
      SERVICE_PORT: 7011,
      ALLOWED_ORIGINS: "http://localhost:3000",
      USERS_SERVICE_URL: "http://microservice-users:7102",
      QUIZZ_SERVICE_URL: "http://microservice-quizz:7100",
      WORDPASS_SERVICE_URL: "http://microservice-wordpass:7101",
      BFF_MOBILE_URL: "http://bff-mobile:7010",
      API_GATEWAY_URL: "http://api-gateway:7005",
    }));

    const listResponse = await app.inject({
      method: "GET",
      url: "/v1/backoffice/service-targets",
    });

    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json()).toMatchObject({
      total: 7,
      targets: expect.arrayContaining([
        expect.objectContaining({
          service: "microservice-quiz",
          source: "env",
          baseUrl: "http://microservice-quizz:7100",
        }),
        expect.objectContaining({
          service: "ai-engine-api",
          source: "env",
          baseUrl: "http://localhost:7001",
        }),
      ]),
    });

    const overrideResponse = await app.inject({
      method: "PUT",
      url: "/v1/backoffice/service-targets/microservice-quiz",
      payload: {
        baseUrl: "http://192.168.1.90:17100",
        label: "gpu lab quiz",
      },
    });

    expect(overrideResponse.statusCode).toBe(200);
    expect(overrideResponse.json()).toMatchObject({
      service: "microservice-quiz",
      source: "override",
      baseUrl: "http://192.168.1.90:17100",
      label: "gpu lab quiz",
    });

    const catalogsResponse = await app.inject({
      method: "GET",
      url: "/v1/backoffice/services/microservice-quiz/catalogs",
    });

    expect(catalogsResponse.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://192.168.1.90:17100/catalogs",
      expect.objectContaining({
        headers: expect.any(Object),
      }),
    );

    await app.close();
  });

  it("persists routing overrides across BFF restarts", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "axiomnode-bff-routing-"));
    const stateFile = path.join(tempDir, "routing-state.json");

    const appA = Fastify();
    vi.stubGlobal("fetch", vi.fn());

    await backofficeRoutes(appA, {
      SERVICE_NAME: "bff-backoffice",
      SERVICE_PORT: 7011,
      ALLOWED_ORIGINS: "http://localhost:3000",
      USERS_SERVICE_URL: "http://microservice-users:7102",
      AI_ENGINE_STATS_URL: "http://ai-engine-stats:7000",
      AI_ENGINE_API_URL: "http://ai-engine-api:7001",
      BACKOFFICE_ROUTING_STATE_FILE: stateFile,
    });

    const setResponse = await appA.inject({
      method: "PUT",
      url: "/v1/backoffice/service-targets/ai-engine-api",
      payload: {
        baseUrl: "http://192.168.1.80:17001",
        label: "gpu workstation",
      },
    });

    expect(setResponse.statusCode).toBe(200);
    await appA.close();
    vi.unstubAllGlobals();

    const appB = Fastify();
    vi.stubGlobal("fetch", vi.fn());

    await backofficeRoutes(appB, {
      SERVICE_NAME: "bff-backoffice",
      SERVICE_PORT: 7011,
      ALLOWED_ORIGINS: "http://localhost:3000",
      USERS_SERVICE_URL: "http://microservice-users:7102",
      AI_ENGINE_STATS_URL: "http://ai-engine-stats:7000",
      AI_ENGINE_API_URL: "http://ai-engine-api:7001",
      BACKOFFICE_ROUTING_STATE_FILE: stateFile,
    });

    const getResponse = await appB.inject({
      method: "GET",
      url: "/v1/backoffice/service-targets/ai-engine-api",
    });

    expect(getResponse.statusCode).toBe(200);
    expect(getResponse.json()).toMatchObject({
      service: "ai-engine-api",
      source: "override",
      baseUrl: "http://192.168.1.80:17001",
      label: "gpu workstation",
    });

    await appB.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("rejects service target overrides outside the allowlist", async () => {
    const app = Fastify();

    vi.stubGlobal("fetch", vi.fn());

    await backofficeRoutes(app, withStateFile({
      SERVICE_NAME: "bff-backoffice",
      SERVICE_PORT: 7011,
      ALLOWED_ORIGINS: "http://localhost:3000",
      USERS_SERVICE_URL: "http://microservice-users:7102",
      API_GATEWAY_URL: "http://api-gateway:7005",
      ALLOWED_ROUTING_TARGET_HOSTS: "localhost,127.0.0.1,192.168.0.0/16",
    }));

    const response = await app.inject({
      method: "PUT",
      url: "/v1/backoffice/service-targets/microservice-users",
      payload: {
        baseUrl: "https://example.com",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      message: "host 'example.com' is not allowed by ALLOWED_ROUTING_TARGET_HOSTS",
    });

    await app.close();
  });

  it("allows ai-engine target overrides outside the generic allowlist", async () => {
    const app = Fastify();

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ source: "override" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    vi.stubGlobal("fetch", fetchMock);

    await backofficeRoutes(app, withStateFile({
      SERVICE_NAME: "bff-backoffice",
      SERVICE_PORT: 7011,
      ALLOWED_ORIGINS: "http://localhost:3000",
      USERS_SERVICE_URL: "http://microservice-users:7102",
      API_GATEWAY_URL: "http://api-gateway:7005",
      ALLOWED_ROUTING_TARGET_HOSTS: "localhost,127.0.0.1,192.168.0.0/16",
    }));

    const response = await app.inject({
      method: "PUT",
      url: "/v1/backoffice/ai-engine/target",
      payload: {
        host: "example.com",
        apiPort: 17001,
        statsPort: 17000,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      source: "override",
      host: "example.com",
      apiBaseUrl: "http://example.com:17001",
      statsBaseUrl: "http://example.com:17000",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://api-gateway:7005/internal/admin/ai-engine/target",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          host: "example.com",
          protocol: "http",
          apiPort: 17001,
          statsPort: 17000,
        }),
      }),
    );

    await app.close();
  });

  it("lists, creates, updates, deletes, and persists shared ai-engine presets", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "axiomnode-bff-presets-"));
    const stateFile = path.join(tempDir, "routing-state.json");

    const appA = Fastify();
    vi.stubGlobal("fetch", vi.fn());

    await backofficeRoutes(appA, {
      SERVICE_NAME: "bff-backoffice",
      SERVICE_PORT: 7011,
      ALLOWED_ORIGINS: "http://localhost:3000",
      USERS_SERVICE_URL: "http://microservice-users:7102",
      BACKOFFICE_ROUTING_STATE_FILE: stateFile,
    });

    const listResponse = await appA.inject({
      method: "GET",
      url: "/v1/backoffice/ai-engine/presets",
    });

    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json()).toMatchObject({
      total: 2,
      presets: expect.arrayContaining([
        expect.objectContaining({ id: "this-pc-lan", host: "192.168.0.14" }),
        expect.objectContaining({ id: "stg-vps-relay", host: "195.35.48.40" }),
      ]),
    });

    const createResponse = await appA.inject({
      method: "POST",
      url: "/v1/backoffice/ai-engine/presets",
      payload: {
        name: "Relay alternativo",
        host: "10.0.0.25",
        protocol: "http",
        apiPort: 18001,
        statsPort: 18000,
      },
    });

    expect(createResponse.statusCode).toBe(201);
    const createdPreset = createResponse.json() as { id: string };
    expect(createdPreset.id).toBeTruthy();

    const updateResponse = await appA.inject({
      method: "PUT",
      url: `/v1/backoffice/ai-engine/presets/${createdPreset.id}`,
      payload: {
        name: "Relay alternativo v2",
        host: "10.0.0.26",
        protocol: "https",
        apiPort: 18443,
        statsPort: 18444,
      },
    });

    expect(updateResponse.statusCode).toBe(200);
    expect(updateResponse.json()).toMatchObject({
      id: createdPreset.id,
      name: "Relay alternativo v2",
      host: "10.0.0.26",
      protocol: "https",
      apiPort: 18443,
      statsPort: 18444,
    });

    await appA.close();
    vi.unstubAllGlobals();

    const appB = Fastify();
    vi.stubGlobal("fetch", vi.fn());

    await backofficeRoutes(appB, {
      SERVICE_NAME: "bff-backoffice",
      SERVICE_PORT: 7011,
      ALLOWED_ORIGINS: "http://localhost:3000",
      USERS_SERVICE_URL: "http://microservice-users:7102",
      BACKOFFICE_ROUTING_STATE_FILE: stateFile,
    });

    const persistedResponse = await appB.inject({
      method: "GET",
      url: "/v1/backoffice/ai-engine/presets",
    });

    expect(persistedResponse.statusCode).toBe(200);
    expect(persistedResponse.json()).toMatchObject({
      presets: expect.arrayContaining([
        expect.objectContaining({
          id: createdPreset.id,
          name: "Relay alternativo v2",
          host: "10.0.0.26",
          protocol: "https",
        }),
      ]),
    });

    const deleteResponse = await appB.inject({
      method: "DELETE",
      url: `/v1/backoffice/ai-engine/presets/${createdPreset.id}`,
    });

    expect(deleteResponse.statusCode).toBe(200);
    expect(deleteResponse.json()).toEqual({ deleted: true, presetId: createdPreset.id });

    await appB.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("resets configurable service target overrides back to env defaults", async () => {
    const app = Fastify();

    vi.stubGlobal("fetch", vi.fn());

    await backofficeRoutes(app, withStateFile({
      SERVICE_NAME: "bff-backoffice",
      SERVICE_PORT: 7011,
      ALLOWED_ORIGINS: "http://localhost:3000",
      USERS_SERVICE_URL: "http://microservice-users:7102",
      QUIZZ_SERVICE_URL: "http://microservice-quizz:7100",
      WORDPASS_SERVICE_URL: "http://microservice-wordpass:7101",
    }));

    await app.inject({
      method: "PUT",
      url: "/v1/backoffice/service-targets/microservice-wordpass",
      payload: {
        baseUrl: "https://example.internal:7443",
        label: "edge backup",
      },
    });

    const resetResponse = await app.inject({
      method: "DELETE",
      url: "/v1/backoffice/service-targets/microservice-wordpass",
    });

    expect(resetResponse.statusCode).toBe(200);
    expect(resetResponse.json()).toMatchObject({
      service: "microservice-wordpass",
      source: "env",
      baseUrl: "http://microservice-wordpass:7101",
      label: null,
      updatedAt: null,
    });

    await app.close();
  });

  it("allows overriding ai-engine target at runtime and proxies metrics to the override", async () => {
    const app = Fastify();

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === "http://api-gateway:7005/internal/admin/ai-engine/target") {
        return Promise.resolve(
          new Response(JSON.stringify({ source: "override" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }

      return Promise.resolve(
        new Response(JSON.stringify({ status: "ok" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    });

    vi.stubGlobal("fetch", fetchMock);

    await backofficeRoutes(app, withStateFile({
      SERVICE_NAME: "bff-backoffice",
      SERVICE_PORT: 7011,
      ALLOWED_ORIGINS: "http://localhost:3000",
      USERS_SERVICE_URL: "http://microservice-users:7102",
      API_GATEWAY_URL: "http://api-gateway:7005",
      AI_ENGINE_STATS_URL: "http://ai-engine-stats:7000",
      AI_ENGINE_API_URL: "http://ai-engine-api:7001",
      AI_ENGINE_BRIDGE_API_KEY: "bridge-key-123",
    }));

    await app.inject({ method: "DELETE", url: "/v1/backoffice/ai-engine/target" });

    const overrideResponse = await app.inject({
      method: "PUT",
      url: "/v1/backoffice/ai-engine/target",
      payload: {
        host: "192.168.1.80",
        protocol: "http",
        apiPort: 17001,
        statsPort: 17000,
        label: "workstation gpu",
      },
    });

    expect(overrideResponse.statusCode).toBe(200);
    expect(overrideResponse.json()).toMatchObject({
      source: "override",
      host: "192.168.1.80",
      apiBaseUrl: "http://192.168.1.80:17001",
      statsBaseUrl: "http://192.168.1.80:17000",
      label: "workstation gpu",
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/backoffice/services/ai-engine-stats/metrics",
    });

    expect(response.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://192.168.1.80:17000/stats",
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-api-key": "bridge-key-123",
        }),
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "http://api-gateway:7005/internal/admin/ai-engine/target",
      expect.objectContaining({
        method: "PUT",
      }),
    );

    await app.close();
  });

  it("resets ai-engine target override back to env defaults", async () => {
    const app = Fastify();

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    vi.stubGlobal("fetch", fetchMock);

    await backofficeRoutes(app, withStateFile({
      SERVICE_NAME: "bff-backoffice",
      SERVICE_PORT: 7011,
      ALLOWED_ORIGINS: "http://localhost:3000",
      USERS_SERVICE_URL: "http://microservice-users:7102",
      API_GATEWAY_URL: "http://api-gateway:7005",
      AI_ENGINE_STATS_URL: "http://ai-engine-stats:7000",
      AI_ENGINE_API_URL: "http://ai-engine-api:7001",
      AI_ENGINE_BRIDGE_API_KEY: "bridge-key-123",
    }));

    await app.inject({
      method: "PUT",
      url: "/v1/backoffice/ai-engine/target",
      payload: { host: "10.0.0.12" },
    });

    const resetResponse = await app.inject({
      method: "DELETE",
      url: "/v1/backoffice/ai-engine/target",
    });

    expect(resetResponse.statusCode).toBe(200);
    expect(resetResponse.json()).toMatchObject({
      source: "env",
      apiBaseUrl: "http://ai-engine-api:7001",
      statsBaseUrl: "http://ai-engine-stats:7000",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://api-gateway:7005/internal/admin/ai-engine/target",
      expect.objectContaining({
        method: "DELETE",
      }),
    );

    await app.close();
  });
});
