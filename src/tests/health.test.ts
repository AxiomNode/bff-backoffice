import { describe, expect, it } from "vitest";

import Fastify from "fastify";
import { healthRoutes } from "../app/routes/health.js";

describe("health routes", () => {
  it("returns bff-backoffice health", async () => {
    const app = Fastify();
    await healthRoutes(app);

    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "ok", service: "bff-backoffice" });

    await app.close();
  });
});
