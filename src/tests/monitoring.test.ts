import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import Fastify from "fastify";

import { monitoringRoutes } from "../app/routes/monitoring.js";
import { RoutingStateStore } from "../app/services/routingStateStore.js";
import { ServiceMetrics } from "../app/services/serviceMetrics.js";

let tempDir = "";
let stateFile = "";

function createMetrics(bufferSize?: number) {
  return new ServiceMetrics({
    SERVICE_NAME: "bff-backoffice",
    METRICS_LOG_BUFFER_SIZE: bufferSize,
  } as never);
}

describe("monitoring routes", () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "axiomnode-bff-backoffice-monitoring-"));
    stateFile = path.join(tempDir, "routing-state.json");
  });

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
    tempDir = "";
    stateFile = "";
  });

  it("returns stats, bounded logs and prometheus metrics", async () => {
    const app = Fastify();
    const metrics = createMetrics(2);
    const routingStore = new RoutingStateStore({ BACKOFFICE_ROUTING_STATE_FILE: stateFile } as never);

    await routingStore.load();
    await routingStore.set("microservice-users", {
      baseUrl: "http://microservice-users:7102",
      label: "cluster",
      updatedAt: "2026-04-21T00:00:00.000Z",
    });

    metrics.incrementInflight();
    metrics.recordIncomingRequest({
      method: "GET",
      route: "/v1/backoffice/services",
      statusCode: 200,
      durationMs: 120,
      requestBytes: 64,
      responseBytes: 256,
    });
    metrics.recordIncomingRequest({
      method: "POST",
      route: "/v1/backoffice/ai-engine/probe",
      statusCode: 503,
      durationMs: 6000,
      requestBytes: 32,
      responseBytes: 16,
    });
    metrics.decrementInflight();
    metrics.decrementInflight();

    metrics.recordLog("info", "first");
    metrics.recordLog("warn", "second", { attempt: 2 });
    metrics.recordLog("error", "third", { cause: "timeout" });

    await monitoringRoutes(app, metrics);

    const statsResponse = await app.inject({ method: "GET", url: "/monitor/stats" });
    expect(statsResponse.statusCode).toBe(200);
    expect(statsResponse.json()).toMatchObject({
      service: "bff-backoffice",
      traffic: {
        requestsReceivedTotal: 2,
        errorsTotal: 1,
        inflightRequests: 0,
        latencyCount: 2,
        requestBytesInTotal: 96,
        responseBytesOutTotal: 272,
      },
    });

    const logsResponse = await app.inject({ method: "GET", url: "/monitor/logs?limit=2" });
    expect(logsResponse.statusCode).toBe(200);
    expect(logsResponse.json()).toMatchObject({
      service: "bff-backoffice",
      total: 2,
      logs: [
        expect.objectContaining({ level: "warn", message: "second" }),
        expect.objectContaining({ level: "error", message: "third" }),
      ],
    });

    const metricsResponse = await app.inject({ method: "GET", url: "/metrics" });
    expect(metricsResponse.statusCode).toBe(200);
    expect(metricsResponse.body).toContain("bff_backoffice_requests_received_total 2");
    expect(metricsResponse.body).toContain('errors_total{service="bff-backoffice"} 1');
    expect(metricsResponse.body).toContain('latency_ms_bucket{service="bff-backoffice",le="+Inf"} 2');

    await app.close();
  });

  it("rejects invalid log query params and accepts omitted query via defaults", async () => {
    const app = Fastify();
    const metrics = createMetrics();
    metrics.recordLog("info", "kept");

    await monitoringRoutes(app, metrics);

    const invalidResponse = await app.inject({ method: "GET", url: "/monitor/logs?limit=0" });
    expect(invalidResponse.statusCode).toBe(400);
    expect(invalidResponse.json()).toMatchObject({ message: "Invalid query parameters" });

    const defaultResponse = await app.inject({ method: "GET", url: "/monitor/logs" });
    expect(defaultResponse.statusCode).toBe(200);
    expect(defaultResponse.json()).toMatchObject({
      service: "bff-backoffice",
      total: 1,
      logs: [expect.objectContaining({ message: "kept" })],
    });

    await app.close();
  });
});