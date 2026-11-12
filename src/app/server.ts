import "dotenv/config";

import cors from "@fastify/cors";
import Fastify from "fastify";
import { registerHttpMetricsHooks } from "@axiomnode/shared-sdk-client/http-service-metrics";
import {
  CircuitBreakerOpenError,
  isUpstreamTimeoutError,
  configureHttpAgent,
} from "@axiomnode/shared-sdk-client/proxy";

import { isDevelopmentLikeEnv, loadConfig } from "./config.js";
import { backofficeRoutes } from "./routes/backoffice.js";
import { healthRoutes } from "./routes/health.js";
import { monitoringRoutes } from "./routes/monitoring.js";
import { ServiceMetrics } from "./services/serviceMetrics.js";
import { AuditTrailStore, classifyAdminAction, resolveActor } from "./services/auditTrailStore.js";

configureHttpAgent();

/** @module server — Fastify-based BFF-Backoffice server with CORS, metrics, and backoffice routes. */

export async function buildServer() {
  const config = loadConfig();
  const app = Fastify({ logger: true });
  if (!config.ALLOWED_ROUTING_TARGET_HOSTS?.trim()) {
    app.log.warn(
      isDevelopmentLikeEnv()
        ? "ALLOWED_ROUTING_TARGET_HOSTS is empty: routing targets are unrestricted (development/test only)"
        : "ALLOWED_ROUTING_TARGET_HOSTS is empty: routing target overrides will be denied until it is set",
    );
  }
  const metrics = new ServiceMetrics(config);
  const auditTrail = new AuditTrailStore(config);

  const allowedOrigins = config.ALLOWED_ORIGINS.split(",").map((v) => v.trim());
  await app.register(cors, { origin: allowedOrigins });

  registerHttpMetricsHooks(app, {
    metrics,
    serviceName: config.SERVICE_NAME,
    onRequestCompleted: ({ request, reply, route, correlationId, durationMs, requestBytes }) => {
      const classification = classifyAdminAction(request.method, route);
      if (classification.audit) {
        void auditTrail.record({
          correlationId,
          actor: resolveActor(request.headers),
          ip: (request.ip ?? "unknown").toString(),
          method: request.method,
          route,
          category: classification.category,
          action: classification.action,
          statusCode: reply.statusCode,
          durationMs,
          requestBytes,
        });
      }
    },
  });

  await healthRoutes(app);
  await monitoringRoutes(app, metrics);
  await backofficeRoutes(app, config, metrics);

  app.get("/v1/backoffice/admin/audit", async (request, reply) => {
    const limit = Math.min(2000, Math.max(1, Number((request.query as { limit?: string } | undefined)?.limit ?? 100)));
    const events = await auditTrail.query(limit);
    return reply.send({
      enabled: auditTrail.isEnabled(),
      retentionDays: config.AUDIT_TRAIL_RETENTION_DAYS ?? 90,
      total: events.length,
      events,
    });
  });

  app.setErrorHandler((error, _request, reply) => {
    if (isUpstreamTimeoutError(error)) {
      reply.status(504).send({
        message: "Upstream request timed out",
        error: error instanceof Error ? error.message : "Timeout",
      });
      return;
    }

    if (error instanceof CircuitBreakerOpenError) {
      reply.status(503).send({
        message: "Upstream temporarily unavailable",
        error: error.message,
      });
      return;
    }

    reply.send(error);
  });

  return { app, config, metrics };
}

async function main() {
  const { app, config, metrics } = await buildServer();
  await app.listen({ host: "0.0.0.0", port: config.SERVICE_PORT });
  metrics.recordLog("info", "bff_backoffice_started", { port: config.SERVICE_PORT });
  app.log.info({ service: config.SERVICE_NAME }, "BFF backoffice started");
}

const isDirectRun = (() => {
  try {
    const entryUrl = new URL(`file://${process.argv[1] ?? ""}`).href;
    return import.meta.url === entryUrl;
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
