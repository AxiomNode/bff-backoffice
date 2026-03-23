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
});
