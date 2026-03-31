import type { FastifyInstance } from "fastify";

/** @module health — Liveness health-check endpoint for the BFF-Backoffice service. */

/** Registers the /health route returning service status. */
export async function healthRoutes(app: FastifyInstance) {
  app.get("/health", async () => {
    return {
      status: "ok",
      service: "bff-backoffice",
      timestamp: new Date().toISOString(),
    };
  });
}
