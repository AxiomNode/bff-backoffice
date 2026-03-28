import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { LeaderboardQuerySchema } from "@axiomnode/shared-sdk-client/contracts";
import { UpstreamTimeoutError, buildUrl, forwardHttp } from "@axiomnode/shared-sdk-client/proxy";
import { z } from "zod";

import type { AppConfig } from "../config.js";
import { ServiceMetrics } from "../services/serviceMetrics.js";

type ServiceKey =
  | "api-gateway"
  | "bff-backoffice"
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

const DataQuerySchema = z.object({
  dataset: z.enum(["roles", "leaderboard", "history", "processes"]),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  sortBy: z.string().optional(),
  sortDirection: z.enum(["asc", "desc"]).default("asc"),
  filter: z.string().default(""),
  metric: z.enum(["won", "score", "played"]).default("won"),
  language: z.string().default("es"),
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
  status: z.enum(["manual", "validated"]).default("manual"),
});

const DataDeleteQuerySchema = z.object({
  dataset: z.literal("history"),
});

const EntryIdParamsSchema = z.object({
  entryId: z.string().min(1),
});

type Row = Record<string, unknown>;

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

function applyRowsQuery(
  rows: Row[],
  query: z.infer<typeof DataQuerySchema>,
): { total: number; page: number; pageSize: number; rows: Row[] } {
  let nextRows = rows;

  const filterTerm = query.filter.trim().toLowerCase();
  if (filterTerm.length > 0) {
    nextRows = nextRows.filter((row) =>
      Object.values(row).some((value) => {
        if (value === null || value === undefined) {
          return false;
        }
        try {
          return JSON.stringify(value).toLowerCase().includes(filterTerm);
        } catch {
          return String(value).toLowerCase().includes(filterTerm);
        }
      }),
    );
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

function serviceBaseUrl(config: AppConfig, service: ServiceKey): string {
  switch (service) {
    case "api-gateway":
      return config.API_GATEWAY_URL ?? "http://localhost:7005";
    case "bff-backoffice":
      return `http://localhost:${config.SERVICE_PORT}`;
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
  path: string,
  request: FastifyRequest,
): Promise<unknown> {
  const headers = normalizeAuthHeaders(request);
  const target = buildUrl(serviceBaseUrl(config, service), path, {});
  const outgoingHeaders: Record<string, string> = {};
  if (headers.authorization) {
    outgoingHeaders.authorization = headers.authorization;
  }
  if (headers["x-firebase-id-token"]) {
    outgoingHeaders["x-firebase-id-token"] = headers["x-firebase-id-token"];
  }
  const serviceApiKey = resolveServiceApiKey(config, service);
  if (serviceApiKey) {
    outgoingHeaders["x-api-key"] = serviceApiKey;
  }

  const timeoutMs = config.UPSTREAM_TIMEOUT_MS ?? 15000;
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(target, {
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

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text || response.statusText}`);
  }

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { raw: text };
  }
}

async function forwardRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  targetUrl: string,
  method: "GET" | "POST" | "PATCH",
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

async function forwardDeleteRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  targetUrl: string,
  timeoutMs: number,
): Promise<void> {
  const normalizedHeaders = normalizeAuthHeaders(request);
  const outgoingHeaders = new Headers();
  for (const [key, value] of Object.entries(normalizedHeaders)) {
    if (typeof value === "string" && value.length > 0) {
      outgoingHeaders.set(key, value);
    }
  }

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(targetUrl, {
      method: "DELETE",
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

  const text = await response.text();
  reply.code(response.status);
  reply.header("content-type", response.headers.get("content-type") ?? "application/json");
  if (!text) {
    reply.send({});
    return;
  }

  try {
    reply.send(JSON.parse(text));
  } catch {
    reply.send(text);
  }
}

function isEditableGameService(service: ServiceKey): service is "microservice-quiz" | "microservice-wordpass" {
  return service === "microservice-quiz" || service === "microservice-wordpass";
}

async function readDatasetRows(
  service: ServiceKey,
  dataset: DataQueryDataset,
  query: z.infer<typeof DataQuerySchema>,
  config: AppConfig,
  request: FastifyRequest,
): Promise<Row[]> {
  if (service === "microservice-users" && dataset === "roles") {
    const payload = (await fetchJsonFromService(service, config, "/users/admin/roles", request)) as {
      users?: Array<Record<string, unknown>>;
    };
    return payload.users ?? [];
  }

  if (service === "microservice-users" && dataset === "leaderboard") {
    const path = `/users/leaderboard?metric=${encodeURIComponent(query.metric)}&limit=${query.limit}`;
    const payload = (await fetchJsonFromService(service, config, path, request)) as {
      rows?: Array<Record<string, unknown>>;
      metric?: string;
    };
    return (payload.rows ?? []).map((row, index) => ({
      rank: index + 1,
      metric: payload.metric ?? query.metric,
      ...row,
    }));
  }

  if (service === "microservice-quiz" && dataset === "history") {
    const path = `/games/history?limit=${query.limit}`;
    const payload = (await fetchJsonFromService(service, config, path, request)) as { items?: Array<Record<string, unknown>> };
    return payload.items ?? [];
  }

  if (service === "microservice-quiz" && dataset === "processes") {
    const path = `/games/generate/processes?limit=${query.limit}`;
    const payload = (await fetchJsonFromService(service, config, path, request)) as { tasks?: Array<Record<string, unknown>> };
    return payload.tasks ?? [];
  }

  if (service === "microservice-wordpass" && dataset === "history") {
    const path = `/games/history?limit=${query.limit}`;
    const payload = (await fetchJsonFromService(service, config, path, request)) as { items?: Array<Record<string, unknown>> };
    return payload.items ?? [];
  }

  if (service === "microservice-wordpass" && dataset === "processes") {
    const path = `/games/generate/processes?limit=${query.limit}`;
    const payload = (await fetchJsonFromService(service, config, path, request)) as { tasks?: Array<Record<string, unknown>> };
    return payload.tasks ?? [];
  }

  throw new Error(`Dataset '${dataset}' no soportado para ${service}`);
}

export async function backofficeRoutes(
  app: FastifyInstance,
  config: AppConfig,
  metrics?: ServiceMetrics,
): Promise<void> {
  const upstreamTimeoutMs = config.UPSTREAM_TIMEOUT_MS ?? 15000;

  const runtimeMetrics = metrics ?? {
    snapshot: () => ({ service: "bff-backoffice", note: "metrics disabled" }),
    recentLogs: (_limit: number) => [],
  };

  app.get("/v1/backoffice/services", async (_request, reply) => {
    return reply.send({
      total: SERVICE_CATALOG.length,
      services: SERVICE_CATALOG,
    });
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
    const query = LeaderboardQuerySchema.parse(request.query);
    const url = buildUrl(config.USERS_SERVICE_URL, "/users/leaderboard", query);
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

    if (service === "bff-backoffice") {
      return reply.send({ service, metrics: runtimeMetrics.snapshot() });
    }

    if (service === "ai-engine-stats") {
      const payload = await fetchJsonFromService(service, config, "/stats", request);
      return reply.send({ service, metrics: payload });
    }

    if (service === "ai-engine-api") {
      const payload = await fetchJsonFromService(service, config, "/health", request);
      return reply.send({ service, metrics: payload });
    }

    const payload = await fetchJsonFromService(service, config, "/monitor/stats", request);
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
      const payload = await fetchJsonFromService(service, config, path, request);
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
    const payload = await fetchJsonFromService(service, config, path, request);
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
        message: `Service '${service}' no soporta consultas de datos tabulares`,
      });
    }

    const rows = await readDatasetRows(service, query.dataset, query, config, request);
    const paged = applyRowsQuery(rows, query);
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
        message: `Service '${service}' no soporta catalogos de juegos`,
      });
    }

    const payload = await fetchJsonFromService(service, config, "/catalogs", request);
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
        message: `Service '${service}' no soporta insercion manual de datos`,
      });
    }

    const url = buildUrl(serviceBaseUrl(config, service), "/games/history/manual", {});
    await forwardRequest(request, reply, url, "POST", upstreamTimeoutMs, parsedPayload.data);
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
        message: `Service '${service}' no soporta borrado manual de datos`,
      });
    }

    const path = `/games/history/${encodeURIComponent(parsedParams.data.entryId)}`;
    const url = buildUrl(serviceBaseUrl(config, service), path, {});
    await forwardDeleteRequest(request, reply, url, upstreamTimeoutMs);
  });
}
