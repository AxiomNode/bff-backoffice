import type { AppConfig } from "../config.js";

/** @module serviceMetrics — In-memory metrics collection with Prometheus export for the BFF-Backoffice service. */

type LogLevel = "info" | "warn" | "error";

type LogEvent = {
  ts: string;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
};

/** Collects request counts, latency histograms, byte totals, and structured logs. */
export class ServiceMetrics {
  private readonly startedAt = Date.now();
  private readonly routeCounters = new Map<string, number>();
  private readonly logs: LogEvent[] = [];
  private readonly latencyBucketsMs = [50, 100, 250, 500, 1000, 2500, 5000] as const;
  private readonly latencyBucketCounters = new Map<number, number>();

  private requestsReceivedTotal = 0;
  private errorsTotal = 0;
  private inflightRequests = 0;
  private latencyCount = 0;
  private latencySumMs = 0;
  private requestBytesInTotal = 0;
  private responseBytesOutTotal = 0;

  constructor(private readonly config: AppConfig) {
    for (const bucket of this.latencyBucketsMs) {
      this.latencyBucketCounters.set(bucket, 0);
    }
  }

  incrementInflight(): void {
    this.inflightRequests += 1;
  }

  decrementInflight(): void {
    this.inflightRequests = Math.max(0, this.inflightRequests - 1);
  }

  recordIncomingRequest(metric: {
    method: string;
    route: string;
    statusCode: number;
    durationMs: number;
    requestBytes: number;
    responseBytes: number;
  }): void {
    this.requestsReceivedTotal += 1;
    if (metric.statusCode >= 500) {
      this.errorsTotal += 1;
    }

    this.latencyCount += 1;
    this.latencySumMs += metric.durationMs;
    for (const bucket of this.latencyBucketsMs) {
      if (metric.durationMs <= bucket) {
        this.latencyBucketCounters.set(bucket, (this.latencyBucketCounters.get(bucket) ?? 0) + 1);
      }
    }

    this.requestBytesInTotal += metric.requestBytes;
    this.responseBytesOutTotal += metric.responseBytes;

    const key = `${metric.method}|${metric.route}|${metric.statusCode}`;
    this.routeCounters.set(key, (this.routeCounters.get(key) ?? 0) + 1);
  }

  recordLog(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    this.logs.push({
      ts: new Date().toISOString(),
      level,
      message,
      context,
    });

    const maxSize = this.config.METRICS_LOG_BUFFER_SIZE ?? 1000;
    if (this.logs.length > maxSize) {
      this.logs.splice(0, this.logs.length - maxSize);
    }
  }

  recentLogs(limit = 200): LogEvent[] {
    return this.logs.slice(-Math.max(1, limit));
  }

  snapshot() {
    return {
      service: this.config.SERVICE_NAME,
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      traffic: {
        requestsReceivedTotal: this.requestsReceivedTotal,
        errorsTotal: this.errorsTotal,
        inflightRequests: this.inflightRequests,
        latencyCount: this.latencyCount,
        latencyAvgMs: this.latencyCount > 0 ? this.latencySumMs / this.latencyCount : 0,
        requestBytesInTotal: this.requestBytesInTotal,
        responseBytesOutTotal: this.responseBytesOutTotal,
      },
      requestsByRoute: Array.from(this.routeCounters.entries()).map(([key, total]) => {
        const [method, route, statusCode] = key.split("|");
        return {
          method,
          route,
          statusCode: Number(statusCode),
          total,
        };
      }),
    };
  }

  toPrometheus(): string {
    const lines: string[] = [];

    lines.push("# HELP bff_backoffice_requests_received_total Total incoming requests");
    lines.push("# TYPE bff_backoffice_requests_received_total counter");
    lines.push(`bff_backoffice_requests_received_total ${this.requestsReceivedTotal}`);

    lines.push("# HELP bff_backoffice_request_bytes_in_total Total request bytes in");
    lines.push("# TYPE bff_backoffice_request_bytes_in_total counter");
    lines.push(`bff_backoffice_request_bytes_in_total ${this.requestBytesInTotal}`);

    lines.push("# HELP bff_backoffice_response_bytes_out_total Total response bytes out");
    lines.push("# TYPE bff_backoffice_response_bytes_out_total counter");
    lines.push(`bff_backoffice_response_bytes_out_total ${this.responseBytesOutTotal}`);

    lines.push("# HELP requests_total Total requests by service/method/route/status");
    lines.push("# TYPE requests_total counter");
    for (const [key, total] of this.routeCounters.entries()) {
      const [method, route, statusCode] = key.split("|");
      lines.push(
        `requests_total{service="${this.config.SERVICE_NAME}",method="${method}",route="${route}",status_code="${statusCode}"} ${total}`
      );
    }

    lines.push("# HELP errors_total Total 5xx responses");
    lines.push("# TYPE errors_total counter");
    lines.push(`errors_total{service="${this.config.SERVICE_NAME}"} ${this.errorsTotal}`);

    lines.push("# HELP inflight_requests Current inflight requests");
    lines.push("# TYPE inflight_requests gauge");
    lines.push(`inflight_requests{service="${this.config.SERVICE_NAME}"} ${this.inflightRequests}`);

    lines.push("# HELP latency_ms_bucket Request latency bucketed histogram");
    lines.push("# TYPE latency_ms_bucket histogram");
    for (const bucket of this.latencyBucketsMs) {
      lines.push(
        `latency_ms_bucket{service="${this.config.SERVICE_NAME}",le="${bucket}"} ${this.latencyBucketCounters.get(bucket) ?? 0}`
      );
    }
    lines.push(`latency_ms_bucket{service="${this.config.SERVICE_NAME}",le="+Inf"} ${this.latencyCount}`);
    lines.push(`latency_ms_sum{service="${this.config.SERVICE_NAME}"} ${this.latencySumMs}`);
    lines.push(`latency_ms_count{service="${this.config.SERVICE_NAME}"} ${this.latencyCount}`);

    return lines.join("\n");
  }
}
