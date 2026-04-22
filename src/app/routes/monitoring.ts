import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { ServiceMetrics } from "../services/serviceMetrics.js";

/** @module monitoring — Observability routes exposing stats, logs, and Prometheus metrics. */

const LogsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(2000).default(200),
});

/** Registers /monitor/stats, /monitor/logs, and /metrics endpoints. */
export async function monitoringRoutes(app: FastifyInstance, metrics: ServiceMetrics): Promise<void> {
  app.get("/monitor/stats", async (_request, reply) => {
    return reply.send(metrics.snapshot());
  });

  app.get("/monitor/logs", async (request, reply) => {
    /* v8 ignore next -- Fastify always materializes request.query for matched routes; the nullish fallback is defensive only */
    const parsed = LogsQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        message: "Invalid query parameters",
        errors: parsed.error.flatten(),
      });
    }

    const logs = metrics.recentLogs(parsed.data.limit);
    return reply.send({
      service: "bff-backoffice",
      total: logs.length,
      logs,
    });
  });

  app.get("/metrics", async (_request, reply) => {
    reply.type("text/plain; version=0.0.4");
    return reply.send(metrics.toPrometheus());
  });
}
