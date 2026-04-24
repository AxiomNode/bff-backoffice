import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import Fastify from "fastify";
import { backofficeRoutes } from "../app/routes/backoffice.js";
import { RoutingStateStore } from "../app/services/routingStateStore.js";

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

  it("forwards manual history deletion for quiz service", async () => {
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
      url: "/v1/backoffice/services/microservice-quiz/data/entry-9?dataset=history",
      headers: {
        authorization: "Bearer staff-token",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://microservice-quizz:7100/games/history/entry-9",
      expect.objectContaining({
        method: "DELETE",
      }),
    );

    await app.close();
  });

  it("rejects invalid delete service and path parameters before proxying", async () => {
    const app = Fastify();

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await backofficeRoutes(app, withStateFile({
      SERVICE_NAME: "bff-backoffice",
      SERVICE_PORT: 7011,
      ALLOWED_ORIGINS: "http://localhost:3000",
      USERS_SERVICE_URL: "http://microservice-users:7102",
      QUIZZ_SERVICE_URL: "http://microservice-quizz:7100",
      WORDPASS_SERVICE_URL: "http://microservice-wordpass:7101",
    }));

    const invalidService = await app.inject({
      method: "DELETE",
      url: "/v1/backoffice/services/not-real/data/entry-1?dataset=history",
    });
    const invalidEntry = await app.inject({
      method: "DELETE",
      url: "/v1/backoffice/services/microservice-quiz/data/%20?dataset=history",
    });

    expect(invalidService.statusCode).toBe(400);
    expect(invalidService.json()).toEqual({ message: "Invalid service" });
    expect(invalidEntry.statusCode).toBe(500);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await app.close();
  });

  it("forwards manual history updates for quiz service", async () => {
    const app = Fastify();

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ item: { id: "entry-2", status: "pending_review" } }), {
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
      method: "PATCH",
      url: "/v1/backoffice/services/microservice-quiz/data/entry-2",
      headers: {
        authorization: "Bearer staff-token",
      },
      payload: {
        dataset: "history",
        status: "pending_review",
        content: { question: "Q editada" },
      },
    });

    expect(response.statusCode).toBe(200);
    const updateCall = fetchMock.mock.calls.find(([url]) => url === "http://microservice-quizz:7100/games/history/entry-2");
    expect(updateCall).toBeTruthy();
    expect(updateCall?.[1]).toEqual(
      expect.objectContaining({
        method: "PATCH",
      }),
    );
    expect(JSON.parse(String(updateCall?.[1]?.body))).toEqual({
      dataset: "history",
      status: "pending_review",
      content: { question: "Q editada" },
    });

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

  it("forwards game catalogs from microservice-wordpass", async () => {
    const app = Fastify();

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ categories: [{ id: "w1" }], languages: ["es", "en"] }), {
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
      WORDPASS_SERVICE_URL: "http://microservice-wordpass:7101",
    }));

    const response = await app.inject({
      method: "GET",
      url: "/v1/backoffice/services/microservice-wordpass/catalogs",
      headers: {
        authorization: "Bearer staff-token",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      service: "microservice-wordpass",
      catalogs: { categories: [{ id: "w1" }], languages: ["es", "en"] },
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://microservice-wordpass:7101/catalogs");

    await app.close();
  });

  it("reuses cached game catalogs within the TTL window", async () => {
    const app = Fastify();

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ categories: [{ id: "9" }], languages: ["es"] }), {
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
      UPSTREAM_CATALOGS_CACHE_TTL_MS: 60000,
    }));

    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValue(1000);

    const first = await app.inject({
      method: "GET",
      url: "/v1/backoffice/services/microservice-quiz/catalogs",
      headers: { authorization: "Bearer staff-token" },
    });

    nowSpy.mockReturnValue(1500);

    const second = await app.inject({
      method: "GET",
      url: "/v1/backoffice/services/microservice-quiz/catalogs",
      headers: { authorization: "Bearer staff-token" },
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    nowSpy.mockRestore();
    await app.close();
  });

  it("reuses cached logs within the TTL window even when the upstream path has query params", async () => {
    const app = Fastify();

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ logs: [{ message: "ok" }] }), {
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
      UPSTREAM_METRICS_CACHE_TTL_MS: 5000,
    }));

    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValue(1000);

    const first = await app.inject({
      method: "GET",
      url: "/v1/backoffice/services/microservice-users/logs?limit=20",
      headers: { authorization: "Bearer staff-token" },
    });

    nowSpy.mockReturnValue(1500);

    const second = await app.inject({
      method: "GET",
      url: "/v1/backoffice/services/microservice-users/logs?limit=20",
      headers: { authorization: "Bearer staff-token" },
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    nowSpy.mockRestore();
    await app.close();
  });

  it("forwards logs from microservice-quiz through the generic monitor endpoint", async () => {
    const app = Fastify();

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ logs: [{ level: "info", message: "quiz log" }] }), {
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
      url: "/v1/backoffice/services/microservice-quiz/logs?limit=50",
      headers: { authorization: "Bearer staff-token" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      service: "microservice-quiz",
      logs: { logs: [{ level: "info", message: "quiz log" }] },
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://microservice-quizz:7100/monitor/logs?limit=50");

    await app.close();
  });

  it("forwards generation process payloads using itemCount", async () => {
    const app = Fastify();

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ gameType: "quiz", task: { taskId: "task-123", requested: 4 } }), {
        status: 202,
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
      url: "/v1/backoffice/services/microservice-wordpass/generation/process",
      headers: {
        authorization: "Bearer staff-token",
      },
      payload: {
        categoryId: "11",
        language: "es",
        difficultyPercentage: 55,
        itemCount: 4,
        count: 8,
      },
    });

    expect(response.statusCode).toBe(202);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://microservice-wordpass:7101/games/generate/process",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          categoryId: "11",
          language: "es",
          difficultyPercentage: 55,
          itemCount: 4,
          count: 8,
          requestedBy: "backoffice",
        }),
      }),
    );

    await app.close();
  });

  it("uses upstream history pagination metadata for quiz data queries", async () => {
    const app = Fastify();

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: [{ id: "entry-9" }], total: 87, page: 3, pageSize: 25 }), {
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
      method: "GET",
      url: "/v1/backoffice/services/microservice-quiz/data?dataset=history&page=3&pageSize=25&limit=500",
      headers: {
        authorization: "Bearer staff-token",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      total: 87,
      page: 3,
      pageSize: 25,
      rows: [{ id: "entry-9" }],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://microservice-quizz:7100/games/history?limit=500&page=3&pageSize=25",
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer staff-token",
        }),
      }),
    );

    await app.close();
  });

  it("forwards all optional quiz history filters to the upstream query", async () => {
    const app = Fastify();

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: [{ id: "q-1" }], total: 1, page: 1, pageSize: 20 }), {
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
      url: "/v1/backoffice/services/microservice-quiz/data?dataset=history&categoryId=11&language=es&difficultyPercentage=55&status=completed&limit=100",
      headers: { authorization: "Bearer staff-token" },
    });

    expect(response.statusCode).toBe(200);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "http://microservice-quizz:7100/games/history?limit=100&page=1&pageSize=20&categoryId=11&language=es&difficultyPercentage=55&status=completed",
    );

    await app.close();
  });

  it("fetches metrics from wordpass using the generic monitor stats endpoint", async () => {
    const app = Fastify();

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ traffic: { requestsReceivedTotal: 125, latencyAvgMs: 45 } }), {
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
      WORDPASS_SERVICE_URL: "http://microservice-wordpass:7101",
    }));

    const response = await app.inject({
      method: "GET",
      url: "/v1/backoffice/services/microservice-wordpass/metrics",
      headers: { authorization: "Bearer staff-token" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      service: "microservice-wordpass",
      metrics: { traffic: { requestsReceivedTotal: 125, latencyAvgMs: 45 } },
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://microservice-wordpass:7101/monitor/stats");

    await app.close();
  });

  it("forwards dataset process filters to wordpass upstream", async () => {
    const app = Fastify();

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ tasks: [] }), {
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
      method: "GET",
      url: "/v1/backoffice/services/microservice-wordpass/data?dataset=processes&limit=100&status=running&requestedBy=backoffice",
      headers: {
        authorization: "Bearer staff-token",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://microservice-wordpass:7101/games/generate/processes?limit=100&status=running&requestedBy=backoffice",
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer staff-token",
        }),
      }),
    );

    await app.close();
  });

  it("forwards all optional wordpass history filters to the upstream query", async () => {
    const app = Fastify();

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: [{ id: "w-1" }], total: 1, page: 1, pageSize: 20 }), {
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
      WORDPASS_SERVICE_URL: "http://microservice-wordpass:7101",
    }));

    const response = await app.inject({
      method: "GET",
      url: "/v1/backoffice/services/microservice-wordpass/data?dataset=history&categoryId=12&language=es&difficultyPercentage=70&status=completed&limit=250",
      headers: { authorization: "Bearer staff-token" },
    });

    expect(response.statusCode).toBe(200);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "http://microservice-wordpass:7101/games/history?limit=250&page=1&pageSize=20&categoryId=12&language=es&difficultyPercentage=70&status=completed",
    );

    await app.close();
  });

  it("maps leaderboard dataset rows adding rank and metric", async () => {
    const app = Fastify();

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        metric: "score",
        rows: [
          { firebaseUid: "u-1", value: 0.88 },
          { firebaseUid: "u-2", value: 0.61 },
        ],
      }), {
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
      url: "/v1/backoffice/services/microservice-users/data?dataset=leaderboard&metric=score&limit=2",
      headers: { authorization: "Bearer staff-token" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      service: "microservice-users",
      dataset: "leaderboard",
      rows: [
        { rank: 1, metric: "score", firebaseUid: "u-1", value: 0.88 },
        { rank: 2, metric: "score", firebaseUid: "u-2", value: 0.61 },
      ],
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://microservice-users:7102/users/leaderboard?metric=score&limit=2");

    await app.close();
  });

  it("filters and sorts history rows in the BFF when upstream paging metadata is not usable", async () => {
    const app = Fastify();

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        items: [
          { id: "1", score: "8", active: true, meta: { level: "alpha" } },
          { id: "2", score: 15, active: false, meta: { level: "beta" } },
          { id: "3", score: "12", active: true, meta: { level: "gamma" } },
        ],
      }), {
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
      WORDPASS_SERVICE_URL: "http://microservice-wordpass:7101",
    }));

    const response = await app.inject({
      method: "GET",
      url: "/v1/backoffice/services/microservice-wordpass/data?dataset=history&filter=true&sortBy=score&sortDirection=desc&page=1&pageSize=2&limit=20",
      headers: { authorization: "Bearer staff-token" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      total: 2,
      page: 1,
      pageSize: 2,
      rows: [
        { id: "3", score: "12", active: true, meta: { level: "gamma" } },
        { id: "1", score: "8", active: true, meta: { level: "alpha" } },
      ],
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "http://microservice-wordpass:7101/games/history?limit=20&page=1&pageSize=2",
    );

    await app.close();
  });

  it("wraps non-json upstream payloads and derives authorization from firebase id token", async () => {
    const app = Fastify();

    const fetchMock = vi.fn().mockResolvedValue(
      new Response("plain upstream response", {
        status: 200,
        headers: { "content-type": "text/plain" },
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
      headers: { "x-firebase-id-token": "firebase-only-token" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      service: "microservice-quiz",
      catalogs: { raw: "plain upstream response" },
    });
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer firebase-only-token",
          "x-firebase-id-token": "firebase-only-token",
        }),
      }),
    );

    await app.close();
  });

  it("filters and sorts roles data in the BFF without changing nested-match behavior", async () => {
    const app = Fastify();

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        users: [
          { firebaseUid: "uid-1", displayName: "Ana", roles: ["viewer"], score: 20 },
          { firebaseUid: "uid-2", displayName: "Bruno", roles: ["admin", "editor"], score: 10 },
          { firebaseUid: "uid-3", displayName: "Carla", roles: ["editor"], score: 30 },
        ],
      }), {
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
      url: "/v1/backoffice/services/microservice-users/data?dataset=roles&filter=admin&sortBy=score&sortDirection=asc&page=1&pageSize=20&limit=200",
      headers: {
        authorization: "Bearer staff-token",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      total: 1,
      page: 1,
      pageSize: 20,
      rows: [
        expect.objectContaining({
          firebaseUid: "uid-2",
          displayName: "Bruno",
          score: 10,
        }),
      ],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://microservice-users:7102/users/admin/roles",
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer staff-token",
        }),
      }),
    );

    await app.close();
  });

  it("sorts roles rows that include null values without crashing", async () => {
    const app = Fastify();

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        users: [
          { firebaseUid: "uid-null", score: null },
          { firebaseUid: "uid-100", score: 100 },
        ],
      }), {
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
      url: "/v1/backoffice/services/microservice-users/data?dataset=roles&sortBy=score&sortDirection=desc",
      headers: { authorization: "Bearer staff-token" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      rows: [
        { firebaseUid: "uid-100", score: 100 },
        { firebaseUid: "uid-null", score: null },
      ],
    });

    await app.close();
  });

  it("forwards auth, monitor and admin user routes to microservice-users", async () => {
    const app = Fastify();

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ session: true }), {
          status: 201,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ uid: "user-1", role: "admin" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ requestsReceivedTotal: 5 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ stored: true }), {
          status: 201,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ rows: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ firebaseUid: "uid-1", roles: ["admin"] }), {
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

    const commonHeaders = {
      authorization: "Bearer staff-token",
      "x-correlation-id": "corr-users-1",
      "x-firebase-id-token": "firebase-token",
    };

    const authSession = await app.inject({
      method: "POST",
      url: "/v1/backoffice/auth/session",
      headers: commonHeaders,
      payload: { idToken: "firebase-token" },
    });
    const authMe = await app.inject({
      method: "GET",
      url: "/v1/backoffice/auth/me",
      headers: commonHeaders,
    });
    const monitorStats = await app.inject({
      method: "GET",
      url: "/v1/backoffice/monitor/stats?window=1h",
      headers: commonHeaders,
    });
    const manualEvent = await app.inject({
      method: "POST",
      url: "/v1/backoffice/users/events/manual",
      headers: commonHeaders,
      payload: { event: "played", score: 15 },
    });
    const roles = await app.inject({
      method: "GET",
      url: "/v1/backoffice/admin/users/roles",
      headers: commonHeaders,
    });
    const patchRoles = await app.inject({
      method: "PATCH",
      url: "/v1/backoffice/admin/users/roles/uid-1",
      headers: commonHeaders,
      payload: { roles: ["admin"] },
    });

    expect(authSession.statusCode).toBe(201);
    expect(authMe.statusCode).toBe(200);
    expect(monitorStats.statusCode).toBe(200);
    expect(manualEvent.statusCode).toBe(201);
    expect(roles.statusCode).toBe(200);
    expect(patchRoles.statusCode).toBe(200);

    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://microservice-users:7102/users/firebase/session");
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer firebase-token",
          "x-correlation-id": "corr-users-1",
          "x-firebase-id-token": "firebase-token",
        }),
      }),
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe("http://microservice-users:7102/users/me/profile");
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          authorization: "Bearer firebase-token",
          "x-correlation-id": "corr-users-1",
          "x-firebase-id-token": "firebase-token",
        }),
      }),
    );
    expect(fetchMock.mock.calls[2]?.[0]).toBe("http://microservice-users:7102/monitor/stats?window=1h");
    expect(fetchMock.mock.calls[2]?.[1]).toEqual(expect.objectContaining({ method: "GET" }));
    expect(fetchMock.mock.calls[3]?.[0]).toBe("http://microservice-users:7102/users/me/games/events");
    expect(fetchMock.mock.calls[3]?.[1]).toEqual(expect.objectContaining({ method: "POST" }));
    expect(fetchMock.mock.calls[4]?.[0]).toBe("http://microservice-users:7102/users/admin/roles");
    expect(fetchMock.mock.calls[4]?.[1]).toEqual(expect.objectContaining({ method: "GET" }));
    expect(fetchMock.mock.calls[5]?.[0]).toBe("http://microservice-users:7102/users/admin/roles/uid-1");
    expect(fetchMock.mock.calls[5]?.[1]).toEqual(expect.objectContaining({ method: "PATCH" }));

    await app.close();
  });

  it("forwards generation wait, process list and process detail routes", async () => {
    const app = Fastify();

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ taskId: "task-wait-1", completed: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ tasks: [{ taskId: "task-1" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ taskId: "task-1", status: "completed" }), {
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

    const waitResponse = await app.inject({
      method: "POST",
      url: "/v1/backoffice/services/microservice-quiz/generation/wait",
      headers: { authorization: "Bearer staff-token" },
      payload: {
        categoryId: "11",
        language: "es",
        numQuestions: 6,
        count: 3,
      },
    });
    const listResponse = await app.inject({
      method: "GET",
      url: "/v1/backoffice/services/microservice-wordpass/generation/processes?limit=25&status=running&requestedBy=backoffice",
      headers: { authorization: "Bearer staff-token" },
    });
    const detailResponse = await app.inject({
      method: "GET",
      url: "/v1/backoffice/services/microservice-wordpass/generation/process/550e8400-e29b-41d4-a716-446655440000?includeItems=true",
      headers: { authorization: "Bearer staff-token" },
    });

    expect(waitResponse.statusCode).toBe(200);
    expect(listResponse.statusCode).toBe(200);
    expect(detailResponse.statusCode).toBe(200);

    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://microservice-quizz:7100/games/generate/process/wait");
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          categoryId: "11",
          language: "es",
          itemCount: 6,
          count: 3,
          requestedBy: "backoffice",
        }),
      }),
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "http://microservice-wordpass:7101/games/generate/processes?limit=25&status=running&requestedBy=backoffice",
    );
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(expect.objectContaining({ headers: expect.any(Object) }));
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      "http://microservice-wordpass:7101/games/generate/process/550e8400-e29b-41d4-a716-446655440000?includeItems=true",
    );
    expect(fetchMock.mock.calls[2]?.[1]).toEqual(expect.objectContaining({ headers: expect.any(Object) }));

    await app.close();
  });

  it("rejects generation process detail for services that do not support game generation", async () => {
    const app = Fastify();

    const fetchMock = vi.fn();
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
      method: "GET",
      url: "/v1/backoffice/services/microservice-users/generation/process/550e8400-e29b-41d4-a716-446655440000?includeItems=true",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      message: "Service 'microservice-users' does not support game generation",
    });
    expect(fetchMock).not.toHaveBeenCalled();

    await app.close();
  });

  it("uses includeItems=false by default in generation process detail routes", async () => {
    const app = Fastify();

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ taskId: "550e8400-e29b-41d4-a716-446655440000", status: "completed" }), {
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
      method: "GET",
      url: "/v1/backoffice/services/microservice-quiz/generation/process/550e8400-e29b-41d4-a716-446655440000",
    });

    expect(response.statusCode).toBe(200);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "http://microservice-quizz:7100/games/generate/process/550e8400-e29b-41d4-a716-446655440000?includeItems=false",
    );

    await app.close();
  });

  it("rejects unsupported services for generation and manual history operations", async () => {
    const app = Fastify();

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await backofficeRoutes(app, withStateFile({
      SERVICE_NAME: "bff-backoffice",
      SERVICE_PORT: 7011,
      ALLOWED_ORIGINS: "http://localhost:3000",
      USERS_SERVICE_URL: "http://microservice-users:7102",
      QUIZZ_SERVICE_URL: "http://microservice-quizz:7100",
      WORDPASS_SERVICE_URL: "http://microservice-wordpass:7101",
    }));

    const insertResponse = await app.inject({
      method: "POST",
      url: "/v1/backoffice/services/microservice-users/data",
      payload: {
        dataset: "history",
        categoryId: "9",
        language: "es",
        difficultyPercentage: 20,
        content: { question: "Q" },
      },
    });
    const generationResponse = await app.inject({
      method: "POST",
      url: "/v1/backoffice/services/microservice-users/generation/process",
      payload: {
        categoryId: "9",
        language: "es",
      },
    });
    const deleteResponse = await app.inject({
      method: "DELETE",
      url: "/v1/backoffice/services/microservice-users/data/entry-1?dataset=history",
    });

    expect(insertResponse.statusCode).toBe(400);
    expect(insertResponse.json()).toMatchObject({ message: "Service 'microservice-users' does not support manual data insertion" });
    expect(generationResponse.statusCode).toBe(400);
    expect(generationResponse.json()).toMatchObject({ message: "Service 'microservice-users' does not support game generation" });
    expect(deleteResponse.statusCode).toBe(400);
    expect(deleteResponse.json()).toMatchObject({ message: "Service 'microservice-users' does not support manual data deletion" });
    expect(fetchMock).not.toHaveBeenCalled();

    await app.close();
  });

  it("rejects unsupported services for manual updates and generation wait operations", async () => {
    const app = Fastify();

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await backofficeRoutes(app, withStateFile({
      SERVICE_NAME: "bff-backoffice",
      SERVICE_PORT: 7011,
      ALLOWED_ORIGINS: "http://localhost:3000",
      USERS_SERVICE_URL: "http://microservice-users:7102",
      QUIZZ_SERVICE_URL: "http://microservice-quizz:7100",
      WORDPASS_SERVICE_URL: "http://microservice-wordpass:7101",
    }));

    const updateResponse = await app.inject({
      method: "PATCH",
      url: "/v1/backoffice/services/microservice-users/data/entry-1",
      payload: {
        dataset: "history",
        status: "pending_review",
      },
    });
    const waitResponse = await app.inject({
      method: "POST",
      url: "/v1/backoffice/services/microservice-users/generation/wait",
      payload: {
        categoryId: "11",
        language: "es",
      },
    });

    expect(updateResponse.statusCode).toBe(400);
    expect(updateResponse.json()).toMatchObject({
      message: "Service 'microservice-users' does not support manual data updates",
    });
    expect(waitResponse.statusCode).toBe(400);
    expect(waitResponse.json()).toMatchObject({
      message: "Service 'microservice-users' does not support game generation",
    });
    expect(fetchMock).not.toHaveBeenCalled();

    await app.close();
  });

  it("rejects invalid params, queries and payloads before contacting upstream services", async () => {
    const app = Fastify();

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await backofficeRoutes(app, withStateFile({
      SERVICE_NAME: "bff-backoffice",
      SERVICE_PORT: 7011,
      ALLOWED_ORIGINS: "http://localhost:3000",
      USERS_SERVICE_URL: "http://microservice-users:7102",
      QUIZZ_SERVICE_URL: "http://microservice-quizz:7100",
      WORDPASS_SERVICE_URL: "http://microservice-wordpass:7101",
    }));

    const invalidMetrics = await app.inject({
      method: "GET",
      url: "/v1/backoffice/services/unknown/metrics",
    });
    const invalidLogs = await app.inject({
      method: "GET",
      url: "/v1/backoffice/services/microservice-users/logs?limit=zero",
    });
    const invalidDataQuery = await app.inject({
      method: "GET",
      url: "/v1/backoffice/services/microservice-quiz/data?dataset=invalid",
    });
    const invalidCatalogService = await app.inject({
      method: "GET",
      url: "/v1/backoffice/services/microservice-users/catalogs",
    });
    const invalidInsertPayload = await app.inject({
      method: "POST",
      url: "/v1/backoffice/services/microservice-quiz/data",
      payload: {},
    });
    const invalidPatchPayload = await app.inject({
      method: "PATCH",
      url: "/v1/backoffice/services/microservice-quiz/data/entry-1",
      payload: {},
    });
    const invalidGenerationPayload = await app.inject({
      method: "POST",
      url: "/v1/backoffice/services/microservice-quiz/generation/process",
      payload: {},
    });
    const invalidGenerationQuery = await app.inject({
      method: "GET",
      url: "/v1/backoffice/services/microservice-quiz/generation/processes?limit=0",
    });
    const invalidGenerationTask = await app.inject({
      method: "GET",
      url: "/v1/backoffice/services/microservice-quiz/generation/process/not-a-uuid?includeItems=maybe",
    });
    const invalidDeleteQuery = await app.inject({
      method: "DELETE",
      url: "/v1/backoffice/services/microservice-quiz/data/entry-1?dataset=invalid",
    });
    const invalidProbePayload = await app.inject({
      method: "POST",
      url: "/v1/backoffice/ai-engine/probe",
      payload: {},
    });
    const invalidAiTargetPayload = await app.inject({
      method: "PUT",
      url: "/v1/backoffice/ai-engine/target",
      payload: {},
    });
    const invalidPresetId = await app.inject({
      method: "PUT",
      url: "/v1/backoffice/ai-engine/presets/not-a-uuid",
      payload: {
        name: "preset",
        host: "localhost",
        port: 17002,
      },
    });
    const invalidServiceTarget = await app.inject({
      method: "PUT",
      url: "/v1/backoffice/service-targets/not-real",
      payload: { baseUrl: "http://localhost:9999" },
    });
    const invalidDeletePresetId = await app.inject({
      method: "DELETE",
      url: "/v1/backoffice/ai-engine/presets/",
    });

    expect(invalidMetrics.statusCode).toBe(400);
    expect(invalidLogs.statusCode).toBe(400);
    expect(invalidDataQuery.statusCode).toBe(400);
    expect(invalidCatalogService.statusCode).toBe(400);
    expect(invalidInsertPayload.statusCode).toBe(400);
    expect(invalidPatchPayload.statusCode).toBe(400);
    expect(invalidGenerationPayload.statusCode).toBe(400);
    expect(invalidGenerationQuery.statusCode).toBe(400);
    expect(invalidGenerationTask.statusCode).toBe(400);
    expect(invalidDeleteQuery.statusCode).toBe(400);
    expect(invalidProbePayload.statusCode).toBe(400);
    expect(invalidAiTargetPayload.statusCode).toBe(400);
    expect(invalidPresetId.statusCode).toBe(404);
    expect(invalidServiceTarget.statusCode).toBe(400);
    expect(invalidDeletePresetId.statusCode).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();

    await app.close();
  });

  it("rejects invalid service keys across remaining service routes before contacting upstream", async () => {
    const app = Fastify();

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await backofficeRoutes(app, withStateFile({
      SERVICE_NAME: "bff-backoffice",
      SERVICE_PORT: 7011,
      ALLOWED_ORIGINS: "http://localhost:3000",
      USERS_SERVICE_URL: "http://microservice-users:7102",
      QUIZZ_SERVICE_URL: "http://microservice-quizz:7100",
      WORDPASS_SERVICE_URL: "http://microservice-wordpass:7101",
    }));

    const invalidLogs = await app.inject({
      method: "GET",
      url: "/v1/backoffice/services/not-real/logs?limit=10",
    });
    const invalidData = await app.inject({
      method: "GET",
      url: "/v1/backoffice/services/not-real/data?dataset=history",
    });
    const invalidCatalogs = await app.inject({
      method: "GET",
      url: "/v1/backoffice/services/not-real/catalogs",
    });
    const invalidGenerationWait = await app.inject({
      method: "POST",
      url: "/v1/backoffice/services/not-real/generation/wait",
      payload: { categoryId: "9", language: "es" },
    });
    const invalidGenerationProcesses = await app.inject({
      method: "GET",
      url: "/v1/backoffice/services/not-real/generation/processes?limit=10",
    });
    const invalidGenerationDetail = await app.inject({
      method: "GET",
      url: "/v1/backoffice/services/not-real/generation/process/550e8400-e29b-41d4-a716-446655440000?includeItems=false",
    });

    expect(invalidLogs.statusCode).toBe(400);
    expect(invalidLogs.json()).toEqual({ message: "Invalid service" });
    expect(invalidData.statusCode).toBe(400);
    expect(invalidData.json()).toEqual({ message: "Invalid service" });
    expect(invalidCatalogs.statusCode).toBe(400);
    expect(invalidCatalogs.json()).toEqual({ message: "Invalid service" });
    expect(invalidGenerationWait.statusCode).toBe(400);
    expect(invalidGenerationWait.json()).toEqual({ message: "Invalid service" });
    expect(invalidGenerationProcesses.statusCode).toBe(400);
    expect(invalidGenerationProcesses.json()).toEqual({ message: "Invalid service" });
    expect(invalidGenerationDetail.statusCode).toBe(400);
    expect(invalidGenerationDetail.json()).toEqual({ message: "Invalid service" });
    expect(fetchMock).not.toHaveBeenCalled();

    await app.close();
  });

  it("rejects tabular data queries for services without dataset support", async () => {
    const app = Fastify();

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await backofficeRoutes(app, withStateFile({
      SERVICE_NAME: "bff-backoffice",
      SERVICE_PORT: 7011,
      ALLOWED_ORIGINS: "http://localhost:3000",
      USERS_SERVICE_URL: "http://microservice-users:7102",
      QUIZZ_SERVICE_URL: "http://microservice-quizz:7100",
      WORDPASS_SERVICE_URL: "http://microservice-wordpass:7101",
      AI_ENGINE_API_URL: "http://ai-engine-api:7002",
    }));

    const response = await app.inject({
      method: "GET",
      url: "/v1/backoffice/services/ai-engine-api/data?dataset=history",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      message: "Service 'ai-engine-api' does not support tabular data queries",
    });
    expect(fetchMock).not.toHaveBeenCalled();

    await app.close();
  });

  it("rejects missing presets and invalid ids on ai-engine preset deletion", async () => {
    const app = Fastify();

    vi.stubGlobal("fetch", vi.fn());

    await backofficeRoutes(app, withStateFile({
      SERVICE_NAME: "bff-backoffice",
      SERVICE_PORT: 7011,
      ALLOWED_ORIGINS: "http://localhost:3000",
      USERS_SERVICE_URL: "http://microservice-users:7102",
    }));

    const missing = await app.inject({
      method: "DELETE",
      url: "/v1/backoffice/ai-engine/presets/550e8400-e29b-41d4-a716-446655440000",
    });

    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ message: "Preset not found" });

    await app.close();
  });

  it("forwards ai diagnostics test run and status routes and surfaces upstream failures", async () => {
    const app = Fastify();

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ started: true }), {
          status: 202,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: "running" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockRejectedValueOnce(new Error("connection refused"));

    vi.stubGlobal("fetch", fetchMock);

    await backofficeRoutes(app, withStateFile({
      SERVICE_NAME: "bff-backoffice",
      SERVICE_PORT: 7011,
      ALLOWED_ORIGINS: "http://localhost:3000",
      USERS_SERVICE_URL: "http://microservice-users:7102",
      AI_ENGINE_API_URL: "http://ai-engine-api:7001",
      AI_ENGINE_API_KEY: "engine-key",
    }));

    const runResponse = await app.inject({
      method: "POST",
      url: "/v1/backoffice/ai-diagnostics/tests/run",
      headers: { authorization: "Bearer staff-token" },
    });
    const statusResponse = await app.inject({
      method: "GET",
      url: "/v1/backoffice/ai-diagnostics/tests/status",
      headers: { authorization: "Bearer staff-token" },
    });
    const ragFailureResponse = await app.inject({
      method: "GET",
      url: "/v1/backoffice/ai-diagnostics/rag/stats",
      headers: { authorization: "Bearer staff-token" },
    });

    expect(runResponse.statusCode).toBe(202);
    expect(statusResponse.statusCode).toBe(200);
    expect(ragFailureResponse.statusCode).toBe(502);
    expect(ragFailureResponse.json()).toMatchObject({
      message: "ai-engine-api unreachable: connection refused",
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://ai-engine-api:7001/diagnostics/tests/run");
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      method: "POST",
      body: JSON.stringify({}),
      headers: expect.objectContaining({
        authorization: "Bearer staff-token",
        "x-api-key": "engine-key",
      }),
    }));
    expect(fetchMock.mock.calls[1]?.[0]).toBe("http://ai-engine-api:7001/diagnostics/tests/status");
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(expect.objectContaining({ headers: expect.any(Object) }));

    await app.close();
  });

  it("surfaces unknown non-error failures in ai diagnostics routes", async () => {
    const app = Fastify();

    const fetchMock = vi.fn()
      .mockRejectedValueOnce("boom")
      .mockRejectedValueOnce("boom")
      .mockRejectedValueOnce("boom");

    vi.stubGlobal("fetch", fetchMock);

    await backofficeRoutes(app, withStateFile({
      SERVICE_NAME: "bff-backoffice",
      SERVICE_PORT: 7011,
      ALLOWED_ORIGINS: "http://localhost:3000",
      USERS_SERVICE_URL: "http://microservice-users:7102",
      AI_ENGINE_API_URL: "http://ai-engine-api:7001",
    }));

    const ragResponse = await app.inject({
      method: "GET",
      url: "/v1/backoffice/ai-diagnostics/rag/stats",
      headers: { authorization: "Bearer staff-token" },
    });
    const runResponse = await app.inject({
      method: "POST",
      url: "/v1/backoffice/ai-diagnostics/tests/run",
      headers: { authorization: "Bearer staff-token" },
    });
    const statusResponse = await app.inject({
      method: "GET",
      url: "/v1/backoffice/ai-diagnostics/tests/status",
      headers: { authorization: "Bearer staff-token" },
    });

    expect(ragResponse.statusCode).toBe(502);
    expect(ragResponse.json()).toEqual({ message: "ai-engine-api unreachable: Unknown error" });
    expect(runResponse.statusCode).toBe(502);
    expect(runResponse.json()).toEqual({ message: "ai-engine-api unreachable: Unknown error" });
    expect(statusResponse.statusCode).toBe(502);
    expect(statusResponse.json()).toEqual({ message: "ai-engine-api unreachable: Unknown error" });

    await app.close();
  });

  it("reuses cached ai diagnostics rag stats within the TTL window", async () => {
    const app = Fastify();

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ total_chunks: 12, coverage_level: "good", sources: [] }), {
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
      AI_ENGINE_API_URL: "http://ai-engine-api:7001",
      UPSTREAM_METRICS_CACHE_TTL_MS: 5000,
    }));

    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValue(2000);

    const first = await app.inject({
      method: "GET",
      url: "/v1/backoffice/ai-diagnostics/rag/stats",
      headers: { authorization: "Bearer staff-token" },
    });

    nowSpy.mockReturnValue(2500);

    const second = await app.inject({
      method: "GET",
      url: "/v1/backoffice/ai-diagnostics/rag/stats",
      headers: { authorization: "Bearer staff-token" },
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://ai-engine-api:7001/diagnostics/rag/stats",
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer staff-token",
        }),
      }),
    );

    nowSpy.mockRestore();
    await app.close();
  });

  it("handles service logs branches for bff-backoffice, ai-engine-stats and ai-engine-api", async () => {
    const app = Fastify();

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ entries: [{ id: "log-1", message: "generated" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    vi.stubGlobal("fetch", fetchMock);

    const metrics = {
      snapshot: () => ({
        service: "bff-backoffice",
        uptimeSeconds: 0,
        traffic: {
          requestsReceivedTotal: 0,
          errorsTotal: 0,
          inflightRequests: 0,
          latencyCount: 0,
          latencyAvgMs: 0,
          requestBytesInTotal: 0,
          responseBytesOutTotal: 0,
        },
        requestsByRoute: [],
      }),
      recentLogs: () => [{ level: "info", message: "local log" }],
    };

    await backofficeRoutes(app, withStateFile({
      SERVICE_NAME: "bff-backoffice",
      SERVICE_PORT: 7011,
      ALLOWED_ORIGINS: "http://localhost:3000",
      USERS_SERVICE_URL: "http://microservice-users:7102",
      AI_ENGINE_STATS_URL: "http://ai-engine-stats:7000",
      AI_ENGINE_API_URL: "http://ai-engine-api:7001",
    }), metrics as never);

    const localLogs = await app.inject({
      method: "GET",
      url: "/v1/backoffice/services/bff-backoffice/logs?limit=20",
      headers: { authorization: "Bearer staff-token" },
    });
    const statsLogs = await app.inject({
      method: "GET",
      url: "/v1/backoffice/services/ai-engine-stats/logs?limit=15",
      headers: { authorization: "Bearer staff-token" },
    });
    const apiLogs = await app.inject({
      method: "GET",
      url: "/v1/backoffice/services/ai-engine-api/logs?limit=10",
      headers: { authorization: "Bearer staff-token" },
    });

    expect(localLogs.statusCode).toBe(200);
    expect(localLogs.json()).toMatchObject({
      service: "bff-backoffice",
      total: 1,
      logs: [{ level: "info", message: "local log" }],
    });
    expect(statsLogs.statusCode).toBe(200);
    expect(statsLogs.json()).toMatchObject({
      service: "ai-engine-stats",
      logs: { entries: [{ id: "log-1", message: "generated" }] },
    });
    expect(apiLogs.statusCode).toBe(200);
    expect(apiLogs.json()).toMatchObject({
      service: "ai-engine-api",
      total: 0,
      logs: [],
      note: "ai-engine-api no expone logs HTTP directos; usa ai-engine-stats para historial operativo.",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://ai-engine-stats:7000/stats/history?limit=15");

    await app.close();
  });

  it("marks authorization failures as access issues in the operational summary", async () => {
    const app = Fastify();

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === "http://microservice-users:7102/monitor/stats") {
        return Promise.resolve(new Response("forbidden", {
          status: 403,
          headers: { "content-type": "text/plain" },
        }));
      }

      if (url === "http://microservice-quizz:7100/monitor/stats") {
        return Promise.resolve(new Response(JSON.stringify({ traffic: { requestsReceivedTotal: 40 } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }));
      }

      if (url === "http://microservice-wordpass:7101/monitor/stats") {
        return Promise.resolve(new Response(JSON.stringify({ traffic: { requestsReceivedTotal: 30 } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }));
      }

      if (url === "http://localhost:7010/monitor/stats") {
        return Promise.resolve(new Response(JSON.stringify({ traffic: { requestsReceivedTotal: 11 } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }));
      }

      if (url === "http://localhost:7005/monitor/stats") {
        return Promise.resolve(new Response(JSON.stringify({ traffic: { requestsReceivedTotal: 13 } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }));
      }

      if (url === "http://localhost:7000/stats") {
        return Promise.resolve(new Response(JSON.stringify({ requestsReceivedTotal: 5 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }));
      }

      if (url === "http://localhost:7001/health") {
        return Promise.resolve(new Response(JSON.stringify({ status: "ok" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }));
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    await backofficeRoutes(app, withStateFile({
      SERVICE_NAME: "bff-backoffice",
      SERVICE_PORT: 7011,
      ALLOWED_ORIGINS: "http://localhost:3000",
      API_GATEWAY_URL: "http://localhost:7005",
      BFF_MOBILE_URL: "http://localhost:7010",
      USERS_SERVICE_URL: "http://microservice-users:7102",
      QUIZZ_SERVICE_URL: "http://microservice-quizz:7100",
      WORDPASS_SERVICE_URL: "http://microservice-wordpass:7101",
      AI_ENGINE_STATS_URL: "http://localhost:7000",
      AI_ENGINE_API_URL: "http://localhost:7001",
    }));

    const response = await app.inject({
      method: "GET",
      url: "/v1/backoffice/services/operational-summary",
      headers: { authorization: "Bearer staff-token" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      totals: {
        accessIssues: 1,
        connectionErrors: 0,
      },
      rows: expect.arrayContaining([
        expect.objectContaining({
          key: "microservice-users",
          online: false,
          accessGuaranteed: false,
          connectionError: false,
          errorMessage: "HTTP 403: forbidden",
        }),
      ]),
    });

    await app.close();
  });

  it("omits generation conversion ratio when requested total is zero", async () => {
    const app = Fastify();

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === "http://microservice-users:7102/monitor/stats") {
        return Promise.resolve(new Response(JSON.stringify({ traffic: { requestsReceivedTotal: 25 } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }));
      }

      if (url === "http://microservice-quizz:7100/monitor/stats") {
        return Promise.resolve(new Response(JSON.stringify({
          traffic: { requestsReceivedTotal: 40 },
          batch: { requestedTotal: 0, createdTotal: 5 },
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }));
      }

      if (url === "http://microservice-wordpass:7101/monitor/stats") {
        return Promise.resolve(new Response(JSON.stringify({ traffic: { requestsReceivedTotal: 30 } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }));
      }

      if (url === "http://localhost:7010/monitor/stats") {
        return Promise.resolve(new Response(JSON.stringify({ traffic: { requestsReceivedTotal: 11 } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }));
      }

      if (url === "http://localhost:7005/monitor/stats") {
        return Promise.resolve(new Response(JSON.stringify({ traffic: { requestsReceivedTotal: 13 } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }));
      }

      if (url === "http://localhost:7000/stats") {
        return Promise.resolve(new Response(JSON.stringify({ requestsReceivedTotal: 5 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }));
      }

      if (url === "http://localhost:7001/health") {
        return Promise.resolve(new Response(JSON.stringify({ status: "ok" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }));
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    await backofficeRoutes(app, withStateFile({
      SERVICE_NAME: "bff-backoffice",
      SERVICE_PORT: 7011,
      ALLOWED_ORIGINS: "http://localhost:3000",
      API_GATEWAY_URL: "http://localhost:7005",
      BFF_MOBILE_URL: "http://localhost:7010",
      USERS_SERVICE_URL: "http://microservice-users:7102",
      QUIZZ_SERVICE_URL: "http://microservice-quizz:7100",
      WORDPASS_SERVICE_URL: "http://microservice-wordpass:7101",
      AI_ENGINE_STATS_URL: "http://localhost:7000",
      AI_ENGINE_API_URL: "http://localhost:7001",
    }));

    const response = await app.inject({
      method: "GET",
      url: "/v1/backoffice/services/operational-summary",
      headers: { authorization: "Bearer staff-token" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "microservice-quiz",
          generationRequestedTotal: 0,
          generationCreatedTotal: 5,
          generationConversionRatio: null,
        }),
      ]),
    );

    await app.close();
  });

  it("aggregates operational summary server-side for the overview", async () => {
    const app = Fastify();

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === "http://microservice-users:7102/monitor/stats") {
        return Promise.resolve(new Response(JSON.stringify({ traffic: { requestsReceivedTotal: 25 } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }));
      }

      if (url === "http://microservice-quizz:7100/monitor/stats") {
        return Promise.resolve(new Response(JSON.stringify({
          traffic: { requestsReceivedTotal: 40 },
          batch: { requestedTotal: 10, createdTotal: 7 },
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }));
      }

      if (url === "http://microservice-wordpass:7101/monitor/stats") {
        return Promise.resolve(new Response("upstream unavailable", {
          status: 503,
          headers: { "content-type": "text/plain" },
        }));
      }

      if (url === "http://localhost:7010/monitor/stats") {
        return Promise.resolve(new Response(JSON.stringify({ traffic: { requestsReceivedTotal: 11 } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }));
      }

      if (url === "http://localhost:7005/monitor/stats") {
        return Promise.resolve(new Response(JSON.stringify({ traffic: { requestsReceivedTotal: 13 } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }));
      }

      if (url === "http://localhost:7000/stats") {
        return Promise.resolve(new Response(JSON.stringify({ requestsReceivedTotal: 5 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }));
      }

      if (url === "http://localhost:7001/health") {
        return Promise.resolve(new Response(JSON.stringify({ status: "ok" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }));
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    await backofficeRoutes(app, withStateFile({
      SERVICE_NAME: "bff-backoffice",
      SERVICE_PORT: 7011,
      ALLOWED_ORIGINS: "http://localhost:3000",
      API_GATEWAY_URL: "http://localhost:7005",
      BFF_MOBILE_URL: "http://localhost:7010",
      USERS_SERVICE_URL: "http://microservice-users:7102",
      QUIZZ_SERVICE_URL: "http://microservice-quizz:7100",
      WORDPASS_SERVICE_URL: "http://microservice-wordpass:7101",
      AI_ENGINE_STATS_URL: "http://localhost:7000",
      AI_ENGINE_API_URL: "http://localhost:7001",
    }));

    const response = await app.inject({
      method: "GET",
      url: "/v1/backoffice/services/operational-summary",
      headers: {
        authorization: "Bearer staff-token",
        "x-correlation-id": "corr-summary-1",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      totals: {
        total: 8,
        onlineCount: 7,
        accessIssues: 0,
        connectionErrors: 1,
      },
    });
    expect(response.json().rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "microservice-quiz",
          online: true,
          requestsTotal: 40,
          generationRequestedTotal: 10,
          generationCreatedTotal: 7,
          generationConversionRatio: 0.7,
        }),
        expect.objectContaining({
          key: "microservice-wordpass",
          online: false,
          connectionError: true,
          errorMessage: "HTTP 503: upstream unavailable",
        }),
      ]),
    );

    const quizCall = fetchMock.mock.calls.find(([url]) => url === "http://microservice-quizz:7100/monitor/stats");
    expect(quizCall?.[1]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer staff-token",
          "x-correlation-id": "corr-summary-1",
        }),
      }),
    );

    await app.close();
  });

  it("deduplicates concurrent operational summary requests for the same auth context", async () => {
    const app = Fastify();

    const fetchMock = vi.fn().mockImplementation((url: string) => new Promise((resolve) => {
      setTimeout(() => {
        if (url === "http://microservice-users:7102/monitor/stats") {
          resolve(new Response(JSON.stringify({ traffic: { requestsReceivedTotal: 25 } }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }));
          return;
        }

        if (url === "http://microservice-quizz:7100/monitor/stats") {
          resolve(new Response(JSON.stringify({ traffic: { requestsReceivedTotal: 40 } }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }));
          return;
        }

        if (url === "http://microservice-wordpass:7101/monitor/stats") {
          resolve(new Response(JSON.stringify({ traffic: { requestsReceivedTotal: 30 } }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }));
          return;
        }

        if (url === "http://localhost:7010/monitor/stats") {
          resolve(new Response(JSON.stringify({ traffic: { requestsReceivedTotal: 11 } }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }));
          return;
        }

        if (url === "http://localhost:7005/monitor/stats") {
          resolve(new Response(JSON.stringify({ traffic: { requestsReceivedTotal: 13 } }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }));
          return;
        }

        if (url === "http://localhost:7000/stats") {
          resolve(new Response(JSON.stringify({ requestsReceivedTotal: 5 }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }));
          return;
        }

        if (url === "http://localhost:7001/health") {
          resolve(new Response(JSON.stringify({ status: "ok" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }));
          return;
        }

        resolve(new Response("unexpected", { status: 500 }));
      }, 5);
    }));

    vi.stubGlobal("fetch", fetchMock);

    await backofficeRoutes(app, withStateFile({
      SERVICE_NAME: "bff-backoffice",
      SERVICE_PORT: 7011,
      ALLOWED_ORIGINS: "http://localhost:3000",
      API_GATEWAY_URL: "http://localhost:7005",
      BFF_MOBILE_URL: "http://localhost:7010",
      USERS_SERVICE_URL: "http://microservice-users:7102",
      QUIZZ_SERVICE_URL: "http://microservice-quizz:7100",
      WORDPASS_SERVICE_URL: "http://microservice-wordpass:7101",
      AI_ENGINE_STATS_URL: "http://localhost:7000",
      AI_ENGINE_API_URL: "http://localhost:7001",
    }));

    const [first, second] = await Promise.all([
      app.inject({
        method: "GET",
        url: "/v1/backoffice/services/operational-summary",
        headers: { authorization: "Bearer same-token" },
      }),
      app.inject({
        method: "GET",
        url: "/v1/backoffice/services/operational-summary",
        headers: { authorization: "Bearer same-token" },
      }),
    ]);

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(7);

    await app.close();
  });

  it("times out slow upstreams quickly in operational summary without waiting for the global upstream timeout", async () => {
    const app = Fastify();

    const fetchMock = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
      if (url === "http://microservice-wordpass:7101/monitor/stats") {
        return new Promise<Response>((_resolve, reject) => {
          const signal = options?.signal;
          if (signal) {
            signal.addEventListener(
              "abort",
              () => reject(new DOMException("Aborted", "AbortError")),
              { once: true },
            );
          }
        });
      }

      if (url === "http://microservice-users:7102/monitor/stats") {
        return Promise.resolve(new Response(JSON.stringify({ traffic: { requestsReceivedTotal: 25 } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }));
      }

      if (url === "http://microservice-quizz:7100/monitor/stats") {
        return Promise.resolve(new Response(JSON.stringify({ traffic: { requestsReceivedTotal: 40 } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }));
      }

      if (url === "http://localhost:7010/monitor/stats") {
        return Promise.resolve(new Response(JSON.stringify({ traffic: { requestsReceivedTotal: 11 } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }));
      }

      if (url === "http://localhost:7005/monitor/stats") {
        return Promise.resolve(new Response(JSON.stringify({ traffic: { requestsReceivedTotal: 13 } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }));
      }

      if (url === "http://localhost:7000/stats") {
        return Promise.resolve(new Response(JSON.stringify({ requestsReceivedTotal: 5 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }));
      }

      if (url === "http://localhost:7001/health") {
        return Promise.resolve(new Response(JSON.stringify({ status: "ok" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }));
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    await backofficeRoutes(app, withStateFile({
      SERVICE_NAME: "bff-backoffice",
      SERVICE_PORT: 7011,
      ALLOWED_ORIGINS: "http://localhost:3000",
      API_GATEWAY_URL: "http://localhost:7005",
      BFF_MOBILE_URL: "http://localhost:7010",
      USERS_SERVICE_URL: "http://microservice-users:7102",
      QUIZZ_SERVICE_URL: "http://microservice-quizz:7100",
      WORDPASS_SERVICE_URL: "http://microservice-wordpass:7101",
      AI_ENGINE_STATS_URL: "http://localhost:7000",
      AI_ENGINE_API_URL: "http://localhost:7001",
      UPSTREAM_TIMEOUT_MS: 10000,
      UPSTREAM_OPERATIONAL_SUMMARY_TIMEOUT_MS: 50,
    }));

    const startedAt = Date.now();
    const response = await app.inject({
      method: "GET",
      url: "/v1/backoffice/services/operational-summary",
      headers: {
        authorization: "Bearer staff-token",
      },
    });
    const elapsedMs = Date.now() - startedAt;

    expect(response.statusCode).toBe(200);
    expect(elapsedMs).toBeLessThan(1000);
    expect(response.json().rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "microservice-wordpass",
          online: false,
          connectionError: true,
          errorMessage: "Upstream request timed out after 50ms",
        }),
      ]),
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

  it("refreshes metrics after the cache TTL expires", async () => {
    const app = Fastify();

    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(
      new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ));

    vi.stubGlobal("fetch", fetchMock);

    await backofficeRoutes(app, withStateFile({
      SERVICE_NAME: "bff-backoffice",
      SERVICE_PORT: 7011,
      ALLOWED_ORIGINS: "http://localhost:3000",
      USERS_SERVICE_URL: "http://microservice-users:7102",
      AI_ENGINE_STATS_URL: "http://ai-engine-stats:7000",
      AI_ENGINE_BRIDGE_API_KEY: "bridge-key-123",
      UPSTREAM_METRICS_CACHE_TTL_MS: 1000,
    }));

    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValue(2000);

    const first = await app.inject({
      method: "GET",
      url: "/v1/backoffice/services/ai-engine-stats/metrics",
    });

    nowSpy.mockReturnValue(2500);

    const second = await app.inject({
      method: "GET",
      url: "/v1/backoffice/services/ai-engine-stats/metrics",
    });

    nowSpy.mockReturnValue(3105);

    const third = await app.inject({
      method: "GET",
      url: "/v1/backoffice/services/ai-engine-stats/metrics",
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(third.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    nowSpy.mockRestore();
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

  it("does not persist ai-engine-api as a generic routing override across BFF restarts", async () => {
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
      source: "env",
      baseUrl: "http://ai-engine-api:7001",
      label: null,
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

  it("accepts service target overrides that match wildcard and CIDR allowlist rules", async () => {
    const app = Fastify();

    vi.stubGlobal("fetch", vi.fn());

    await backofficeRoutes(app, withStateFile({
      SERVICE_NAME: "bff-backoffice",
      SERVICE_PORT: 7011,
      ALLOWED_ORIGINS: "http://localhost:3000",
      USERS_SERVICE_URL: "http://microservice-users:7102",
      API_GATEWAY_URL: "http://api-gateway:7005",
      ALLOWED_ROUTING_TARGET_HOSTS: "*.internal,192.168.0.0/16",
    }));

    const wildcardResponse = await app.inject({
      method: "PUT",
      url: "/v1/backoffice/service-targets/microservice-users",
      payload: {
        baseUrl: "https://users.internal:7443",
        label: "wildcard host",
      },
    });
    const cidrResponse = await app.inject({
      method: "PUT",
      url: "/v1/backoffice/service-targets/api-gateway",
      payload: {
        baseUrl: "http://192.168.1.80:7005",
        label: "cidr host",
      },
    });

    expect(wildcardResponse.statusCode).toBe(200);
    expect(wildcardResponse.json()).toMatchObject({
      service: "microservice-users",
      source: "override",
      baseUrl: "https://users.internal:7443",
      label: "wildcard host",
    });
    expect(cidrResponse.statusCode).toBe(200);
    expect(cidrResponse.json()).toMatchObject({
      service: "api-gateway",
      source: "override",
      baseUrl: "http://192.168.1.80:7005",
      label: "cidr host",
    });

    await app.close();
  });

  it("accepts service target overrides when the allowlist uses a /0 CIDR rule", async () => {
    const app = Fastify();

    vi.stubGlobal("fetch", vi.fn());

    await backofficeRoutes(app, withStateFile({
      SERVICE_NAME: "bff-backoffice",
      SERVICE_PORT: 7011,
      ALLOWED_ORIGINS: "http://localhost:3000",
      USERS_SERVICE_URL: "http://microservice-users:7102",
      ALLOWED_ROUTING_TARGET_HOSTS: "0.0.0.0/0",
    }));

    const response = await app.inject({
      method: "PUT",
      url: "/v1/backoffice/service-targets/microservice-users",
      payload: {
        baseUrl: "http://8.8.8.8:7102",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      service: "microservice-users",
      source: "override",
      baseUrl: "http://8.8.8.8:7102",
    });

    await app.close();
  });

  it("rejects malformed service target base urls and invalid configurable service keys", async () => {
    const app = Fastify();

    vi.stubGlobal("fetch", vi.fn());

    await backofficeRoutes(app, withStateFile({
      SERVICE_NAME: "bff-backoffice",
      SERVICE_PORT: 7011,
      ALLOWED_ORIGINS: "http://localhost:3000",
      USERS_SERVICE_URL: "http://microservice-users:7102",
      API_GATEWAY_URL: "http://api-gateway:7005",
    }));

    const invalidGet = await app.inject({
      method: "GET",
      url: "/v1/backoffice/service-targets/not-a-service",
    });
    const invalidDelete = await app.inject({
      method: "DELETE",
      url: "/v1/backoffice/service-targets/not-a-service",
    });
    const invalidBaseUrl = await app.inject({
      method: "PUT",
      url: "/v1/backoffice/service-targets/microservice-users",
      payload: {
        baseUrl: "https://users.internal/api?debug=1",
      },
    });
    const invalidProtocol = await app.inject({
      method: "PUT",
      url: "/v1/backoffice/service-targets/microservice-users",
      payload: {
        baseUrl: "ftp://users.internal",
      },
    });

    expect(invalidGet.statusCode).toBe(400);
    expect(invalidGet.json()).toEqual({ message: "Invalid configurable service" });
    expect(invalidDelete.statusCode).toBe(400);
    expect(invalidDelete.json()).toEqual({ message: "Invalid configurable service" });
    expect(invalidBaseUrl.statusCode).toBe(400);
    expect(invalidBaseUrl.json()).toMatchObject({
      message: "baseUrl must not include path, query, or hash",
    });
    expect(invalidProtocol.statusCode).toBe(400);
    expect(invalidProtocol.json()).toMatchObject({
      message: "baseUrl must use http or https",
    });

    await app.close();
  });

  it("allows ai-engine target overrides outside the generic allowlist", async () => {
    const app = Fastify();

    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(
      new Response(JSON.stringify({
        source: "override",
        label: null,
        host: "example.com",
        protocol: "http",
        port: 17002,
        llamaBaseUrl: "http://example.com:17002/v1/completions",
        envLlamaBaseUrl: "http://llama-workstation.invalid:7002/v1/completions",
        updatedAt: "2026-04-19T00:00:00.000Z",
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ));

    vi.stubGlobal("fetch", fetchMock);

    await backofficeRoutes(app, withStateFile({
      SERVICE_NAME: "bff-backoffice",
      SERVICE_PORT: 7011,
      ALLOWED_ORIGINS: "http://localhost:3000",
      USERS_SERVICE_URL: "http://microservice-users:7102",
      API_GATEWAY_URL: "http://api-gateway:7005",
      AI_ENGINE_API_URL: "http://ai-engine-api:7001",
      ALLOWED_ROUTING_TARGET_HOSTS: "localhost,127.0.0.1,192.168.0.0/16",
    }));

    const response = await app.inject({
      method: "PUT",
      url: "/v1/backoffice/ai-engine/target",
      payload: {
        host: "example.com",
        port: 17002,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      source: "override",
      host: "example.com",
      llamaBaseUrl: "http://example.com:17002/v1/completions",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://ai-engine-api:7001/internal/admin/llama-target",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          host: "example.com",
          protocol: "http",
          port: 17002,
        }),
      }),
    );

    await app.close();
  });

  it("reads the current ai-engine target through the dedicated GET route", async () => {
    const app = Fastify();

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        source: "override",
        host: "10.0.0.30",
        protocol: "http",
        port: 17002,
        llamaBaseUrl: "http://10.0.0.30:17002/v1/completions",
      }), {
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
      AI_ENGINE_API_URL: "http://ai-engine-api:7001",
    }));

    const response = await app.inject({
      method: "GET",
      url: "/v1/backoffice/ai-engine/target",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      source: "override",
      host: "10.0.0.30",
      protocol: "http",
      port: 17002,
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://ai-engine-api:7001/internal/admin/llama-target");

    await app.close();
  });

  it("surfaces ai-engine route validation and not-found errors", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "axiomnode-bff-ai-errors-"));
    const stateFile = path.join(tempDir, "routing-state.json");

    const app = Fastify();
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(
      new Response("sync failed", {
        status: 500,
        headers: { "content-type": "text/plain" },
      }),
    ));

    vi.stubGlobal("fetch", fetchMock);

    await backofficeRoutes(app, {
      SERVICE_NAME: "bff-backoffice",
      SERVICE_PORT: 7011,
      ALLOWED_ORIGINS: "http://localhost:3000",
      USERS_SERVICE_URL: "http://microservice-users:7102",
      AI_ENGINE_API_URL: "http://ai-engine-api:7001",
      BACKOFFICE_ROUTING_STATE_FILE: stateFile,
    });

    const invalidProbe = await app.inject({
      method: "POST",
      url: "/v1/backoffice/ai-engine/probe",
      payload: {
        host: "bad host",
        port: 17002,
      },
    });
    const invalidPresetCreate = await app.inject({
      method: "POST",
      url: "/v1/backoffice/ai-engine/presets",
      payload: {
        name: "Preset roto",
        host: "bad host",
        port: 17002,
      },
    });
    const invalidPresetCreatePayload = await app.inject({
      method: "POST",
      url: "/v1/backoffice/ai-engine/presets",
      payload: {},
    });
    const presetUpdateMissing = await app.inject({
      method: "PUT",
      url: "/v1/backoffice/ai-engine/presets/missing-preset",
      payload: {
        name: "Preset missing",
        host: "10.0.0.30",
        protocol: "http",
        port: 17002,
      },
    });
    const invalidPresetUpdateId = await app.inject({
      method: "PUT",
      url: `/v1/backoffice/ai-engine/presets/${"x".repeat(121)}`,
      payload: {
        name: "Preset invalid id",
        host: "10.0.0.30",
        protocol: "http",
        port: 17002,
      },
    });
    const presetUpdateInvalidHost = await app.inject({
      method: "PUT",
      url: "/v1/backoffice/ai-engine/presets/this-pc-lan",
      payload: {
        name: "Preset roto",
        host: "bad host",
        protocol: "http",
        port: 17002,
      },
    });
    const presetUpdateInvalidPayload = await app.inject({
      method: "PUT",
      url: "/v1/backoffice/ai-engine/presets/this-pc-lan",
      payload: {},
    });
    const presetDeleteMissing = await app.inject({
      method: "DELETE",
      url: "/v1/backoffice/ai-engine/presets/missing-preset",
    });
    const invalidTargetPut = await app.inject({
      method: "PUT",
      url: "/v1/backoffice/ai-engine/target",
      payload: {
        host: "relay.internal",
        port: 17002,
      },
    });
    const invalidTargetDelete = await app.inject({
      method: "DELETE",
      url: "/v1/backoffice/ai-engine/target",
    });

    expect(invalidProbe.statusCode).toBe(400);
    expect(invalidProbe.json()).toMatchObject({
      message: "host must be a valid hostname or IPv4 address",
    });
    expect(invalidPresetCreate.statusCode).toBe(400);
    expect(invalidPresetCreate.json()).toMatchObject({
      message: "host must be a valid hostname or IPv4 address",
    });
    expect(invalidPresetCreatePayload.statusCode).toBe(400);
    expect(invalidPresetCreatePayload.json()).toMatchObject({
      message: "Invalid payload",
    });
    expect(presetUpdateMissing.statusCode).toBe(404);
    expect(presetUpdateMissing.json()).toEqual({ message: "Preset not found" });
    expect(invalidPresetUpdateId.statusCode).toBe(404);
    expect(presetUpdateInvalidHost.statusCode).toBe(400);
    expect(presetUpdateInvalidHost.json()).toMatchObject({
      message: "host must be a valid hostname or IPv4 address",
    });
    expect(presetUpdateInvalidPayload.statusCode).toBe(400);
    expect(presetUpdateInvalidPayload.json()).toMatchObject({
      message: "Invalid payload",
    });
    expect(presetDeleteMissing.statusCode).toBe(404);
    expect(presetDeleteMissing.json()).toEqual({ message: "Preset not found" });
    expect(invalidTargetPut.statusCode).toBe(400);
    expect(invalidTargetPut.json()).toMatchObject({ message: "sync failed" });
    expect(invalidTargetDelete.statusCode).toBe(400);
    expect(invalidTargetDelete.json()).toMatchObject({ message: "sync failed" });

    await app.close();
    await rm(tempDir, { recursive: true, force: true });
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
        expect.objectContaining({ id: "workstation-public", host: "195.35.48.40" }),
      ]),
    });

    const createResponse = await appA.inject({
      method: "POST",
      url: "/v1/backoffice/ai-engine/presets",
      payload: {
        name: "Relay alternativo",
        host: "10.0.0.25",
        protocol: "http",
        port: 18002,
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
        port: 18443,
      },
    });

    expect(updateResponse.statusCode).toBe(200);
    expect(updateResponse.json()).toMatchObject({
      id: createdPreset.id,
      name: "Relay alternativo v2",
      host: "10.0.0.26",
      protocol: "https",
      port: 18443,
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

  it("migrates legacy version 2 ai-engine presets preserving their apiPort", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "axiomnode-bff-presets-v2-"));
    const stateFile = path.join(tempDir, "routing-state.json");

    await writeFile(
      stateFile,
      `${JSON.stringify({
        version: 2,
        overrides: {},
        aiEnginePresets: [
          {
            id: "legacy-relay",
            name: "Legacy relay",
            host: "195.35.48.40",
            protocol: "http",
            apiPort: 27001,
            statsPort: 27000,
            updatedAt: "2026-04-19T00:00:00.000Z",
          },
        ],
      }, null, 2)}\n`,
      "utf8",
    );

    const store = new RoutingStateStore({ BACKOFFICE_ROUTING_STATE_FILE: stateFile } as never);
    await store.load();

    expect(store.listAiEnginePresets()).toEqual([
      expect.objectContaining({
        id: "legacy-relay",
        host: "195.35.48.40",
        port: 27001,
      }),
    ]);

    await rm(tempDir, { recursive: true, force: true });
  });

  it("probes ai-engine runtime targets before activation", async () => {
    const app = Fastify();

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === "http://10.0.0.25:17002/v1/models") {
        return Promise.resolve(
          new Response(JSON.stringify({ status: "ready" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    await backofficeRoutes(app, withStateFile({
      SERVICE_NAME: "bff-backoffice",
      SERVICE_PORT: 7011,
      ALLOWED_ORIGINS: "http://localhost:3000",
      USERS_SERVICE_URL: "http://microservice-users:7102",
      AI_ENGINE_BRIDGE_API_KEY: "bridge-key-123",
    }));

    const response = await app.inject({
      method: "POST",
      url: "/v1/backoffice/ai-engine/probe",
      payload: {
        host: "10.0.0.25",
        protocol: "http",
        port: 17002,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      host: "10.0.0.25",
      reachable: true,
      llama: {
        ok: true,
        status: 200,
        url: "http://10.0.0.25:17002/v1/models",
      },
    });

    await app.close();
  });

  it("normalizes probe hosts that include an explicit port", async () => {
    const app = Fastify();

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === "http://10.0.0.25:17002/v1/models") {
        return Promise.resolve(
          new Response(JSON.stringify({ status: "ready" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    await backofficeRoutes(app, withStateFile({
      SERVICE_NAME: "bff-backoffice",
      SERVICE_PORT: 7011,
      ALLOWED_ORIGINS: "http://localhost:3000",
      USERS_SERVICE_URL: "http://microservice-users:7102",
    }));

    const response = await app.inject({
      method: "POST",
      url: "/v1/backoffice/ai-engine/probe",
      payload: {
        host: "10.0.0.25:7002",
        protocol: "http",
        port: 17002,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      host: "10.0.0.25",
      llama: {
        url: "http://10.0.0.25:17002/v1/models",
      },
    });

    await app.close();
  });

  it("fetches ai-engine-api metrics through the health endpoint branch", async () => {
    const app = Fastify();

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "ok", version: "1.0.0" }), {
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
      AI_ENGINE_API_URL: "http://ai-engine-api:7001",
    }));

    const response = await app.inject({
      method: "GET",
      url: "/v1/backoffice/services/ai-engine-api/metrics",
      headers: { authorization: "Bearer staff-token" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      service: "ai-engine-api",
      metrics: { status: "ok", version: "1.0.0" },
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://ai-engine-api:7001/health");

    await app.close();
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

    const fetchMock = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
      if (url === "http://ai-engine-api:7001/internal/admin/llama-target") {
        return Promise.resolve(
          new Response(JSON.stringify({
            source: options?.method === "DELETE" ? "env" : "override",
            label: options?.method === "DELETE" ? null : "workstation gpu",
            host: options?.method === "DELETE" ? "llama-workstation.invalid" : "192.168.1.80",
            protocol: "http",
            port: options?.method === "DELETE" ? 7002 : 17002,
            llamaBaseUrl: options?.method === "DELETE" ? "http://llama-workstation.invalid:7002/v1/completions" : "http://192.168.1.80:17002/v1/completions",
            envLlamaBaseUrl: "http://llama-workstation.invalid:7002/v1/completions",
            updatedAt: options?.method === "DELETE" ? null : "2026-04-19T00:00:00.000Z",
          }), {
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
        port: 17002,
        label: "workstation gpu",
      },
    });

    expect(overrideResponse.statusCode).toBe(200);
    expect(overrideResponse.json()).toMatchObject({
      source: "override",
      host: "192.168.1.80",
      llamaBaseUrl: "http://192.168.1.80:17002/v1/completions",
      label: "workstation gpu",
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
    expect(fetchMock).toHaveBeenCalledWith(
      "http://ai-engine-api:7001/internal/admin/llama-target",
      expect.objectContaining({
        method: "PUT",
      }),
    );

    await app.close();
  });

  it("resets ai-engine target override back to env defaults", async () => {
    const app = Fastify();
    let overrideActive = true;

    const fetchMock = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
      if (options?.method === "DELETE") {
        overrideActive = false;
      }

      return Promise.resolve(new Response(JSON.stringify({
        source: overrideActive ? "override" : "env",
        label: null,
        host: overrideActive ? "10.0.0.12" : "llama-workstation.invalid",
        protocol: "http",
        port: 7002,
        llamaBaseUrl: overrideActive ? "http://10.0.0.12:7002/v1/completions" : "http://llama-workstation.invalid:7002/v1/completions",
        envLlamaBaseUrl: "http://llama-workstation.invalid:7002/v1/completions",
        updatedAt: overrideActive ? "2026-04-19T00:00:00.000Z" : null,
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }));
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
      llamaBaseUrl: "http://llama-workstation.invalid:7002/v1/completions",
      envLlamaBaseUrl: "http://llama-workstation.invalid:7002/v1/completions",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://ai-engine-api:7001/internal/admin/llama-target",
      expect.objectContaining({
        method: "DELETE",
      }),
    );

    await app.close();
  });
});
