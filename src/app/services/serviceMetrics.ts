import type { AppConfig } from "../config.js";

type LogLevel = "info" | "warn" | "error";

type LogEvent = {
  ts: string;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
};

export class ServiceMetrics {
  private readonly startedAt = Date.now();
  private readonly routeCounters = new Map<string, number>();
  private readonly logs: LogEvent[] = [];

  private requestsReceivedTotal = 0;
  private requestBytesInTotal = 0;
  private responseBytesOutTotal = 0;

  constructor(private readonly config: AppConfig) {}

  recordIncomingRequest(metric: {
    method: string;
    route: string;
    statusCode: number;
    requestBytes: number;
    responseBytes: number;
  }): void {
    this.requestsReceivedTotal += 1;
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

    return lines.join("\n");
  }
}
