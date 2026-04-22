import "dotenv/config";

import cors from "@fastify/cors";
import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import {
  CircuitBreakerOpenError,
  isUpstreamTimeoutError,
  configureHttpAgent,
} from "@axiomnode/shared-sdk-client/proxy";

import { loadConfig } from "./config.js";
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
  const metrics = new ServiceMetrics(config);
  const auditTrail = new AuditTrailStore(config);

  const allowedOrigins = config.ALLOWED_ORIGINS.split(",").map((v) => v.trim());
  await app.register(cors, { origin: allowedOrigins });

  app.addHook("onRequest", async (request) => {
    const requestAny = request as typeof request & {
      _requestBytes?: number;
      _startedAt?: number;
      _correlationId?: string;
    };

    requestAny._startedAt = Date.now();
    const contentLength = Number(request.headers["content-length"] ?? 0);
    requestAny._requestBytes = Number.isFinite(contentLength) ? contentLength : 0;

    const inboundCorrelationId = String(request.headers["x-correlation-id"] ?? "").trim();
    requestAny._correlationId = inboundCorrelationId || randomUUID();
    request.headers["x-correlation-id"] = requestAny._correlationId;

    metrics.incrementInflight();
  });

  app.addHook("onResponse", async (request, reply) => {
    if (request.url === "/health") {
      metrics.decrementInflight();
      return;
    }

    const requestAny = request as typeof request & {
      _requestBytes?: number;
      _startedAt?: number;
      _correlationId?: string;
    };

    const responseContentLength = Number(reply.getHeader("content-length") ?? 0);
    const responseBytes = Number.isFinite(responseContentLength) ? responseContentLength : 0;
    const route = (request.routeOptions.url ?? "UNMATCHED") as string;
    const correlationId = requestAny._correlationId ?? randomUUID();
    const durationMs = Math.max(0, Date.now() - (requestAny._startedAt ?? Date.now()));

    reply.header("x-correlation-id", correlationId);

    metrics.recordIncomingRequest({
      method: request.method,
      route,
      statusCode: reply.statusCode,
      durationMs,
      requestBytes: requestAny._requestBytes ?? 0,
      responseBytes,
    });

    app.log.info({
      correlation_id: correlationId,
      service: config.SERVICE_NAME,
      route,
      status_code: reply.statusCode,
      duration_ms: durationMs,
      error_code: reply.statusCode >= 500 ? "upstream_or_internal_error" : undefined,
    });

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
        requestBytes: requestAny._requestBytes ?? 0,
      });
    }

    metrics.decrementInflight();
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
