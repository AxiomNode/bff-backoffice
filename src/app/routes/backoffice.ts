import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { LeaderboardQuerySchema } from "@axiomnode/shared-sdk-client/contracts";
import {
  CircuitBreaker,
  UpstreamTimeoutError,
  buildUrl,
  forwardHttp,
} from "@axiomnode/shared-sdk-client/proxy";
import { z } from "zod";

import type { AppConfig } from "../config.js";
import { ServiceMetrics } from "../services/serviceMetrics.js";
import {
  RoutingStateStore,
  type PersistedAiEnginePreset,
  type PersistedRoutingServiceKey,
  type PersistedRoutingOverride,
} from "../services/routingStateStore.js";

/** @module backoffice — Backoffice routes for auth, users, service catalog, data CRUD, and AI diagnostics. */

type ServiceKey =
  | "api-gateway"
  | "bff-backoffice"
  | "bff-mobile"
  | "microservice-users"
  | "microservice-quiz"
  | "microservice-wordpass"
  | "ai-engine-stats"
  | "ai-engine-api";

type ConfigurableServiceTargetKey =
  | "api-gateway"
  | "bff-mobile"
  | "microservice-users"
  | "microservice-quiz"
  | "microservice-wordpass"
  | "ai-engine-stats"
  | "ai-engine-api";

type DataQueryDataset =
  | "roles"
  | "leaderboard"
  | "history"
  | "processes";

const ServiceKeySchema = z.enum([
  "api-gateway",
  "bff-backoffice",
  "bff-mobile",
  "microservice-users",
  "microservice-quiz",
  "microservice-wordpass",
  "ai-engine-stats",
  "ai-engine-api",
]);

const ConfigurableServiceTargetKeySchema = z.enum([
  "api-gateway",
  "bff-mobile",
  "microservice-users",
  "microservice-quiz",
  "microservice-wordpass",
  "ai-engine-stats",
  "ai-engine-api",
]);

const ServiceTargetOverrideSchema = z.object({
  baseUrl: z.string().trim().url(),
  label: z.string().trim().max(80).optional(),
});

const DataQuerySchema = z.object({
  dataset: z.enum(["roles", "leaderboard", "history", "processes"]),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  sortBy: z.string().optional(),
  sortDirection: z.enum(["asc", "desc"]).default("asc"),
  filter: z.string().default(""),
  metric: z.enum(["won", "score", "played"]).default("won"),
  status: z.enum(["running", "completed", "failed"]).optional(),
  requestedBy: z.enum(["api", "backoffice"]).optional(),
  language: z.string().min(2).max(5).optional(),
  categoryId: z.string().min(1).optional(),
  difficultyPercentage: z.coerce.number().int().min(0).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(500),
});

const LogsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(2000).default(200),
});

const DataMutationSchema = z.object({
  dataset: z.literal("history"),
  categoryId: z.string().min(1),
  language: z.string().min(2).max(5),
  difficultyPercentage: z.coerce.number().int().min(0).max(100),
  content: z.record(z.unknown()).refine((value) => Object.keys(value).length > 0, {
    message: "content must include at least one field",
  }),
  status: z.enum(["manual", "validated", "pending_review"]).default("manual"),
});

const DataUpdateSchema = z.object({
  dataset: z.literal("history"),
  categoryId: z.string().min(1).optional(),
  language: z.string().min(2).max(5).optional(),
  difficultyPercentage: z.coerce.number().int().min(0).max(100).optional(),
  content: z.record(z.unknown()).refine((value) => Object.keys(value).length > 0, {
    message: "content must include at least one field",
  }).optional(),
  status: z.enum(["manual", "validated", "pending_review"]).optional(),
}).refine((value) => Object.keys(value).some((key) => key !== "dataset"), {
  message: "At least one editable field is required",
});

const DataDeleteQuerySchema = z.object({
  dataset: z.literal("history"),
});

const EntryIdParamsSchema = z.object({
  entryId: z.string().min(1),
});

const GenerationProcessStartSchema = z.object({
  categoryId: z.string().min(1),
  language: z.string().min(2).max(5),
  difficultyPercentage: z.coerce.number().int().min(0).max(100).optional(),
  itemCount: z.coerce.number().int().min(1).max(50).optional(),
  numQuestions: z.coerce.number().int().min(1).max(50).optional(),
  letters: z.string().optional(),
  count: z.coerce.number().int().min(1).max(100).default(10),
});

function normalizeGenerationProcessPayload(
  payload: z.infer<typeof GenerationProcessStartSchema>,
): {
  categoryId: string;
  language: string;
  difficultyPercentage?: number;
  itemCount?: number;
  count: number;
  requestedBy: "backoffice";
} {
  const itemCount = payload.itemCount ?? payload.numQuestions;
  return {
    categoryId: payload.categoryId,
    language: payload.language,
    ...(typeof payload.difficultyPercentage === "number"
      ? { difficultyPercentage: payload.difficultyPercentage }
      : {}),
    ...(typeof itemCount === "number" ? { itemCount } : {}),
    count: payload.count,
    requestedBy: "backoffice",
  };
}

const GenerationTaskParamsSchema = z.object({
  taskId: z.string().uuid(),
});

const GenerationTaskQuerySchema = z.object({
  includeItems: z.coerce.boolean().default(false),
});

const GenerationProcessesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  status: z.enum(["running", "completed", "failed"]).optional(),
  requestedBy: z.enum(["api", "backoffice"]).optional(),
});

const AiEngineTargetSchema = z.object({
  host: z.string().trim().min(1).max(255),
  protocol: z.enum(["http", "https"]).default("http"),
  port: z.coerce.number().int().min(1).max(65535).default(7002),
  label: z.string().trim().max(80).optional(),
});

const AiEnginePresetSchema = z.object({
  name: z.string().trim().min(1).max(80),
  host: z.string().trim().min(1).max(255),
  protocol: z.enum(["http", "https"]).default("http"),
  port: z.coerce.number().int().min(1).max(65535).default(7002),
});

const AiEnginePresetIdParamsSchema = z.object({
  presetId: z.string().trim().min(1).max(120),
});

type AiEngineProbeEndpointStatus = {
  ok: boolean;
  status: number | null;
  url: string;
  latencyMs: number | null;
  message: string | null;
};

type AiEngineProbeResult = {
  host: string;
  protocol: "http" | "https";
  port: number;
  reachable: boolean;
  llama: AiEngineProbeEndpointStatus;
};

const CONFIGURABLE_SERVICE_TARGET_KEYS: ConfigurableServiceTargetKey[] = [
  "api-gateway",
  "bff-mobile",
  "microservice-users",
  "microservice-quiz",
  "microservice-wordpass",
  "ai-engine-stats",
  "ai-engine-api",
];

type Row = Record<string, unknown>;

type ServiceOperationalRowPayload = {
  key: string;
  title: string;
  domain: string;
  supportsData: boolean;
  online: boolean;
  accessGuaranteed: boolean;
  connectionError: boolean;
  requestsTotal: number | null;
  requestsPerSecond: number | null;
  generationRequestedTotal: number | null;
  generationCreatedTotal: number | null;
  generationConversionRatio: number | null;
  latencyMs: number | null;
  lastUpdatedAt: string | null;
  errorMessage: string | null;
  lastKnownError: null;
};

type ServiceOperationalSummaryPayload = {
  rows: ServiceOperationalRowPayload[];
  totals: {
    total: number;
    onlineCount: number;
    accessIssues: number;
    connectionErrors: number;
  };
};

type CachedUpstreamResponse = {
  payload: unknown;
  expiresAt: number;
};

const SERVICE_CATALOG: Array<{
  key: ServiceKey;
  title: string;
  domain: string;
  supportsData: boolean;
}> = [
  { key: "api-gateway", title: "API Gateway", domain: "edge", supportsData: false },
  { key: "bff-backoffice", title: "BFF Backoffice", domain: "edge", supportsData: false },
  { key: "bff-mobile", title: "BFF Mobile", domain: "edge", supportsData: false },
  { key: "microservice-users", title: "Microservice Users", domain: "users", supportsData: true },
  { key: "microservice-quiz", title: "Microservice Quiz", domain: "games", supportsData: true },
  { key: "microservice-wordpass", title: "Microservice Wordpass", domain: "games", supportsData: true },
  { key: "ai-engine-stats", title: "AI Engine Stats", domain: "ai", supportsData: false },
  { key: "ai-engine-api", title: "AI Engine API", domain: "ai", supportsData: false },
];

function normalizeAiEngineHost(raw: string): string {
  const trimmed = raw.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  const withoutPath = trimmed.split("/")[0] ?? "";
  const withoutPort = withoutPath.replace(/:\d+$/, "");

  if (!withoutPort || !/^[a-zA-Z0-9.-]+$/.test(withoutPort)) {
    throw new Error("host must be a valid hostname or IPv4 address");
  }

  return withoutPort;
}

function buildAiEngineBaseUrl(protocol: "http" | "https", host: string, port: number): string {
  return `${protocol}://${host}:${port}`;
}

function normalizeServiceBaseUrl(raw: string): string {
  const parsed = new URL(raw.trim());
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("baseUrl must use http or https");
  }

  if ((parsed.pathname && parsed.pathname !== "/") || parsed.search || parsed.hash) {
    throw new Error("baseUrl must not include path, query, or hash");
  }

  return parsed.origin;
}

function parseIpv4Address(host: string): number | null {
  const octets = host.split(".");
  if (octets.length !== 4) {
    return null;
  }

  const numbers = octets.map((part) => Number(part));
  if (numbers.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
    return null;
  }

  return ((numbers[0] << 24) >>> 0) + (numbers[1] << 16) + (numbers[2] << 8) + numbers[3];
}

function isIpv4InCidr(host: string, cidr: string): boolean {
  const [network, prefixRaw] = cidr.split("/");
  const ip = parseIpv4Address(host);
  const networkIp = parseIpv4Address(network ?? "");
  const prefix = Number(prefixRaw);

  if (ip === null || networkIp === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    return false;
  }

  if (prefix === 0) {
    return true;
  }

  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  return (ip & mask) === (networkIp & mask);
}

function isAllowedRoutingTargetHost(config: AppConfig, host: string): boolean {
  const policy = config.ALLOWED_ROUTING_TARGET_HOSTS?.trim();
  if (!policy) {
    return true;
  }

  const normalizedHost = host.trim().toLowerCase();
  const rules = policy
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);

  return rules.some((rule) => {
    if (rule.includes("/")) {
      return isIpv4InCidr(normalizedHost, rule);
    }

    if (rule.startsWith("*.")) {
      return normalizedHost === rule.slice(2) || normalizedHost.endsWith(rule.slice(1));
    }

    return normalizedHost === rule;
  });
}

function assertAllowedRoutingTargetHost(config: AppConfig, host: string): void {
  if (!isAllowedRoutingTargetHost(config, host)) {
    throw new Error(`host '${host}' is not allowed by ALLOWED_ROUTING_TARGET_HOSTS`);
  }
}

function parseBaseUrl(url: string): {
  host: string | null;
  protocol: "http" | "https" | null;
  port: number | null;
} {
  try {
    const parsed = new URL(url);
    const protocol = parsed.protocol === "https:" ? "https" : parsed.protocol === "http:" ? "http" : null;
    const fallbackPort = protocol === "https" ? 443 : protocol === "http" ? 80 : NaN;
    const parsedPort = parsed.port ? Number(parsed.port) : fallbackPort;

    return {
      host: parsed.hostname || null,
      protocol,
      port: Number.isFinite(parsedPort) ? parsedPort : null,
    };
  } catch {
    return {
      host: null,
      protocol: null,
      port: null,
    };
  }
}

function getAiEnginePresetPayload(preset: PersistedAiEnginePreset) {
  return {
    id: preset.id,
    name: preset.name,
    host: preset.host,
    protocol: preset.protocol,
    port: preset.port,
    updatedAt: preset.updatedAt,
  };
}

function getAiEnginePresetList(routingStore: RoutingStateStore) {
  const presets = routingStore.listAiEnginePresets().map(getAiEnginePresetPayload);
  return {
    total: presets.length,
    presets,
  };
}

function getServiceCatalogTitle(service: ServiceKey): string {
  return SERVICE_CATALOG.find((entry) => entry.key === service)?.title ?? service;
}

function getUpstreamCacheTtlMs(config: AppConfig, path: string): number {
  const normalizedPath = path.split("?", 1)[0] ?? path;

  if (normalizedPath === "/catalogs") {
    return config.UPSTREAM_CATALOGS_CACHE_TTL_MS ?? 60000;
  }

  if (
    normalizedPath === "/monitor/stats" ||
    normalizedPath === "/stats" ||
    normalizedPath === "/health" ||
    normalizedPath === "/monitor/logs" ||
    normalizedPath === "/stats/history" ||
    normalizedPath === "/diagnostics/rag/stats"
  ) {
    return config.UPSTREAM_METRICS_CACHE_TTL_MS ?? 5000;
  }

  return 0;
}

function buildUpstreamCacheKey(target: string, headers: Record<string, string>): string {
  return JSON.stringify({
    target,
    authorization: headers.authorization ?? null,
    firebaseToken: headers["x-firebase-id-token"] ?? null,
    devUid: headers["x-dev-firebase-uid"] ?? null,
    apiKey: headers["x-api-key"] ?? null,
  });
}

function getUpstreamBreaker(
  breakers: Map<string, CircuitBreaker>,
  config: AppConfig,
  target: string,
): CircuitBreaker {
  const key = new URL(target).origin;
  let breaker = breakers.get(key);
  if (!breaker) {
    breaker = new CircuitBreaker({
      failureThreshold: config.UPSTREAM_CIRCUIT_FAILURE_THRESHOLD ?? 3,
      resetTimeoutMs: config.UPSTREAM_CIRCUIT_RESET_TIMEOUT_MS ?? 30000,
    });
    breakers.set(key, breaker);
  }
  return breaker;
}

function clearUpstreamRuntimeState(
  upstreamCache: Map<string, CachedUpstreamResponse>,
  upstreamBreakers: Map<string, CircuitBreaker>,
): void {
  upstreamCache.clear();
  upstreamBreakers.clear();
}

function buildOperationalSummaryRuntimeKey(request: FastifyRequest): string {
  const headers = normalizeAuthHeaders(request);
  const summaryHeaders: Record<string, string> = {};

  if (headers.authorization) {
    summaryHeaders.authorization = headers.authorization;
  }
  if (headers["x-firebase-id-token"]) {
    summaryHeaders["x-firebase-id-token"] = headers["x-firebase-id-token"];
  }
  if (headers["x-dev-firebase-uid"]) {
    summaryHeaders["x-dev-firebase-uid"] = headers["x-dev-firebase-uid"];
  }
  if (headers["x-api-key"]) {
    summaryHeaders["x-api-key"] = headers["x-api-key"];
  }

  return buildUpstreamCacheKey("operational-summary", summaryHeaders);
}

function toRequestsTotal(metrics: unknown): number | null {
  if (!metrics || typeof metrics !== "object") {
    return null;
  }

  const payload = metrics as Record<string, unknown>;
  const traffic = payload.traffic;

  if (traffic && typeof traffic === "object") {
    const value = (traffic as Record<string, unknown>).requestsReceivedTotal;
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }

  const topLevel = payload.requestsReceivedTotal;
  if (typeof topLevel === "number" && Number.isFinite(topLevel)) {
    return topLevel;
  }

  return null;
}

function toGenerationConversion(metrics: unknown): {
  requestedTotal: number | null;
  createdTotal: number | null;
  conversionRatio: number | null;
} {
  if (!metrics || typeof metrics !== "object") {
    return { requestedTotal: null, createdTotal: null, conversionRatio: null };
  }

  const payload = metrics as Record<string, unknown>;
  const batch = payload.batch;

  if (!batch || typeof batch !== "object") {
    return { requestedTotal: null, createdTotal: null, conversionRatio: null };
  }

  const batchPayload = batch as Record<string, unknown>;
  const requestedValue = batchPayload.requestedTotal;
  const createdValue = batchPayload.createdTotal;

  const requestedTotal = typeof requestedValue === "number" && Number.isFinite(requestedValue)
    ? requestedValue
    : null;
  const createdTotal = typeof createdValue === "number" && Number.isFinite(createdValue)
    ? createdValue
    : null;

  if (requestedTotal === null || createdTotal === null || requestedTotal <= 0) {
    return { requestedTotal, createdTotal, conversionRatio: null };
  }

  return {
    requestedTotal,
    createdTotal,
    conversionRatio: Number((createdTotal / requestedTotal).toFixed(4)),
  };
}

function isAuthorizationError(message: string): boolean {
  return /HTTP\s+(401|403)/i.test(message);
}

function isConnectionError(message: string): boolean {
  return /Failed to fetch|NetworkError|timed out|timeout|HTTP\s+(5\d\d|429|408|0)/i.test(message);
}

function getEnvServiceBaseUrl(config: AppConfig, service: ConfigurableServiceTargetKey): string {
  switch (service) {
    case "api-gateway":
      return config.API_GATEWAY_URL ?? "http://localhost:7005";
    case "bff-mobile":
      return config.BFF_MOBILE_URL ?? "http://localhost:7010";
    case "microservice-users":
      return config.USERS_SERVICE_URL;
    case "microservice-quiz":
      return config.QUIZZ_SERVICE_URL ?? "http://localhost:7100";
    case "microservice-wordpass":
      return config.WORDPASS_SERVICE_URL ?? "http://localhost:7101";
    case "ai-engine-stats":
      return config.AI_ENGINE_STATS_URL ?? "http://localhost:7000";
    case "ai-engine-api":
      return config.AI_ENGINE_API_URL ?? "http://localhost:7001";
  }
}

function getServiceRuntimeTarget(config: AppConfig, routingStore: RoutingStateStore, service: ConfigurableServiceTargetKey) {
  const override = routingStore.get(service);
  if (override) {
    return {
      service,
      title: getServiceCatalogTitle(service),
      source: "override" as const,
      baseUrl: override.baseUrl,
      label: override.label ?? null,
      updatedAt: override.updatedAt,
    };
  }

  return {
    service,
    title: getServiceCatalogTitle(service),
    source: "env" as const,
    baseUrl: getEnvServiceBaseUrl(config, service),
    label: null,
    updatedAt: null,
  };
}

function getServiceRuntimeTargets(config: AppConfig, routingStore: RoutingStateStore) {
  return CONFIGURABLE_SERVICE_TARGET_KEYS.map((service) => getServiceRuntimeTarget(config, routingStore, service));
}

async function applyServiceRuntimeTarget(
  config: AppConfig,
  routingStore: RoutingStateStore,
  service: ConfigurableServiceTargetKey,
  input: z.infer<typeof ServiceTargetOverrideSchema>,
): Promise<void> {
  const normalizedBaseUrl = normalizeServiceBaseUrl(input.baseUrl);
  assertAllowedRoutingTargetHost(config, new URL(normalizedBaseUrl).hostname);

  const override: PersistedRoutingOverride = {
    baseUrl: normalizedBaseUrl,
    label: input.label?.trim() || undefined,
    updatedAt: new Date().toISOString(),
  };
  await routingStore.set(service as PersistedRoutingServiceKey, override);
}

async function resetServiceRuntimeTarget(routingStore: RoutingStateStore, service: ConfigurableServiceTargetKey): Promise<void> {
  await routingStore.delete(service as PersistedRoutingServiceKey);
}

async function saveAiEnginePreset(
  routingStore: RoutingStateStore,
  presetId: string,
  input: z.infer<typeof AiEnginePresetSchema>,
): Promise<PersistedAiEnginePreset> {
  const host = normalizeAiEngineHost(input.host);
  const preset: PersistedAiEnginePreset = {
    id: presetId,
    name: input.name.trim(),
    host,
    protocol: input.protocol,
    port: input.port,
    updatedAt: new Date().toISOString(),
  };
  await routingStore.setAiEnginePreset(preset);
  return preset;
}

async function probeAiEngineEndpoint(
  url: string,
  apiKey: string | undefined,
  timeoutMs: number,
): Promise<AiEngineProbeEndpointStatus> {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  const headers: Record<string, string> = {};

  if (apiKey) {
    headers["x-api-key"] = apiKey;
  }

  try {
    const response = await fetch(url, {
      headers,
      signal: controller.signal,
    });
    const text = await response.text();

    return {
      ok: response.ok,
      status: response.status,
      url,
      latencyMs: Date.now() - startedAt,
      message: response.ok ? null : text || response.statusText || `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      url,
      latencyMs: Date.now() - startedAt,
      message: error instanceof Error ? error.message : "Probe failed",
    };
  } finally {
    clearTimeout(timeoutHandle);
  }
}

async function probeAiEngineTarget(
  config: AppConfig,
  input: z.infer<typeof AiEngineTargetSchema>,
): Promise<AiEngineProbeResult> {
  const host = normalizeAiEngineHost(input.host);
  const llamaUrl = `${buildAiEngineBaseUrl(input.protocol, host, input.port)}/v1/models`;
  const timeoutMs = Math.min(config.UPSTREAM_TIMEOUT_MS ?? 15000, 8000);

  const llama = await probeAiEngineEndpoint(llamaUrl, undefined, timeoutMs);

  return {
    host,
    protocol: input.protocol,
    port: input.port,
    reachable: llama.ok,
    llama,
  };
}

async function getAiEngineRuntimeTarget(
  config: AppConfig,
  routingStore: RoutingStateStore,
): Promise<Record<string, unknown>> {
  const targetUrl = buildUrl(serviceBaseUrl(config, routingStore, "ai-engine-api"), "/internal/admin/llama-target", {});
  const headers: Record<string, string> = {};

  const serviceApiKey = resolveServiceApiKey(config, "ai-engine-api");
  if (serviceApiKey) {
    headers["x-api-key"] = serviceApiKey;
  }
  const response = await fetch(targetUrl, {
    method: "GET",
    headers,
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `ai-engine llama target read failed with HTTP ${response.status}`);
  }

  return response.json() as Promise<Record<string, unknown>>;
}

async function syncAiEngineLlamaTarget(
  config: AppConfig,
  routingStore: RoutingStateStore,
  method: "PUT" | "DELETE",
  body?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const targetUrl = buildUrl(serviceBaseUrl(config, routingStore, "ai-engine-api"), "/internal/admin/llama-target", {});
  const headers: Record<string, string> = {};

  const serviceApiKey = resolveServiceApiKey(config, "ai-engine-api");
  if (serviceApiKey) {
    headers["x-api-key"] = serviceApiKey;
  }
  if (body) {
    headers["content-type"] = "application/json";
  }

  const response = await fetch(targetUrl, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `ai-engine llama target sync failed with HTTP ${response.status}`);
  }

  return response.json() as Promise<Record<string, unknown>>;
}

function normalizeAuthHeaders(request: FastifyRequest): Record<string, string | undefined> {
  const idTokenHeader = request.headers["x-firebase-id-token"];
  return {
    ...(request.headers as Record<string, string | undefined>),
    authorization:
      typeof idTokenHeader === "string" && idTokenHeader.length > 0
        ? `Bearer ${idTokenHeader}`
        : request.headers.authorization,
  };
}

function toComparable(value: unknown): string | number {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    const asNumber = Number(value);
    if (Number.isFinite(asNumber) && value.trim() !== "") {
      return asNumber;
    }
    return value.toLowerCase();
  }
  try {
    return JSON.stringify(value).toLowerCase();
  } catch {
    return String(value).toLowerCase();
  }
}

function toSearchableString(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value.toLowerCase();
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value).toLowerCase();
  }

  try {
    return JSON.stringify(value).toLowerCase();
  } catch {
    return String(value).toLowerCase();
  }
}

function applyRowsQuery(
  rows: Row[],
  query: z.infer<typeof DataQuerySchema>,
): { total: number; page: number; pageSize: number; rows: Row[] } {
  let nextRows = rows;

  const filterTerm = query.filter.trim().toLowerCase();
  if (filterTerm.length > 0) {
    const searchableByRow = new Map<Row, string>();

    nextRows = nextRows.filter((row) => {
      let searchable = searchableByRow.get(row);
      if (!searchable) {
        searchable = Object.values(row)
          .map((value) => toSearchableString(value))
          .filter((value) => value.length > 0)
          .join(" ");
        searchableByRow.set(row, searchable);
      }

      return searchable.includes(filterTerm);
    });
  }

  if (query.sortBy) {
    const factor = query.sortDirection === "asc" ? 1 : -1;
    nextRows = [...nextRows].sort((left, right) => {
      const leftValue = toComparable(left[query.sortBy as string]);
      const rightValue = toComparable(right[query.sortBy as string]);

      if (typeof leftValue === "number" && typeof rightValue === "number") {
        return (leftValue - rightValue) * factor;
      }

      return String(leftValue).localeCompare(String(rightValue), "es", { sensitivity: "base" }) * factor;
    });
  }

  const total = nextRows.length;
  const start = (query.page - 1) * query.pageSize;
  const pageRows = nextRows.slice(start, start + query.pageSize);

  return {
    total,
    page: query.page,
    pageSize: query.pageSize,
    rows: pageRows,
  };
}

function serviceBaseUrl(config: AppConfig, routingStore: RoutingStateStore, service: ServiceKey): string {
  if (CONFIGURABLE_SERVICE_TARGET_KEYS.includes(service as ConfigurableServiceTargetKey)) {
    return getServiceRuntimeTarget(config, routingStore, service as ConfigurableServiceTargetKey).baseUrl;
  }

  switch (service) {
    case "bff-backoffice":
      return `http://localhost:${config.SERVICE_PORT}`;
  }

  throw new Error(`Unsupported service '${service}'`);
}

function resolveServiceApiKey(config: AppConfig, service: ServiceKey): string | undefined {
  if (service === "ai-engine-stats") {
    return config.AI_ENGINE_BRIDGE_API_KEY || config.AI_ENGINE_API_KEY;
  }

  if (service === "ai-engine-api") {
    return config.AI_ENGINE_API_KEY || config.AI_ENGINE_BRIDGE_API_KEY;
  }

  return undefined;
}

async function fetchJsonFromService(
  service: ServiceKey,
  config: AppConfig,
  routingStore: RoutingStateStore,
  path: string,
  request: FastifyRequest,
  upstreamCache: Map<string, CachedUpstreamResponse>,
  upstreamBreakers: Map<string, CircuitBreaker>,
  timeoutOverrideMs?: number,
): Promise<unknown> {
  const headers = normalizeAuthHeaders(request);
  const target = buildUrl(serviceBaseUrl(config, routingStore, service), path, {});
  const outgoingHeaders: Record<string, string> = {};
  if (headers.authorization) {
    outgoingHeaders.authorization = headers.authorization;
  }
  if (headers["x-correlation-id"]) {
    outgoingHeaders["x-correlation-id"] = headers["x-correlation-id"];
  }
  if (headers["x-firebase-id-token"]) {
    outgoingHeaders["x-firebase-id-token"] = headers["x-firebase-id-token"];
  }
  const serviceApiKey = resolveServiceApiKey(config, service);
  if (serviceApiKey) {
    outgoingHeaders["x-api-key"] = serviceApiKey;
  }

  const cacheTtlMs = getUpstreamCacheTtlMs(config, path);
  const cacheKey = buildUpstreamCacheKey(target, outgoingHeaders);
  if (cacheTtlMs > 0) {
    const cached = upstreamCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.payload;
    }
    if (cached) {
      upstreamCache.delete(cacheKey);
    }
  }

  const timeoutMs = timeoutOverrideMs ?? config.UPSTREAM_TIMEOUT_MS ?? 15000;
  const breaker = getUpstreamBreaker(upstreamBreakers, config, target);
  const response = await breaker.call(async () => {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await fetch(target, {
        headers: outgoingHeaders,
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new UpstreamTimeoutError(`Upstream request timed out after ${timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutHandle);
    }
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text || response.statusText}`);
  }

  let payload: unknown;
  if (!text) {
    payload = {};
  } else {
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      payload = { raw: text };
    }
  }

  if (cacheTtlMs > 0) {
    upstreamCache.set(cacheKey, {
      payload,
      expiresAt: Date.now() + cacheTtlMs,
    });
  }

  return payload;
}

async function fetchMetricsSnapshot(
  service: ServiceKey,
  config: AppConfig,
  routingStore: RoutingStateStore,
  request: FastifyRequest,
  runtimeMetrics: Pick<ServiceMetrics, "snapshot">,
  upstreamCache: Map<string, CachedUpstreamResponse>,
  upstreamBreakers: Map<string, CircuitBreaker>,
  timeoutOverrideMs?: number,
): Promise<unknown> {
  if (service === "bff-backoffice") {
    return runtimeMetrics.snapshot();
  }

  if (service === "ai-engine-stats") {
    return fetchJsonFromService(service, config, routingStore, "/stats", request, upstreamCache, upstreamBreakers, timeoutOverrideMs);
  }

  if (service === "ai-engine-api") {
    return fetchJsonFromService(service, config, routingStore, "/health", request, upstreamCache, upstreamBreakers, timeoutOverrideMs);
  }

  return fetchJsonFromService(service, config, routingStore, "/monitor/stats", request, upstreamCache, upstreamBreakers, timeoutOverrideMs);
}

async function forwardRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  targetUrl: string,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  timeoutMs: number,
  body?: unknown,
): Promise<void> {
  const normalizedHeaders = normalizeAuthHeaders(request);

  const result = await forwardHttp({
    targetUrl,
    method,
    requestHeaders: normalizedHeaders,
    body,
    timeoutMs,
  });

  reply.code(result.status);
  reply.header("content-type", result.contentType);
  reply.send(result.payload);
}

function isEditableGameService(service: ServiceKey): service is "microservice-quiz" | "microservice-wordpass" {
  return service === "microservice-quiz" || service === "microservice-wordpass";
}

async function readDatasetRows(
  service: ServiceKey,
  dataset: DataQueryDataset,
  query: z.infer<typeof DataQuerySchema>,
  config: AppConfig,
  routingStore: RoutingStateStore,
  request: FastifyRequest,
  upstreamCache: Map<string, CachedUpstreamResponse>,
  upstreamBreakers: Map<string, CircuitBreaker>,
): Promise<{ rows: Row[]; total?: number; page?: number; pageSize?: number }> {
  if (service === "microservice-users" && dataset === "roles") {
    const payload = (await fetchJsonFromService(
      service,
      config,
      routingStore,
      "/users/admin/roles",
      request,
      upstreamCache,
      upstreamBreakers,
    )) as {
      users?: Array<Record<string, unknown>>;
    };
    return { rows: payload.users ?? [] };
  }

  if (service === "microservice-users" && dataset === "leaderboard") {
    const path = `/users/leaderboard?metric=${encodeURIComponent(query.metric)}&limit=${query.limit}`;
    const payload = (await fetchJsonFromService(service, config, routingStore, path, request, upstreamCache, upstreamBreakers)) as {
      rows?: Array<Record<string, unknown>>;
      metric?: string;
    };
    return { rows: (payload.rows ?? []).map((row, index) => ({
      rank: index + 1,
      metric: payload.metric ?? query.metric,
      ...row,
    })) };
  }

  if (service === "microservice-quiz" && dataset === "history") {
    const params = new URLSearchParams({
      limit: String(query.limit),
      page: String(query.page),
      pageSize: String(query.pageSize),
    });
    if (query.categoryId) {
      params.set("categoryId", query.categoryId);
    }
    if (query.language) {
      params.set("language", query.language);
    }
    if (typeof query.difficultyPercentage === "number") {
      params.set("difficultyPercentage", String(query.difficultyPercentage));
    }
    if (query.status) {
      params.set("status", query.status);
    }
    const path = `/games/history?${params.toString()}`;
    const payload = (await fetchJsonFromService(service, config, routingStore, path, request, upstreamCache, upstreamBreakers)) as {
      items?: Array<Record<string, unknown>>;
      total?: number;
      page?: number;
      pageSize?: number;
    };
    return {
      rows: payload.items ?? [],
      total: payload.total,
      page: payload.page,
      pageSize: payload.pageSize,
    };
  }

  if (service === "microservice-quiz" && dataset === "processes") {
    const params = new URLSearchParams({ limit: String(query.limit) });
    if (query.status) {
      params.set("status", query.status);
    }
    if (query.requestedBy) {
      params.set("requestedBy", query.requestedBy);
    }
    const path = `/games/generate/processes?${params.toString()}`;
    const payload = (await fetchJsonFromService(service, config, routingStore, path, request, upstreamCache, upstreamBreakers)) as { tasks?: Array<Record<string, unknown>> };
    return { rows: payload.tasks ?? [] };
  }

  if (service === "microservice-wordpass" && dataset === "history") {
    const params = new URLSearchParams({
      limit: String(query.limit),
      page: String(query.page),
      pageSize: String(query.pageSize),
    });
    if (query.categoryId) {
      params.set("categoryId", query.categoryId);
    }
    if (query.language) {
      params.set("language", query.language);
    }
    if (typeof query.difficultyPercentage === "number") {
      params.set("difficultyPercentage", String(query.difficultyPercentage));
    }
    if (query.status) {
      params.set("status", query.status);
    }
    const path = `/games/history?${params.toString()}`;
    const payload = (await fetchJsonFromService(service, config, routingStore, path, request, upstreamCache, upstreamBreakers)) as {
      items?: Array<Record<string, unknown>>;
      total?: number;
      page?: number;
      pageSize?: number;
    };
    return {
      rows: payload.items ?? [],
      total: payload.total,
      page: payload.page,
      pageSize: payload.pageSize,
    };
  }

  if (service === "microservice-wordpass" && dataset === "processes") {
    const params = new URLSearchParams({ limit: String(query.limit) });
    if (query.status) {
      params.set("status", query.status);
    }
    if (query.requestedBy) {
      params.set("requestedBy", query.requestedBy);
    }
    const path = `/games/generate/processes?${params.toString()}`;
    const payload = (await fetchJsonFromService(service, config, routingStore, path, request, upstreamCache, upstreamBreakers)) as { tasks?: Array<Record<string, unknown>> };
    return { rows: payload.tasks ?? [] };
  }

  throw new Error(`Dataset '${dataset}' not supported for ${service}`);
}

/** Registers all backoffice API routes (auth, users, services, data, generation, AI diagnostics). */
export async function backofficeRoutes(
  app: FastifyInstance,
  config: AppConfig,
  metrics?: ServiceMetrics,
): Promise<void> {
  const upstreamTimeoutMs = config.UPSTREAM_TIMEOUT_MS ?? 15000;
  const routingStore = new RoutingStateStore(config);
  await routingStore.load();

  const runtimeMetrics = metrics ?? {
    snapshot: () => ({
      service: "bff-backoffice",
      uptimeSeconds: 0,
      traffic: {
        requestsReceivedTotal: 0,
        errorsTotal: 0,
        inflightRequests: 0,
        latencyCount: 0,
        latencyAvgMs: 0,
        requestBytesInTotal: 0,
        responseBytesOutTotal: 0,
      },
      requestsByRoute: [],
    }),
    recentLogs: () => [],
  };
  const operationalSummaryBaseline: Record<string, { requestsTotal: number | null; fetchedAt: number }> = {};
  const upstreamCache = new Map<string, CachedUpstreamResponse>();
  const upstreamBreakers = new Map<string, CircuitBreaker>();
  const operationalSummaryRequests = new Map<string, Promise<ServiceOperationalSummaryPayload>>();
  const operationalSummaryTimeoutMs = Math.min(
    config.UPSTREAM_OPERATIONAL_SUMMARY_TIMEOUT_MS ?? 3000,
    config.UPSTREAM_TIMEOUT_MS ?? 15000,
  );

  app.get("/v1/backoffice/services", async (_request, reply) => {
    return reply.send({
      total: SERVICE_CATALOG.length,
      services: SERVICE_CATALOG,
    });
  });

  app.get("/v1/backoffice/services/operational-summary", async (request, reply) => {
    const runtimeKey = buildOperationalSummaryRuntimeKey(request);
    const existingRequest = operationalSummaryRequests.get(runtimeKey);
    if (existingRequest) {
      return reply.send(await existingRequest);
    }

    const summaryRequest = (async (): Promise<ServiceOperationalSummaryPayload> => {
      const now = Date.now();
      const rows = await Promise.all(
        SERVICE_CATALOG.map(async (service): Promise<ServiceOperationalRowPayload> => {
          const startedAt = Date.now();

          try {
            const metricsPayload = await fetchMetricsSnapshot(
              service.key,
              config,
              routingStore,
              request,
              runtimeMetrics,
              upstreamCache,
              upstreamBreakers,
              operationalSummaryTimeoutMs,
            );
            const latencyMs = Math.max(0, Date.now() - startedAt);
            const requestsTotal = toRequestsTotal(metricsPayload);
            const conversion = toGenerationConversion(metricsPayload);
            const previous = operationalSummaryBaseline[service.key];
            let requestsPerSecond: number | null = null;

            if (
              previous &&
              previous.requestsTotal !== null &&
              requestsTotal !== null &&
              now > previous.fetchedAt &&
              requestsTotal >= previous.requestsTotal
            ) {
              const deltaRequests = requestsTotal - previous.requestsTotal;
              const deltaSeconds = (now - previous.fetchedAt) / 1000;
              if (deltaSeconds > 0) {
                requestsPerSecond = Number((deltaRequests / deltaSeconds).toFixed(2));
              }
            }

            operationalSummaryBaseline[service.key] = {
              requestsTotal,
              fetchedAt: now,
            };

            return {
              key: service.key,
              title: service.title,
              domain: service.domain,
              supportsData: service.supportsData,
              online: true,
              accessGuaranteed: true,
              connectionError: false,
              requestsTotal,
              requestsPerSecond,
              generationRequestedTotal: conversion.requestedTotal,
              generationCreatedTotal: conversion.createdTotal,
              generationConversionRatio: conversion.conversionRatio,
              latencyMs,
              lastUpdatedAt: new Date(now).toISOString(),
              errorMessage: null,
              lastKnownError: null,
            };
          } catch (error) {
            const message = error instanceof Error ? error.message : "Unknown error";
            return {
              key: service.key,
              title: service.title,
              domain: service.domain,
              supportsData: service.supportsData,
              online: false,
              accessGuaranteed: !isAuthorizationError(message),
              connectionError: isConnectionError(message),
              requestsTotal: null,
              requestsPerSecond: null,
              generationRequestedTotal: null,
              generationCreatedTotal: null,
              generationConversionRatio: null,
              latencyMs: Math.max(0, Date.now() - startedAt),
              lastUpdatedAt: new Date(now).toISOString(),
              errorMessage: message,
              lastKnownError: null,
            };
          }
        }),
      );

      return {
        rows,
        totals: {
          total: rows.length,
          onlineCount: rows.filter((row) => row.online).length,
          accessIssues: rows.filter((row) => !row.accessGuaranteed).length,
          connectionErrors: rows.filter((row) => row.connectionError).length,
        },
      };
    })();

    operationalSummaryRequests.set(runtimeKey, summaryRequest);

    try {
      return reply.send(await summaryRequest);
    } finally {
      operationalSummaryRequests.delete(runtimeKey);
    }
  });

  app.get("/v1/backoffice/service-targets", async (_request, reply) => {
    const targets = getServiceRuntimeTargets(config, routingStore);
    return reply.send({
      total: targets.length,
      targets,
    });
  });

  app.get("/v1/backoffice/service-targets/:service", async (request, reply) => {
    const parsed = ConfigurableServiceTargetKeySchema.safeParse((request.params as { service?: string } | undefined)?.service);
    if (!parsed.success) {
      return reply.status(400).send({ message: "Invalid configurable service" });
    }

    return reply.send(getServiceRuntimeTarget(config, routingStore, parsed.data));
  });

  app.put("/v1/backoffice/service-targets/:service", async (request, reply) => {
    const parsedService = ConfigurableServiceTargetKeySchema.safeParse((request.params as { service?: string } | undefined)?.service);
    if (!parsedService.success) {
      return reply.status(400).send({ message: "Invalid configurable service" });
    }

    const parsedPayload = ServiceTargetOverrideSchema.safeParse(request.body ?? {});
    if (!parsedPayload.success) {
      return reply.status(400).send({
        message: "Invalid payload",
        errors: parsedPayload.error.flatten(),
      });
    }

    try {
      await applyServiceRuntimeTarget(config, routingStore, parsedService.data, parsedPayload.data);
      clearUpstreamRuntimeState(upstreamCache, upstreamBreakers);
      return reply.send(getServiceRuntimeTarget(config, routingStore, parsedService.data));
    } catch (error) {
      return reply.status(400).send({
        message: error instanceof Error ? error.message : "Invalid service target",
      });
    }
  });

  app.delete("/v1/backoffice/service-targets/:service", async (request, reply) => {
    const parsed = ConfigurableServiceTargetKeySchema.safeParse((request.params as { service?: string } | undefined)?.service);
    if (!parsed.success) {
      return reply.status(400).send({ message: "Invalid configurable service" });
    }

    await resetServiceRuntimeTarget(routingStore, parsed.data);
    clearUpstreamRuntimeState(upstreamCache, upstreamBreakers);
    return reply.send(getServiceRuntimeTarget(config, routingStore, parsed.data));
  });

  app.get("/v1/backoffice/ai-engine/target", async (_request, reply) => {
    return reply.send(await getAiEngineRuntimeTarget(config, routingStore));
  });

  app.get("/v1/backoffice/ai-engine/presets", async (_request, reply) => {
    return reply.send(getAiEnginePresetList(routingStore));
  });

  app.post("/v1/backoffice/ai-engine/probe", async (request, reply) => {
    const parsed = AiEngineTargetSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        message: "Invalid payload",
        errors: parsed.error.flatten(),
      });
    }

    try {
      const result = await probeAiEngineTarget(config, parsed.data);
      return reply.send(result);
    } catch (error) {
      return reply.status(400).send({
        message: error instanceof Error ? error.message : "Invalid ai-engine target",
      });
    }
  });

  app.post("/v1/backoffice/ai-engine/presets", async (request, reply) => {
    const parsed = AiEnginePresetSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        message: "Invalid payload",
        errors: parsed.error.flatten(),
      });
    }

    try {
      const preset = await saveAiEnginePreset(routingStore, randomUUID(), parsed.data);
      return reply.status(201).send(getAiEnginePresetPayload(preset));
    } catch (error) {
      return reply.status(400).send({
        message: error instanceof Error ? error.message : "Invalid ai-engine preset",
      });
    }
  });

  app.put("/v1/backoffice/ai-engine/presets/:presetId", async (request, reply) => {
    const parsedParams = AiEnginePresetIdParamsSchema.safeParse(request.params ?? {});
    if (!parsedParams.success) {
      return reply.status(400).send({ message: "Invalid preset id" });
    }

    const parsedBody = AiEnginePresetSchema.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      return reply.status(400).send({
        message: "Invalid payload",
        errors: parsedBody.error.flatten(),
      });
    }

    const exists = routingStore.listAiEnginePresets().some((entry) => entry.id === parsedParams.data.presetId);
    if (!exists) {
      return reply.status(404).send({ message: "Preset not found" });
    }

    try {
      const preset = await saveAiEnginePreset(routingStore, parsedParams.data.presetId, parsedBody.data);
      return reply.send(getAiEnginePresetPayload(preset));
    } catch (error) {
      return reply.status(400).send({
        message: error instanceof Error ? error.message : "Invalid ai-engine preset",
      });
    }
  });

  app.delete("/v1/backoffice/ai-engine/presets/:presetId", async (request, reply) => {
    const parsedParams = AiEnginePresetIdParamsSchema.safeParse(request.params ?? {});
    if (!parsedParams.success) {
      return reply.status(400).send({ message: "Invalid preset id" });
    }

    const deleted = await routingStore.deleteAiEnginePreset(parsedParams.data.presetId);
    if (!deleted) {
      return reply.status(404).send({ message: "Preset not found" });
    }

    return reply.send({ deleted: true, presetId: parsedParams.data.presetId });
  });

  app.put("/v1/backoffice/ai-engine/target", async (request, reply) => {
    const parsed = AiEngineTargetSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        message: "Invalid payload",
        errors: parsed.error.flatten(),
      });
    }

    try {
      await syncAiEngineLlamaTarget(config, routingStore, "PUT", parsed.data as Record<string, unknown>);
      clearUpstreamRuntimeState(upstreamCache, upstreamBreakers);
      return reply.send(await getAiEngineRuntimeTarget(config, routingStore));
    } catch (error) {
      return reply.status(400).send({
        message: error instanceof Error ? error.message : "Invalid ai-engine target",
      });
    }
  });

  app.delete("/v1/backoffice/ai-engine/target", async (_request, reply) => {
    try {
      await syncAiEngineLlamaTarget(config, routingStore, "DELETE");
      clearUpstreamRuntimeState(upstreamCache, upstreamBreakers);
      return reply.send(await getAiEngineRuntimeTarget(config, routingStore));
    } catch (error) {
      return reply.status(400).send({
        message: error instanceof Error ? error.message : "Unable to reset ai-engine target",
      });
    }
  });

  app.post("/v1/backoffice/auth/session", async (request, reply) => {
    const url = buildUrl(config.USERS_SERVICE_URL, "/users/firebase/session", {});
    await forwardRequest(request, reply, url, "POST", upstreamTimeoutMs, request.body);
  });

  app.get("/v1/backoffice/auth/me", async (request, reply) => {
    const url = buildUrl(config.USERS_SERVICE_URL, "/users/me/profile", {});
    await forwardRequest(request, reply, url, "GET", upstreamTimeoutMs);
  });

  app.get("/v1/backoffice/users/leaderboard", async (request, reply) => {
    const query = LeaderboardQuerySchema.safeParse(request.query ?? {});
    if (!query.success) {
      return reply.status(400).send({
        message: "Invalid query parameters",
        errors: query.error.flatten(),
      });
    }

    const url = buildUrl(config.USERS_SERVICE_URL, "/users/leaderboard", query.data);
    await forwardRequest(request, reply, url, "GET", upstreamTimeoutMs);
  });

  app.get("/v1/backoffice/monitor/stats", async (request, reply) => {
    const url = buildUrl(config.USERS_SERVICE_URL, "/monitor/stats", request.query as Record<string, unknown>);
    await forwardRequest(request, reply, url, "GET", upstreamTimeoutMs);
  });

  app.post("/v1/backoffice/users/events/manual", async (request, reply) => {
    const url = buildUrl(config.USERS_SERVICE_URL, "/users/me/games/events", {});
    await forwardRequest(request, reply, url, "POST", upstreamTimeoutMs, request.body);
  });

  app.get("/v1/backoffice/admin/users/roles", async (request, reply) => {
    const url = buildUrl(config.USERS_SERVICE_URL, "/users/admin/roles", {});
    await forwardRequest(request, reply, url, "GET", upstreamTimeoutMs);
  });

  app.patch("/v1/backoffice/admin/users/roles/:firebaseUid", async (request, reply) => {
    const params = request.params as { firebaseUid: string };
    const url = buildUrl(
      config.USERS_SERVICE_URL,
      `/users/admin/roles/${encodeURIComponent(params.firebaseUid)}`,
      {},
    );
    await forwardRequest(request, reply, url, "PATCH", upstreamTimeoutMs, request.body);
  });

  app.get("/v1/backoffice/services/:service/metrics", async (request, reply) => {
    const parsed = ServiceKeySchema.safeParse((request.params as { service?: string } | undefined)?.service);
    if (!parsed.success) {
      return reply.status(400).send({ message: "Invalid service" });
    }

    const service = parsed.data;
    const payload = await fetchMetricsSnapshot(
      service,
      config,
      routingStore,
      request,
      runtimeMetrics,
      upstreamCache,
      upstreamBreakers,
    );
    return reply.send({ service, metrics: payload });
  });

  app.get("/v1/backoffice/services/:service/logs", async (request, reply) => {
    const parsedService = ServiceKeySchema.safeParse((request.params as { service?: string } | undefined)?.service);
    if (!parsedService.success) {
      return reply.status(400).send({ message: "Invalid service" });
    }

    const parsedLogs = LogsQuerySchema.safeParse(request.query ?? {});
    if (!parsedLogs.success) {
      return reply.status(400).send({
        message: "Invalid query parameters",
        errors: parsedLogs.error.flatten(),
      });
    }

    const service = parsedService.data;
    const limit = parsedLogs.data.limit;

    if (service === "bff-backoffice") {
      return reply.send({
        service,
        total: Math.min(limit, runtimeMetrics.recentLogs(limit).length),
        logs: runtimeMetrics.recentLogs(limit),
      });
    }

    if (service === "ai-engine-stats") {
      const path = `/stats/history?limit=${limit}`;
      const payload = await fetchJsonFromService(service, config, routingStore, path, request, upstreamCache, upstreamBreakers);
      return reply.send({ service, logs: payload });
    }

    if (service === "ai-engine-api") {
      return reply.send({
        service,
        total: 0,
        logs: [],
        note: "ai-engine-api no expone logs HTTP directos; usa ai-engine-stats para historial operativo.",
      });
    }

    const path = `/monitor/logs?limit=${limit}`;
    const payload = await fetchJsonFromService(service, config, routingStore, path, request, upstreamCache, upstreamBreakers);
    return reply.send({ service, logs: payload });
  });

  app.get("/v1/backoffice/services/:service/data", async (request, reply) => {
    const parsedService = ServiceKeySchema.safeParse((request.params as { service?: string } | undefined)?.service);
    if (!parsedService.success) {
      return reply.status(400).send({ message: "Invalid service" });
    }

    const parsedQuery = DataQuerySchema.safeParse(request.query ?? {});
    if (!parsedQuery.success) {
      return reply.status(400).send({
        message: "Invalid query parameters",
        errors: parsedQuery.error.flatten(),
      });
    }

    const service = parsedService.data;
    const query = parsedQuery.data;

    if (!["microservice-users", "microservice-quiz", "microservice-wordpass"].includes(service)) {
      return reply.status(400).send({
        message: `Service '${service}' does not support tabular data queries`,
      });
    }

    const dataResult = await readDatasetRows(
      service,
      query.dataset,
      query,
      config,
      routingStore,
      request,
      upstreamCache,
      upstreamBreakers,
    );
    const canUseUpstreamPaging =
      query.dataset === "history" &&
      query.filter.trim().length === 0 &&
      !query.sortBy &&
      typeof dataResult.total === "number" &&
      typeof dataResult.page === "number" &&
      typeof dataResult.pageSize === "number";

    const paged = canUseUpstreamPaging
      ? {
          total: dataResult.total as number,
          page: dataResult.page as number,
          pageSize: dataResult.pageSize as number,
          rows: dataResult.rows,
        }
      : applyRowsQuery(dataResult.rows, query);
    return reply.send({
      service,
      dataset: query.dataset,
      filter: query.filter,
      sortBy: query.sortBy,
      sortDirection: query.sortDirection,
      total: paged.total,
      page: paged.page,
      pageSize: paged.pageSize,
      rows: paged.rows,
    });
  });

  app.get("/v1/backoffice/services/:service/catalogs", async (request, reply) => {
    const parsedService = ServiceKeySchema.safeParse((request.params as { service?: string } | undefined)?.service);
    if (!parsedService.success) {
      return reply.status(400).send({ message: "Invalid service" });
    }

    const service = parsedService.data;
    if (!isEditableGameService(service)) {
      return reply.status(400).send({
        message: `Service '${service}' does not support game catalogs`,
      });
    }

    const payload = await fetchJsonFromService(service, config, routingStore, "/catalogs", request, upstreamCache, upstreamBreakers);
    return reply.send({
      service,
      catalogs: payload,
    });
  });

  app.post("/v1/backoffice/services/:service/data", async (request, reply) => {
    const parsedService = ServiceKeySchema.safeParse((request.params as { service?: string } | undefined)?.service);
    if (!parsedService.success) {
      return reply.status(400).send({ message: "Invalid service" });
    }

    const parsedPayload = DataMutationSchema.safeParse(request.body ?? {});
    if (!parsedPayload.success) {
      return reply.status(400).send({
        message: "Invalid payload",
        errors: parsedPayload.error.flatten(),
      });
    }

    const service = parsedService.data;
    if (!isEditableGameService(service)) {
      return reply.status(400).send({
        message: `Service '${service}' does not support manual data insertion`,
      });
    }

    const url = buildUrl(serviceBaseUrl(config, routingStore, service), "/games/history/manual", {});
    await forwardRequest(request, reply, url, "POST", upstreamTimeoutMs, parsedPayload.data);
  });

  app.patch("/v1/backoffice/services/:service/data/:entryId", async (request, reply) => {
    const parsedService = ServiceKeySchema.safeParse((request.params as { service?: string } | undefined)?.service);
    if (!parsedService.success) {
      return reply.status(400).send({ message: "Invalid service" });
    }

    const parsedParams = EntryIdParamsSchema.safeParse(request.params ?? {});
    if (!parsedParams.success) {
      return reply.status(400).send({
        message: "Invalid path parameters",
        errors: parsedParams.error.flatten(),
      });
    }

    const parsedPayload = DataUpdateSchema.safeParse(request.body ?? {});
    if (!parsedPayload.success) {
      return reply.status(400).send({
        message: "Invalid payload",
        errors: parsedPayload.error.flatten(),
      });
    }

    const service = parsedService.data;
    if (!isEditableGameService(service)) {
      return reply.status(400).send({
        message: `Service '${service}' does not support manual data updates`,
      });
    }

    const path = `/games/history/${encodeURIComponent(parsedParams.data.entryId)}`;
    const url = buildUrl(serviceBaseUrl(config, routingStore, service), path, {});
    await forwardRequest(request, reply, url, "PATCH", upstreamTimeoutMs, parsedPayload.data);
  });

  app.post("/v1/backoffice/services/:service/generation/process", async (request, reply) => {
    const parsedService = ServiceKeySchema.safeParse((request.params as { service?: string } | undefined)?.service);
    if (!parsedService.success) {
      return reply.status(400).send({ message: "Invalid service" });
    }

    const parsedPayload = GenerationProcessStartSchema.safeParse(request.body ?? {});
    if (!parsedPayload.success) {
      return reply.status(400).send({
        message: "Invalid payload",
        errors: parsedPayload.error.flatten(),
      });
    }

    const service = parsedService.data;
    if (!isEditableGameService(service)) {
      return reply.status(400).send({
        message: `Service '${service}' does not support game generation`,
      });
    }

    const url = buildUrl(serviceBaseUrl(config, routingStore, service), "/games/generate/process", {});
    await forwardRequest(request, reply, url, "POST", upstreamTimeoutMs, normalizeGenerationProcessPayload(parsedPayload.data));
  });

  app.post("/v1/backoffice/services/:service/generation/wait", async (request, reply) => {
    const parsedService = ServiceKeySchema.safeParse((request.params as { service?: string } | undefined)?.service);
    if (!parsedService.success) {
      return reply.status(400).send({ message: "Invalid service" });
    }

    const parsedPayload = GenerationProcessStartSchema.safeParse(request.body ?? {});
    if (!parsedPayload.success) {
      return reply.status(400).send({
        message: "Invalid payload",
        errors: parsedPayload.error.flatten(),
      });
    }

    const service = parsedService.data;
    if (!isEditableGameService(service)) {
      return reply.status(400).send({
        message: `Service '${service}' does not support game generation`,
      });
    }

    const url = buildUrl(serviceBaseUrl(config, routingStore, service), "/games/generate/process/wait", {});
    await forwardRequest(request, reply, url, "POST", upstreamTimeoutMs, normalizeGenerationProcessPayload(parsedPayload.data));
  });

  app.get("/v1/backoffice/services/:service/generation/processes", async (request, reply) => {
    const parsedService = ServiceKeySchema.safeParse((request.params as { service?: string } | undefined)?.service);
    if (!parsedService.success) {
      return reply.status(400).send({ message: "Invalid service" });
    }

    const parsedQuery = GenerationProcessesQuerySchema.safeParse(request.query ?? {});
    if (!parsedQuery.success) {
      return reply.status(400).send({
        message: "Invalid query parameters",
        errors: parsedQuery.error.flatten(),
      });
    }

    const service = parsedService.data;
    if (!isEditableGameService(service)) {
      return reply.status(400).send({
        message: `Service '${service}' does not support game generation`,
      });
    }

    const query = new URLSearchParams();
    query.set("limit", String(parsedQuery.data.limit));
    if (parsedQuery.data.status) {
      query.set("status", parsedQuery.data.status);
    }
    if (parsedQuery.data.requestedBy) {
      query.set("requestedBy", parsedQuery.data.requestedBy);
    }

    const path = `/games/generate/processes?${query.toString()}`;
    const payload = await fetchJsonFromService(service, config, routingStore, path, request, upstreamCache, upstreamBreakers);
    return reply.send(payload);
  });

  app.get("/v1/backoffice/services/:service/generation/process/:taskId", async (request, reply) => {
    const parsedService = ServiceKeySchema.safeParse((request.params as { service?: string } | undefined)?.service);
    if (!parsedService.success) {
      return reply.status(400).send({ message: "Invalid service" });
    }

    const parsedParams = GenerationTaskParamsSchema.safeParse(request.params ?? {});
    if (!parsedParams.success) {
      return reply.status(400).send({
        message: "Invalid path parameters",
        errors: parsedParams.error.flatten(),
      });
    }

    const parsedQuery = GenerationTaskQuerySchema.safeParse(request.query ?? {});
    if (!parsedQuery.success) {
      return reply.status(400).send({
        message: "Invalid query parameters",
        errors: parsedQuery.error.flatten(),
      });
    }

    const service = parsedService.data;
    if (!isEditableGameService(service)) {
      return reply.status(400).send({
        message: `Service '${service}' does not support game generation`,
      });
    }

    const path = `/games/generate/process/${encodeURIComponent(parsedParams.data.taskId)}?includeItems=${parsedQuery.data.includeItems}`;
    const payload = await fetchJsonFromService(service, config, routingStore, path, request, upstreamCache, upstreamBreakers);
    return reply.send(payload);
  });

  app.delete("/v1/backoffice/services/:service/data/:entryId", async (request, reply) => {
    const parsedService = ServiceKeySchema.safeParse((request.params as { service?: string } | undefined)?.service);
    if (!parsedService.success) {
      return reply.status(400).send({ message: "Invalid service" });
    }

    const parsedParams = EntryIdParamsSchema.safeParse(request.params ?? {});
    if (!parsedParams.success) {
      return reply.status(400).send({
        message: "Invalid path parameters",
        errors: parsedParams.error.flatten(),
      });
    }

    const parsedQuery = DataDeleteQuerySchema.safeParse(request.query ?? {});
    if (!parsedQuery.success) {
      return reply.status(400).send({
        message: "Invalid query parameters",
        errors: parsedQuery.error.flatten(),
      });
    }

    const service = parsedService.data;
    if (!isEditableGameService(service)) {
      return reply.status(400).send({
        message: `Service '${service}' does not support manual data deletion`,
      });
    }

    const path = `/games/history/${encodeURIComponent(parsedParams.data.entryId)}`;
    const url = buildUrl(serviceBaseUrl(config, routingStore, service), path, {});
    await forwardRequest(request, reply, url, "DELETE", upstreamTimeoutMs);
  });

  // ------------------------------------------------------------------
  // AI Engine Diagnostics — proxy to ai-engine-api /diagnostics/*
  // ------------------------------------------------------------------

  app.get("/v1/backoffice/ai-diagnostics/rag/stats", async (request, reply) => {
    try {
      const payload = await fetchJsonFromService(
        "ai-engine-api",
        config,
        routingStore,
        "/diagnostics/rag/stats",
        request,
        upstreamCache,
        upstreamBreakers,
      );
      return reply.send(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return reply.status(502).send({ message: `ai-engine-api unreachable: ${message}` });
    }
  });

  app.post("/v1/backoffice/ai-diagnostics/tests/run", async (request, reply) => {
    try {
      const url = buildUrl(serviceBaseUrl(config, routingStore, "ai-engine-api"), "/diagnostics/tests/run", {});
      await forwardRequest(request, reply, url, "POST", upstreamTimeoutMs);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return reply.status(502).send({ message: `ai-engine-api unreachable: ${message}` });
    }
  });

  app.get("/v1/backoffice/ai-diagnostics/tests/status", async (request, reply) => {
    try {
      const payload = await fetchJsonFromService(
        "ai-engine-api",
        config,
        routingStore,
        "/diagnostics/tests/status",
        request,
        upstreamCache,
        upstreamBreakers,
      );
      return reply.send(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return reply.status(502).send({ message: `ai-engine-api unreachable: ${message}` });
    }
  });
}
