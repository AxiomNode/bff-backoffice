import { describe, expect, it } from "vitest";

import { ServiceMetrics } from "../app/services/serviceMetrics.js";

describe("ServiceMetrics", () => {
  it("tracks route counters in the aggregated snapshot and caps log history", () => {
    const metrics = new ServiceMetrics({
      SERVICE_NAME: "bff-backoffice",
      METRICS_LOG_BUFFER_SIZE: 2,
    } as never);

    metrics.recordIncomingRequest({
      method: "GET",
      route: "/v1/backoffice/services",
      statusCode: 200,
      durationMs: 42,
      requestBytes: 120,
      responseBytes: 480,
    });
    metrics.recordIncomingRequest({
      method: "POST",
      route: "/v1/backoffice/ai-engine/probe",
      statusCode: 502,
      durationMs: 210,
      requestBytes: 256,
      responseBytes: 96,
    });

    metrics.recordLog("info", "started");
    metrics.recordLog("info", "request_completed", { route: "/v1/backoffice/services" });
    metrics.recordLog("error", "request_completed", { route: "/v1/backoffice/ai-engine/probe" });

    expect(metrics.snapshot()).toMatchObject({
      traffic: {
        requestsReceivedTotal: 2,
        errorsTotal: 1,
      },
      requestsByRoute: expect.arrayContaining([
        expect.objectContaining({ method: "GET", route: "/v1/backoffice/services", statusCode: 200, total: 1 }),
        expect.objectContaining({ method: "POST", route: "/v1/backoffice/ai-engine/probe", statusCode: 502, total: 1 }),
      ]),
    });

    expect(metrics.recentLogs()).toHaveLength(2);
  });

  it("handles default branches for empty snapshots, underflow protection and missing buckets", () => {
    const metrics = new ServiceMetrics({
      SERVICE_NAME: "bff-backoffice",
    } as never);

    metrics.decrementInflight();
    expect(metrics.snapshot().traffic).toMatchObject({
      inflightRequests: 0,
      latencyAvgMs: 0,
    });

    const internalMetrics = metrics as unknown as {
      latencyBucketCounters: Map<number, number>;
    };
    internalMetrics.latencyBucketCounters.delete(50);

    metrics.recordIncomingRequest({
      method: "GET",
      route: "/v1/backoffice/services",
      statusCode: 200,
      durationMs: 20,
      requestBytes: 8,
      responseBytes: 16,
    });
    internalMetrics.latencyBucketCounters.delete(100);

    const prometheus = metrics.toPrometheus();
    expect(prometheus).toContain('latency_ms_bucket{service="bff-backoffice",le="50"} 1');
    expect(prometheus).toContain('latency_ms_bucket{service="bff-backoffice",le="100"} 0');

    metrics.recordLog("info", "default-buffer");
    expect(metrics.recentLogs(0)).toHaveLength(1);
  });

  it("falls back to the default log buffer size when config omits it", () => {
    const metrics = new ServiceMetrics({
      SERVICE_NAME: "bff-backoffice",
    } as never);

    for (let index = 0; index < 1002; index += 1) {
      metrics.recordLog("info", `log-${index}`);
    }

    const logs = metrics.recentLogs(2000);
    expect(logs).toHaveLength(1000);
    expect(logs[0]?.message).toBe("log-2");
    expect(logs.at(-1)?.message).toBe("log-1001");
  });
});