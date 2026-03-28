import { describe, expect, it, vi } from "vitest";

import Fastify from "fastify";
import { backofficeRoutes } from "../app/routes/backoffice.js";

describe("backoffice routes", () => {
  it("forwards leaderboard to microservice-users", async () => {
    const app = Fastify();

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ source: "users" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    vi.stubGlobal("fetch", fetchMock);

    await backofficeRoutes(app, {
      SERVICE_NAME: "bff-backoffice",
      SERVICE_PORT: 7011,
      ALLOWED_ORIGINS: "http://localhost:3000",
      USERS_SERVICE_URL: "http://microservice-users:7102",
    });

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

    vi.unstubAllGlobals();
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

    await backofficeRoutes(app, {
      SERVICE_NAME: "bff-backoffice",
      SERVICE_PORT: 7011,
      ALLOWED_ORIGINS: "http://localhost:3000",
      USERS_SERVICE_URL: "http://microservice-users:7102",
      QUIZZ_SERVICE_URL: "http://microservice-quizz:7100",
      WORDPASS_SERVICE_URL: "http://microservice-wordpass:7101",
    });

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

    vi.unstubAllGlobals();
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

    await backofficeRoutes(app, {
      SERVICE_NAME: "bff-backoffice",
      SERVICE_PORT: 7011,
      ALLOWED_ORIGINS: "http://localhost:3000",
      USERS_SERVICE_URL: "http://microservice-users:7102",
      QUIZZ_SERVICE_URL: "http://microservice-quizz:7100",
      WORDPASS_SERVICE_URL: "http://microservice-wordpass:7101",
    });

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

    vi.unstubAllGlobals();
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

    await backofficeRoutes(app, {
      SERVICE_NAME: "bff-backoffice",
      SERVICE_PORT: 7011,
      ALLOWED_ORIGINS: "http://localhost:3000",
      USERS_SERVICE_URL: "http://microservice-users:7102",
      QUIZZ_SERVICE_URL: "http://microservice-quizz:7100",
    });

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

    vi.unstubAllGlobals();
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

    await backofficeRoutes(app, {
      SERVICE_NAME: "bff-backoffice",
      SERVICE_PORT: 7011,
      ALLOWED_ORIGINS: "http://localhost:3000",
      USERS_SERVICE_URL: "http://microservice-users:7102",
      AI_ENGINE_STATS_URL: "http://ai-engine-stats:7000",
      AI_ENGINE_BRIDGE_API_KEY: "bridge-key-123",
    });

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

    vi.unstubAllGlobals();
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

    await backofficeRoutes(app, {
      SERVICE_NAME: "bff-backoffice",
      SERVICE_PORT: 7011,
      ALLOWED_ORIGINS: "http://localhost:3000",
      USERS_SERVICE_URL: "http://microservice-users:7102",
      AI_ENGINE_STATS_URL: "http://ai-engine-stats:7000",
      AI_ENGINE_BRIDGE_API_KEY: "bridge-key-123",
    });

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

    vi.unstubAllGlobals();
    await app.close();
  });
});
