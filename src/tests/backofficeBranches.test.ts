import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import Fastify, { type FastifyInstance } from "fastify";

vi.mock("../app/services/kubernetesObservability.js", () => ({
  fetchKubernetesOverview: vi.fn(),
}));

import { backofficeRoutes } from "../app/routes/backoffice.js";
import type { AppConfig } from "../app/config.js";

const USERS = "http://users:7102";
const QUIZ = "http://quiz:7100";
const WORDPASS = "http://wordpass:7101";
const AI_API = "http://ai-api:7001";
const AI_STATS = "http://ai-stats:7000";

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response> | undefined;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

let stateDir = "";
let app: FastifyInstance;
const apps: FastifyInstance[] = [];

function baseConfig(overrides: Record<string, unknown> = {}): AppConfig {
  return {
    SERVICE_NAME: "bff-backoffice",
    SERVICE_PORT: 7011,
    ALLOWED_ORIGINS: "http://localhost:3000",
    USERS_SERVICE_URL: USERS,
    QUIZZ_SERVICE_URL: QUIZ,
    WORDPASS_SERVICE_URL: WORDPASS,
    AI_ENGINE_API_URL: AI_API,
    AI_ENGINE_STATS_URL: AI_STATS,
    UPSTREAM_METRICS_CACHE_TTL_MS: 0,
    BACKOFFICE_ROUTING_STATE_FILE: path.join(stateDir, "routing-state.json"),
    ...overrides,
  } as unknown as AppConfig;
}

/** Stubs global fetch with a router: first handler returning a Response wins, otherwise 404. */
function stubFetch(...handlers: Handler[]) {
  const mock = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    for (const handler of handlers) {
      const result = handler(url, init);
      if (result) {
        return result;
      }
    }
    return new Response("not found", { status: 404 });
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

async function boot(overrides: Record<string, unknown> = {}): Promise<FastifyInstance> {
  app = Fastify();
  apps.push(app);
  await backofficeRoutes(app, baseConfig(overrides));
  return app;
}

beforeEach(async () => {
  stateDir = await mkdtemp(path.join(os.tmpdir(), "axiomnode-bff-branches-"));
});

afterEach(async () => {
  vi.unstubAllGlobals();
  while (apps.length > 0) {
    await apps.pop()?.close();
  }
  await rm(stateDir, { recursive: true, force: true });
});

describe("operational summary", () => {
  it("derives requests per second from consecutive snapshots and ignores counter resets", async () => {
    let usersTotal = 10;
    let aiStatsTotal = 5;
    let gatewayTotal = 50;
    stubFetch((url) => {
      if (url === `${USERS}/monitor/stats`) return json({ traffic: { requestsReceivedTotal: usersTotal } });
      // top-level counter (no "traffic" block) is also accepted
      if (url === `${AI_STATS}/stats`) return json({ requestsReceivedTotal: aiStatsTotal });
      if (url === "http://localhost:7005/monitor/stats") return json({ traffic: { requestsReceivedTotal: gatewayTotal } });
      return json({});
    });
    await boot();

    const first = await app.inject({ method: "GET", url: "/v1/backoffice/services/operational-summary" });
    expect(first.statusCode).toBe(200);
    const firstRows = Object.fromEntries(
      (first.json().rows as Array<{ key: string }>).map((row) => [row.key, row]),
    );
    expect(firstRows["microservice-users"]).toMatchObject({ requestsTotal: 10, requestsPerSecond: null, online: true });
    expect(firstRows["ai-engine-stats"]).toMatchObject({ requestsTotal: 5, requestsPerSecond: null });
    // services whose payload has no counter report null instead of 0
    expect(firstRows["microservice-quiz"]).toMatchObject({ requestsTotal: null, requestsPerSecond: null, online: true });

    await new Promise((resolve) => setTimeout(resolve, 25));
    usersTotal = 30;
    aiStatsTotal = 9;
    gatewayTotal = 10; // counter went backwards (restart): no rate must be reported

    const second = await app.inject({ method: "GET", url: "/v1/backoffice/services/operational-summary" });
    const secondRows = Object.fromEntries(
      (second.json().rows as Array<{ key: string; requestsTotal: number; requestsPerSecond: number | null }>).map((row) => [row.key, row]),
    );
    expect(secondRows["microservice-users"].requestsTotal).toBe(30);
    expect(secondRows["microservice-users"].requestsPerSecond).toBeGreaterThan(0);
    expect(secondRows["ai-engine-stats"].requestsPerSecond).toBeGreaterThan(0);
    expect(secondRows["api-gateway"]).toMatchObject({ requestsTotal: 10, requestsPerSecond: null });
  });

  it("classifies upstream failures and tolerates malformed metrics payloads", async () => {
    stubFetch((url) => {
      if (url === `${USERS}/monitor/stats`) return new Response("boom", { status: 500, statusText: "Server Error" });
      if (url === `${QUIZ}/monitor/stats`) return Promise.reject("socket closed");
      if (url === `${WORDPASS}/monitor/stats`) return new Response("denied", { status: 401 });
      // a JSON null payload and non-object batch payloads must not crash the summary
      if (url === "http://localhost:7010/monitor/stats") return new Response("null", { status: 200 });
      if (url === "http://localhost:7005/monitor/stats") return json({ batch: "nope" });
      if (url === `${AI_STATS}/stats`) return json({ batch: { requestedTotal: "x", createdTotal: 3 } });
      if (url === `${AI_API}/health`) return json({ batch: { requestedTotal: 4, createdTotal: 2 } });
      return undefined;
    });
    await boot();

    const response = await app.inject({ method: "GET", url: "/v1/backoffice/services/operational-summary" });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      rows: Array<Record<string, unknown> & { key: string }>;
      totals: Record<string, number>;
    };
    const rows = Object.fromEntries(body.rows.map((row) => [row.key, row]));

    expect(rows["microservice-users"]).toMatchObject({
      online: false,
      connectionError: true,
      accessGuaranteed: true,
      errorMessage: "HTTP 500: boom",
    });
    expect(rows["microservice-quiz"]).toMatchObject({
      online: false,
      errorMessage: "Unknown error",
      connectionError: false,
    });
    expect(rows["microservice-wordpass"]).toMatchObject({ online: false, accessGuaranteed: false });
    expect(rows["bff-mobile"]).toMatchObject({ online: true, requestsTotal: null, generationConversionRatio: null });
    expect(rows["api-gateway"]).toMatchObject({ online: true, generationRequestedTotal: null });
    expect(rows["ai-engine-stats"]).toMatchObject({
      generationRequestedTotal: null,
      generationCreatedTotal: 3,
      generationConversionRatio: null,
    });
    expect(rows["ai-engine-api"]).toMatchObject({
      generationRequestedTotal: 4,
      generationCreatedTotal: 2,
      generationConversionRatio: 0.5,
    });
    expect(body.totals).toMatchObject({ total: 8, accessIssues: 1, connectionErrors: 1 });
  });

  it("keeps summaries for different credentials separate and forwards the credentials upstream", async () => {
    const seen: Array<Record<string, string>> = [];
    stubFetch((url, init) => {
      if (url === `${USERS}/monitor/stats`) {
        seen.push(init?.headers as Record<string, string>);
      }
      return json({});
    });
    await boot();

    const [a, b] = await Promise.all([
      app.inject({
        method: "GET",
        url: "/v1/backoffice/services/operational-summary",
        headers: { "x-firebase-id-token": "idtok-a", "x-dev-firebase-uid": "uid-a", "x-api-key": "key-a" },
      }),
      app.inject({
        method: "GET",
        url: "/v1/backoffice/services/operational-summary",
        headers: { "x-firebase-id-token": "idtok-b", "x-dev-firebase-uid": "uid-b", "x-api-key": "key-b" },
      }),
    ]);

    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    // different credentials must not be deduplicated into one upstream sweep
    expect(seen).toHaveLength(2);
    expect(seen.map((headers) => headers.authorization).sort()).toEqual(["Bearer idtok-a", "Bearer idtok-b"]);
    expect(seen.map((headers) => headers["x-firebase-id-token"]).sort()).toEqual(["idtok-a", "idtok-b"]);
  });
});

describe("upstream JSON fetching", () => {
  it("treats an empty upstream body as an empty object and wraps non-JSON text", async () => {
    stubFetch(
      (url) => (url === `${QUIZ}/monitor/logs?limit=200` ? new Response("", { status: 200 }) : undefined),
      (url) => (url === `${WORDPASS}/monitor/logs?limit=200` ? new Response("plain text", { status: 200 }) : undefined),
    );
    await boot();

    const empty = await app.inject({ method: "GET", url: "/v1/backoffice/services/microservice-quiz/logs" });
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toEqual({ service: "microservice-quiz", logs: {} });

    const text = await app.inject({ method: "GET", url: "/v1/backoffice/services/microservice-wordpass/logs" });
    expect(text.json()).toEqual({ service: "microservice-wordpass", logs: { raw: "plain text" } });
  });

  it("falls back to the status text when a failing upstream sends no body", async () => {
    stubFetch(() => new Response("", { status: 502, statusText: "Bad Gateway" }));
    await boot();

    const response = await app.inject({ method: "GET", url: "/v1/backoffice/services/microservice-quiz/logs" });
    expect(response.statusCode).toBe(500);
    expect(response.json().message).toBe("HTTP 502: Bad Gateway");
  });

  it("converts aborted upstream requests into a timeout error and rethrows other failures", async () => {
    stubFetch((url) => {
      if (url.startsWith(`${QUIZ}/`)) {
        const abort = new Error("aborted");
        abort.name = "AbortError";
        return Promise.reject(abort);
      }
      return Promise.reject(new Error("connection refused"));
    });
    await boot({ UPSTREAM_TIMEOUT_MS: 1234 });

    const timeout = await app.inject({ method: "GET", url: "/v1/backoffice/services/microservice-quiz/logs" });
    expect(timeout.statusCode).toBe(500);
    expect(timeout.json().message).toBe("Upstream request timed out after 1234ms");

    const refused = await app.inject({ method: "GET", url: "/v1/backoffice/services/microservice-wordpass/logs" });
    expect(refused.statusCode).toBe(500);
    expect(refused.json().message).toBe("connection refused");
  });
});

describe("dataset queries", () => {
  it("forwards process filters to the quiz service and tolerates an empty task list", async () => {
    const mock = stubFetch(() => json({}));
    await boot();

    const response = await app.inject({
      method: "GET",
      url: "/v1/backoffice/services/microservice-quiz/data?dataset=processes&status=failed&requestedBy=api&limit=7",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ dataset: "processes", total: 0, rows: [] });
    expect(mock.mock.calls[0]?.[0]).toBe(`${QUIZ}/games/generate/processes?limit=7&status=failed&requestedBy=api`);

    const wordpass = await app.inject({
      method: "GET",
      url: "/v1/backoffice/services/microservice-wordpass/data?dataset=processes",
    });
    expect(wordpass.json()).toMatchObject({ rows: [], total: 0 });
  });

  it("forwards generation process filters on the dedicated processes route", async () => {
    const mock = stubFetch(() => json({ tasks: [] }));
    await boot();

    const response = await app.inject({
      method: "GET",
      url: "/v1/backoffice/services/microservice-wordpass/generation/processes?status=running&requestedBy=backoffice&limit=3",
    });

    expect(response.statusCode).toBe(200);
    expect(mock.mock.calls[0]?.[0]).toBe(`${WORDPASS}/games/generate/processes?limit=3&status=running&requestedBy=backoffice`);
  });

  it("rejects datasets the users service does not provide", async () => {
    stubFetch(() => json({}));
    await boot();

    const response = await app.inject({
      method: "GET",
      url: "/v1/backoffice/services/microservice-users/data?dataset=history",
    });
    expect(response.statusCode).toBe(500);
    expect(response.json().message).toBe("Dataset 'history' not supported for microservice-users");
  });

  it("returns empty roles and a default-metric leaderboard when the upstream payload is sparse", async () => {
    stubFetch((url) => {
      if (url === `${USERS}/users/admin/roles`) return json({});
      if (url.startsWith(`${USERS}/users/leaderboard`)) return json({ rows: [{ name: "ana" }] });
      return undefined;
    });
    await boot();

    const roles = await app.inject({ method: "GET", url: "/v1/backoffice/services/microservice-users/data?dataset=roles" });
    expect(roles.json()).toMatchObject({ rows: [], total: 0 });

    const board = await app.inject({
      method: "GET",
      url: "/v1/backoffice/services/microservice-users/data?dataset=leaderboard",
    });
    expect(board.json().rows).toEqual([{ rank: 1, metric: "won", name: "ana" }]);
  });

  it("filters and sorts rows with mixed value types", async () => {
    const rows = [
      { id: "a", flag: true, n: "10", meta: { team: "zeta" }, note: null, count: 3 },
      { id: "b", flag: false, n: "9", meta: { team: "alpha" }, note: "has Text", count: 12 },
      { id: "c", flag: true, n: "x", meta: [1, 2], note: undefined, count: 7 },
    ];
    stubFetch(() => json({ users: rows }));
    await boot();

    const get = async (query: string) => {
      const response = await app.inject({
        method: "GET",
        url: `/v1/backoffice/services/microservice-users/data?dataset=roles&${query}`,
      });
      expect(response.statusCode).toBe(200);
      return (response.json().rows as Array<{ id: string }>).map((row) => row.id);
    };

    // booleans sort as 0/1, ascending and descending
    expect(await get("sortBy=flag&sortDirection=asc")).toEqual(["b", "a", "c"]);
    expect(await get("sortBy=flag&sortDirection=desc")).toEqual(["a", "c", "b"]);
    // numeric strings are compared as numbers (9 < 10), non-numeric as text
    expect(await get("sortBy=n")).toEqual(["b", "a", "c"]);
    // numbers compare numerically
    expect(await get("sortBy=count")).toEqual(["a", "c", "b"]);
    // objects are compared through their JSON text, null/undefined sort first
    expect(await get("sortBy=meta")).toEqual(["c", "b", "a"]);
    expect(await get("sortBy=note")).toEqual(["a", "c", "b"]);
    // filter reaches strings, numbers, booleans and nested objects
    expect(await get("filter=HAS%20TEXT")).toEqual(["b"]);
    expect(await get("filter=zeta")).toEqual(["a"]);
    expect(await get("filter=12")).toEqual(["b"]);
    expect(await get("filter=false")).toEqual(["b"]);
    expect(await get("filter=nothing-matches")).toEqual([]);
  });
});

describe("history insights and paging", () => {
  function historyPage(rows: number, offset: number, categoryOf: (index: number) => Record<string, unknown>) {
    return Array.from({ length: rows }, (_, index) => ({ id: `h${offset + index}`, ...categoryOf(offset + index) }));
  }

  it("walks every upstream page to build insights and stops at an empty page", async () => {
    const requested: string[] = [];
    stubFetch((url) => {
      if (!url.startsWith(`${QUIZ}/games/history?`)) return undefined;
      requested.push(url);
      const params = new URL(url).searchParams;
      const page = Number(params.get("page"));
      const pageSize = Number(params.get("pageSize"));
      if (pageSize === 200 && page === 3) {
        return json({ items: [], total: 450, page, pageSize });
      }
      const rows = pageSize === 200 && page === 2 ? 200 : pageSize === 200 ? 200 : 20;
      return json({
        items: historyPage(rows, (page - 1) * pageSize, () => ({ categoryId: "9", categoryName: "History" })),
        total: 450,
        page,
        pageSize,
      });
    });
    await boot();

    const response = await app.inject({
      method: "GET",
      url: "/v1/backoffice/services/microservice-quiz/data?dataset=history",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    // upstream paging metadata is used for the table itself
    expect(body).toMatchObject({ total: 450, page: 1, pageSize: 20 });
    expect(body.rows).toHaveLength(20);
    // insights come from the two non-empty 200-row pages; page 3 was empty so the walk stopped
    expect(body.insights).toMatchObject({ sampleSize: 400 });
    expect(requested.some((url) => url.includes("page=3") && url.includes("pageSize=200"))).toBe(true);
    expect(requested.some((url) => url.includes("page=4"))).toBe(false);
  });

  it("uses the complete first page when it already holds every row", async () => {
    stubFetch((url) => {
      if (!url.startsWith(`${WORDPASS}/games/history?`)) return undefined;
      const params = new URL(url).searchParams;
      const pageSize = Number(params.get("pageSize"));
      // the table page reports a larger total than the 200-row sweep sees
      if (pageSize === 20) {
        return json({ items: historyPage(20, 0, () => ({ categoryId: "1" })), total: 60, page: 1, pageSize });
      }
      return json({ items: historyPage(40, 0, () => ({ categoryId: "1" })), total: 40, page: 1, pageSize });
    });
    await boot();

    const response = await app.inject({
      method: "GET",
      url: "/v1/backoffice/services/microservice-wordpass/data?dataset=history",
    });
    expect(response.json().insights.sampleSize).toBe(40);
  });

  it("builds insights from the initial rows when the upstream does not report a total", async () => {
    stubFetch(() => json({ items: [{ categoryId: "7", categoryName: "Seven" }, { categoryId: "7" }] }));
    await boot();

    const response = await app.inject({
      method: "GET",
      url: "/v1/backoffice/services/microservice-quiz/data?dataset=history",
    });
    expect(response.statusCode).toBe(200);
    // no total in the payload: BFF-side paging over the rows it received
    expect(response.json()).toMatchObject({ total: 2, page: 1, pageSize: 20 });
    expect(response.json().insights).toEqual({
      sampleSize: 2,
      categories: [{ id: "7", name: "Seven", count: 2, percentage: 100 }],
      deficitCategories: [],
    });
  });

  it("merges categories case-insensitively, labels unknown ones and flags under-represented ones", async () => {
    const items = [
      // the first row of category "A" has no name, a later row supplies it
      { categoryId: "A" },
      { categoryId: "a", categoryName: "Alpha" },
      { categoryId: "A", categoryName: "Alpha" },
      { categoryId: "A", categoryName: "Alpha" },
      { categoryId: 42, categoryName: "Numeric" },
      { categoryName: "Orphan" },
      { categoryId: "B", categoryName: "Beta" },
      { categoryId: "B", categoryName: "Beta" },
    ];
    stubFetch(() => json({ items }));
    await boot();

    const response = await app.inject({
      method: "GET",
      url: "/v1/backoffice/services/microservice-quiz/data?dataset=history",
    });
    const insights = response.json().insights as {
      sampleSize: number;
      categories: Array<{ id: string; name: string; count: number; percentage: number }>;
      deficitCategories: Array<{ id: string }>;
    };

    expect(insights.sampleSize).toBe(8);
    expect(insights.categories.map((entry) => [entry.id, entry.name, entry.count])).toEqual([
      ["A", "Alpha", 4],
      ["B", "Beta", 2],
      ["42", "Numeric", 1],
      ["unknown", "Orphan", 1],
    ]);
    expect(insights.categories[0]?.percentage).toBe(50);
    // average share is 25%, threshold min(20, 18.75): the two single-row categories are under it
    expect(insights.deficitCategories.map((entry) => entry.id)).toEqual(["42", "unknown"]);
  });

  it("falls back to the least represented category when none is below the deficit threshold", async () => {
    stubFetch(() => json({ items: [{ categoryId: "x" }, { categoryId: "y" }] }));
    await boot();

    const response = await app.inject({
      method: "GET",
      url: "/v1/backoffice/services/microservice-wordpass/data?dataset=history",
    });
    const insights = response.json().insights as { deficitCategories: Array<{ id: string }> };
    expect(insights.deficitCategories.map((entry) => entry.id)).toEqual(["y"]);
  });

  it("omits insights when the history is empty", async () => {
    stubFetch(() => json({ items: [], total: 0, page: 1, pageSize: 20 }));
    await boot();

    const response = await app.inject({
      method: "GET",
      url: "/v1/backoffice/services/microservice-quiz/data?dataset=history",
    });
    expect(response.json()).toMatchObject({ total: 0, rows: [], insights: null });
  });
});

describe("generation payload normalization", () => {
  it("defaults the generation count and drops absent optional fields", async () => {
    const mock = stubFetch(() => json({ ok: true }, 202));
    await boot();

    const response = await app.inject({
      method: "POST",
      url: "/v1/backoffice/services/microservice-quiz/generation/process",
      payload: { categoryId: "5" },
    });

    expect(response.statusCode).toBe(202);
    const init = mock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({ categoryId: "5", count: 10, requestedBy: "backoffice" });
  });

  it("uses numQuestions as the item count and an explicit count when provided", async () => {
    const mock = stubFetch(() => json({ ok: true }));
    await boot();

    await app.inject({
      method: "POST",
      url: "/v1/backoffice/services/microservice-quiz/generation/process",
      payload: { categoryId: "5", numQuestions: 6, count: 12, difficultyPercentage: 0 },
    });

    const init = mock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({
      categoryId: "5",
      difficultyPercentage: 0,
      itemCount: 6,
      count: 12,
      requestedBy: "backoffice",
    });
  });

  it("omits empty category and difficulty lists when starting the worker", async () => {
    const mock = stubFetch(() => json({ started: true }));
    await boot();

    const response = await app.inject({
      method: "POST",
      url: "/v1/backoffice/services/microservice-quiz/generation/worker/start",
      payload: { categoryIds: [], difficultyLevels: [] },
    });

    expect(response.statusCode).toBe(200);
    const init = mock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({ countPerIteration: 10 });
  });
});

describe("ai-engine runtime target", () => {
  it("reports a read failure from ai-engine-api using a status based message when the body is empty", async () => {
    stubFetch(() => new Response("", { status: 500 }));
    await boot();

    const response = await app.inject({ method: "GET", url: "/v1/backoffice/ai-engine/target" });
    expect(response.statusCode).toBe(500);
    expect(response.json().message).toBe("ai-engine llama target read failed with HTTP 500");
  });

  it("returns the upstream message when reading the target fails with a body", async () => {
    stubFetch(() => new Response("llama offline", { status: 503 }));
    await boot();

    const response = await app.inject({ method: "GET", url: "/v1/backoffice/ai-engine/target" });
    expect(response.statusCode).toBe(500);
    expect(response.json().message).toBe("llama offline");
  });

  it("maps plugin capability failures to 502 with and without a body", async () => {
    let body = "";
    stubFetch(() => new Response(body, { status: 503 }));
    await boot();

    const empty = await app.inject({ method: "GET", url: "/v1/backoffice/ai-engine/plugin/capabilities" });
    expect(empty.statusCode).toBe(502);
    expect(empty.json().message).toBe(
      "ai-engine-api unreachable: ai-engine plugin capabilities read failed with HTTP 503",
    );

    body = "plugin disabled";
    const withBody = await app.inject({ method: "GET", url: "/v1/backoffice/ai-engine/plugin/capabilities" });
    expect(withBody.json().message).toBe("ai-engine-api unreachable: plugin disabled");
  });

  it("reports non-error rejections from the capabilities endpoint as unknown errors", async () => {
    stubFetch(() => Promise.reject("net down"));
    await boot();

    const response = await app.inject({ method: "GET", url: "/v1/backoffice/ai-engine/plugin/capabilities" });
    expect(response.statusCode).toBe(502);
    expect(response.json().message).toBe("ai-engine-api unreachable: Unknown error");
  });

  it("authenticates against ai-engine-api with the configured key, preferring the API key over the bridge key", async () => {
    const mock = stubFetch(() => json({ plugins: [] }));
    await boot({ AI_ENGINE_API_KEY: "api-key", AI_ENGINE_BRIDGE_API_KEY: "bridge-key" });
    await app.inject({ method: "GET", url: "/v1/backoffice/ai-engine/plugin/capabilities" });
    expect((mock.mock.calls[0]?.[1] as RequestInit).headers).toEqual({ "x-api-key": "api-key" });
  });

  it("falls back to the bridge key when no API key is configured", async () => {
    const mock = stubFetch(() => json({ plugins: [] }));
    await boot({ AI_ENGINE_BRIDGE_API_KEY: "bridge-key" });
    await app.inject({ method: "GET", url: "/v1/backoffice/ai-engine/plugin/capabilities" });
    await app.inject({ method: "GET", url: "/v1/backoffice/ai-engine/target" });
    expect((mock.mock.calls[0]?.[1] as RequestInit).headers).toEqual({ "x-api-key": "bridge-key" });
    expect((mock.mock.calls[1]?.[1] as RequestInit).headers).toEqual({ "x-api-key": "bridge-key" });
  });

  it("sends the api key when updating the target and reports sync failures as 400", async () => {
    let status = 200;
    let reply = "";
    const mock = stubFetch((_url, init) => {
      if (init?.method === "PUT" || init?.method === "DELETE") {
        return status === 200 ? json({ ok: true }) : new Response(reply, { status });
      }
      return json({ host: "10.1.1.1", protocol: "http", port: 7002 });
    });
    await boot({ AI_ENGINE_API_KEY: "api-key" });

    const ok = await app.inject({
      method: "PUT",
      url: "/v1/backoffice/ai-engine/target",
      payload: { host: "10.1.1.1", port: 7002 },
    });
    expect(ok.statusCode).toBe(200);
    const putCall = mock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "PUT");
    expect((putCall?.[1] as RequestInit).headers).toEqual({
      "x-api-key": "api-key",
      "content-type": "application/json",
    });
    expect(JSON.parse(String((putCall?.[1] as RequestInit).body))).toMatchObject({ host: "10.1.1.1", port: 7002 });

    status = 500;
    const emptyFailure = await app.inject({
      method: "PUT",
      url: "/v1/backoffice/ai-engine/target",
      payload: { host: "10.1.1.1" },
    });
    expect(emptyFailure.statusCode).toBe(400);
    expect(emptyFailure.json().message).toBe("ai-engine llama target sync failed with HTTP 500");

    reply = "target rejected";
    const resetFailure = await app.inject({ method: "DELETE", url: "/v1/backoffice/ai-engine/target" });
    expect(resetFailure.statusCode).toBe(400);
    expect(resetFailure.json().message).toBe("target rejected");
  });

  it("rejects target hosts that are not valid hostnames", async () => {
    const mock = stubFetch(() => json({}));
    await boot();

    for (const host of ["bad host!", "http://", "/only/path"]) {
      const response = await app.inject({
        method: "PUT",
        url: "/v1/backoffice/ai-engine/target",
        payload: { host },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().message).toBe("host must be a valid hostname or IPv4 address");
    }
    expect(mock).not.toHaveBeenCalled();
  });
});

describe("ai-engine connections", () => {
  async function createConnection(name: string, host = "gpu.lab", port = 7002): Promise<string> {
    const response = await app.inject({
      method: "POST",
      url: "/v1/backoffice/ai-engine/connections",
      payload: { name, host, protocol: "http", port },
    });
    expect(response.statusCode).toBe(201);
    const created = (response.json().connections as Array<{ id: string; name: string }>).find((c) => c.name === name);
    return created!.id;
  }

  it("marks the matching connection active, tolerating unknown protocols and incomplete targets", async () => {
    let target: Record<string, unknown> = { host: "other.lab", protocol: "http", port: 1 };
    stubFetch((url) => (url === `${AI_API}/internal/admin/llama-target` ? json(target) : undefined));
    await boot();
    const id = await createConnection("Lab");

    const list = async () => (await app.inject({ method: "GET", url: "/v1/backoffice/ai-engine/connections" })).json();

    expect((await list()).activeConnectionId).toBeNull();

    // unknown protocol values are treated as http
    target = { host: "gpu.lab", protocol: "gopher", port: 7002 };
    expect((await list()).activeConnectionId).toBe(id);

    // protocol that is explicitly https no longer matches an http connection
    target = { host: "gpu.lab", protocol: "https", port: 7002 };
    expect((await list()).activeConnectionId).toBeNull();

    // a target without a numeric port or a host cannot be matched
    target = { host: "gpu.lab", protocol: "http", port: "7002" };
    expect((await list()).activeConnectionId).toBeNull();
    target = { protocol: "http", port: 7002 };
    expect((await list()).activeConnectionId).toBeNull();
  });

  it("rejects connections with invalid hosts and unknown ids", async () => {
    stubFetch((url) => (url === `${AI_API}/internal/admin/llama-target` ? json({}) : undefined));
    await boot();
    const id = await createConnection("Lab");

    const created = await app.inject({
      method: "POST",
      url: "/v1/backoffice/ai-engine/connections",
      payload: { name: "Bad", host: "bad host!" },
    });
    expect(created.statusCode).toBe(400);
    expect(created.json().message).toBe("host must be a valid hostname or IPv4 address");

    const updated = await app.inject({
      method: "PUT",
      url: `/v1/backoffice/ai-engine/connections/${id}`,
      payload: { name: "Lab", host: "bad host!" },
    });
    expect(updated.statusCode).toBe(400);

    const missing = await app.inject({
      method: "PUT",
      url: "/v1/backoffice/ai-engine/connections/does-not-exist",
      payload: { name: "Lab", host: "gpu.lab" },
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ message: "Connection not found" });

    const invalidBody = await app.inject({
      method: "PUT",
      url: `/v1/backoffice/ai-engine/connections/${id}`,
      payload: { name: "" },
    });
    expect(invalidBody.statusCode).toBe(400);
    expect(invalidBody.json().message).toBe("Invalid payload");

    const blankDelete = await app.inject({ method: "DELETE", url: "/v1/backoffice/ai-engine/connections/%20" });
    expect(blankDelete.statusCode).toBe(400);
    expect(blankDelete.json()).toEqual({ message: "Invalid connection id" });

    const missingDelete = await app.inject({ method: "DELETE", url: "/v1/backoffice/ai-engine/connections/nope" });
    expect(missingDelete.statusCode).toBe(404);

    const missingActivate = await app.inject({
      method: "POST",
      url: "/v1/backoffice/ai-engine/connections/nope/activate",
    });
    expect(missingActivate.statusCode).toBe(404);
    expect(missingActivate.json()).toEqual({ message: "Connection not found" });
  });

  it("updates and deletes a saved connection", async () => {
    stubFetch((url) => (url === `${AI_API}/internal/admin/llama-target` ? json({}) : undefined));
    await boot();
    const id = await createConnection("Lab");

    const updated = await app.inject({
      method: "PUT",
      url: `/v1/backoffice/ai-engine/connections/${id}`,
      payload: { name: "Lab v2", host: "gpu2.lab", port: 9000 },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().connections).toContainEqual(
      expect.objectContaining({ id, name: "Lab v2", host: "gpu2.lab", port: 9000, active: false }),
    );

    const deleted = await app.inject({ method: "DELETE", url: `/v1/backoffice/ai-engine/connections/${id}` });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json().connections.some((entry: { id: string }) => entry.id === id)).toBe(false);
  });

  it("reports a failed activation without changing the active connection", async () => {
    stubFetch((url, init) => {
      if (url !== `${AI_API}/internal/admin/llama-target`) return undefined;
      return init?.method === "PUT" ? new Response("llama unreachable", { status: 502 }) : json({});
    });
    await boot();
    const id = await createConnection("Lab");

    const response = await app.inject({
      method: "POST",
      url: `/v1/backoffice/ai-engine/connections/${id}/activate`,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ message: "llama unreachable" });
  });

  it("validates preset payloads, ids and hosts", async () => {
    stubFetch(() => json({}));
    await boot();

    const created = await app.inject({
      method: "POST",
      url: "/v1/backoffice/ai-engine/presets",
      payload: { name: "Lab", host: "gpu.lab" },
    });
    expect(created.statusCode).toBe(201);
    const presetId = created.json().id as string;

    const badCreate = await app.inject({
      method: "POST",
      url: "/v1/backoffice/ai-engine/presets",
      payload: { name: "Bad", host: "no good" },
    });
    expect(badCreate.statusCode).toBe(400);
    expect(badCreate.json().message).toBe("host must be a valid hostname or IPv4 address");

    const badUpdate = await app.inject({
      method: "PUT",
      url: `/v1/backoffice/ai-engine/presets/${presetId}`,
      payload: { name: "Lab", host: "no good" },
    });
    expect(badUpdate.statusCode).toBe(400);

    const invalidPayload = await app.inject({
      method: "PUT",
      url: `/v1/backoffice/ai-engine/presets/${presetId}`,
      payload: { host: "gpu.lab" },
    });
    expect(invalidPayload.statusCode).toBe(400);
    expect(invalidPayload.json().message).toBe("Invalid payload");

    const missingUpdate = await app.inject({
      method: "PUT",
      url: "/v1/backoffice/ai-engine/presets/ghost",
      payload: { name: "Ghost", host: "gpu.lab" },
    });
    expect(missingUpdate.statusCode).toBe(404);
    expect(missingUpdate.json()).toEqual({ message: "Preset not found" });

    const blankDelete = await app.inject({ method: "DELETE", url: "/v1/backoffice/ai-engine/presets/%20" });
    expect(blankDelete.statusCode).toBe(400);
    expect(blankDelete.json()).toEqual({ message: "Invalid preset id" });

    const invalidCreate = await app.inject({
      method: "POST",
      url: "/v1/backoffice/ai-engine/presets",
      payload: { name: "" },
    });
    expect(invalidCreate.statusCode).toBe(400);
  });
});

describe("ai-engine probe", () => {
  const probe = (payload: Record<string, unknown>) =>
    app.inject({ method: "POST", url: "/v1/backoffice/ai-engine/probe", payload });

  it("reports an unreachable endpoint using the upstream body, status text or status code", async () => {
    let next: Response | Promise<Response> = new Response("model not loaded", { status: 503 });
    stubFetch(() => next);
    await boot();

    const withBody = await probe({ host: "gpu.lab" });
    expect(withBody.statusCode).toBe(200);
    expect(withBody.json()).toMatchObject({
      reachable: false,
      llama: { ok: false, status: 503, message: "model not loaded", url: "http://gpu.lab:7002/v1/models" },
    });

    next = new Response("", { status: 504, statusText: "Gateway Timeout" });
    expect((await probe({ host: "gpu.lab" })).json().llama.message).toBe("Gateway Timeout");

    next = new Response("", { status: 500 });
    expect((await probe({ host: "gpu.lab" })).json().llama.message).toBe("HTTP 500");
  });

  it("reports network failures, including non-error rejections", async () => {
    let failure: unknown = new Error("ECONNREFUSED");
    stubFetch(() => Promise.reject(failure));
    await boot();

    const refused = await probe({ host: "gpu.lab" });
    expect(refused.json()).toMatchObject({ reachable: false, llama: { ok: false, status: null, message: "ECONNREFUSED" } });

    failure = "weird";
    expect((await probe({ host: "gpu.lab" })).json().llama.message).toBe("Probe failed");
  });

  it("returns 400 for invalid probe hosts and payloads", async () => {
    const mock = stubFetch(() => json({}));
    await boot();

    const badHost = await probe({ host: "bad host!" });
    expect(badHost.statusCode).toBe(400);
    expect(badHost.json().message).toBe("host must be a valid hostname or IPv4 address");

    const badPayload = await probe({ host: "" });
    expect(badPayload.statusCode).toBe(400);
    expect(badPayload.json().message).toBe("Invalid payload");
    expect(mock).not.toHaveBeenCalled();
  });
});

describe("authentication forwarding", () => {
  it("derives the bearer token from the firebase id token for users routes and forwards payloads", async () => {
    const mock = stubFetch(() => json({ ok: true }));
    await boot();

    const response = await app.inject({
      method: "PATCH",
      url: "/v1/backoffice/admin/users/roles/uid%2Fwith%20slash",
      headers: { "x-firebase-id-token": "id-token-1", "x-correlation-id": "corr-9" },
      payload: { role: "admin" },
    });

    expect(response.statusCode).toBe(200);
    const [url, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${USERS}/users/admin/roles/uid%2Fwith%20slash`);
    expect(init.method).toBe("PATCH");
    expect(init.headers).toMatchObject({ authorization: "Bearer id-token-1", "x-correlation-id": "corr-9" });
    expect(JSON.parse(String(init.body))).toEqual({ role: "admin" });
  });

  it("keeps the explicit authorization header when no firebase id token is sent", async () => {
    const mock = stubFetch(() => json({ ok: true }));
    await boot();

    await app.inject({
      method: "GET",
      url: "/v1/backoffice/auth/me",
      headers: { authorization: "Bearer staff" },
    });
    expect((mock.mock.calls[0]?.[1] as RequestInit).headers).toMatchObject({ authorization: "Bearer staff" });
  });

  it("does not leak the firebase id token as authorization for non-users upstreams", async () => {
    const mock = stubFetch(() => json({ rows: [] }));
    await boot();

    await app.inject({
      method: "GET",
      url: "/v1/backoffice/services/microservice-quiz/logs",
      headers: { "x-firebase-id-token": "id-token-2", authorization: "Bearer staff" },
    });
    const headers = (mock.mock.calls[0]?.[1] as RequestInit).headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer staff");
    expect(headers["x-firebase-id-token"]).toBe("id-token-2");
  });
});
