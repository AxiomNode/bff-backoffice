import { HttpServiceMetrics } from "@axiomnode/shared-sdk-client/http-service-metrics";

import type { AppConfig } from "../config.js";

/** @module serviceMetrics — In-memory metrics collection with Prometheus export for the BFF-Backoffice service (shared implementation in shared-sdk-client). */

/** Request counters, latency histogram, byte totals and log buffer for bff-mobile. */
export class ServiceMetrics extends HttpServiceMetrics {
  constructor(config: AppConfig) {
    super(config, { prometheusPrefix: "bff_backoffice" });
  }
}
