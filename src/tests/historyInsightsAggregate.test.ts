import { afterEach, describe, expect, it, vi } from "vitest";

import Fastify, { type FastifyInstance } from "fastify";

vi.mock("../app/services/kubernetesObservability.js", () => ({
  fetchKubernetesOverview: vi.fn(),
}));

import { backofficeRoutes } from "../app/routes/backoffice.js";
import type { AppConfig } from "../app/config.js";

const QUIZ = "http://quiz:7100";
const WORDPASS = "http://wordpass:7101";

type Row = { id: string; categoryId?: unknown; categoryName?: unknown };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const apps: FastifyInstance[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  while (apps.length > 0) {
    await apps.pop()?.close();
  }
});

async function boot(): Promise<FastifyInstance> {
  const app = Fastify();
  apps.push(app);
  await backofficeRoutes(app, {
    SERVICE_NAME: "bff-backoffice",
    SERVICE_PORT: 7011,
    ALLOWED_ORIGINS: "http://localhost:3000",
    USERS_SERVICE_URL: "http://users:7102",
    QUIZZ_SERVICE_URL: QUIZ,
    WORDPASS_SERVICE_URL: WORDPASS,
    UPSTREAM_METRICS_CACHE_TTL_MS: 0,
  } as unknown as AppConfig);
  return app;
}

/**
 * Fake game microservice holding `rows` (newest first). `aggregate` toggles the GROUP BY endpoint so the very same
 * dataset can be read through the new path and through the legacy "page everything" path.
 */
function fakeUpstream(base: string, rows: Row[], options: { aggregate: boolean | "invalid" | "error" }) {
  const calls = { insights: [] as string[], history: [] as string[] };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.startsWith(`${base}/games/history/insights`)) {
        calls.insights.push(url);
        if (options.aggregate === false) return new Response("not found", { status: 404 });
        if (options.aggregate === "error") return new Response("db down", { status: 500 });
        if (options.aggregate === "invalid") return json({ categories: "nope" });

        // same grouping the microservice does: GROUP BY (categoryId, categoryName), newest bucket first
        const groups = new Map<string, { categoryId: unknown; categoryName: unknown; count: number; first: number }>();
        rows.forEach((row, index) => {
          const key = JSON.stringify([row.categoryId ?? null, row.categoryName ?? null]);
          const group = groups.get(key);
          if (group) group.count += 1;
          else groups.set(key, { categoryId: row.categoryId ?? null, categoryName: row.categoryName ?? null, count: 1, first: index });
        });
        const categories = [...groups.values()]
          .sort((left, right) => left.first - right.first)
          .map(({ categoryId, categoryName, count }) => ({ categoryId, categoryName, count, latestCreatedAt: null }));
        return json({ gameType: "quiz", total: rows.length, categories });
      }
      if (url.startsWith(`${base}/games/history?`)) {
        calls.history.push(url);
        const params = new URL(url).searchParams;
        const page = Number(params.get("page"));
        const pageSize = Number(params.get("pageSize"));
        const items = rows.slice((page - 1) * pageSize, page * pageSize);
        return json({ items, total: rows.length, page, pageSize });
      }
      return new Response("not found", { status: 404 });
    }),
  );
  return calls;
}

function manyRows(total: number): Row[] {
  const palette: Array<Pick<Row, "categoryId" | "categoryName">> = [
    { categoryId: "9", categoryName: "General Knowledge" },
    { categoryId: "17", categoryName: "Science" },
    { categoryId: "A" },
    { categoryId: "a", categoryName: "Alpha" },
    { categoryId: 42, categoryName: "Numeric" },
    { categoryName: "Orphan" },
    {},
    { categoryId: "9", categoryName: "General Knowledge" },
  ];
  return Array.from({ length: total }, (_, index) => ({ id: `r${index}`, ...palette[(index * 7) % palette.length] }));
}

async function readInsights(app: FastifyInstance, service: "microservice-quiz" | "microservice-wordpass", query = "") {
  const response = await app.inject({
    method: "GET",
    url: `/v1/backoffice/services/${service}/data?dataset=history${query}`,
  });
  expect(response.statusCode).toBe(200);
  return response.json();
}

describe("history insights from the upstream aggregate", () => {
  it("asks the service for one aggregate and never pages the history rows", async () => {
    const rows = manyRows(1000);
    const calls = fakeUpstream(QUIZ, rows, { aggregate: true });
    const app = await boot();

    const body = await readInsights(app, "microservice-quiz");

    expect(body).toMatchObject({ total: 1000, page: 1, pageSize: 20 });
    expect(body.rows).toHaveLength(20);
    expect(body.insights.sampleSize).toBe(1000);
    expect(calls.insights).toEqual([`${QUIZ}/games/history/insights`]);
    // only the table page itself was requested: no 200-row sweep (previously 5 sequential calls for 1000 rows)
    expect(calls.history).toHaveLength(1);
    expect(calls.history[0]).toContain("pageSize=20");
  });

  it("forwards the table filters to the aggregate", async () => {
    const calls = fakeUpstream(WORDPASS, manyRows(30), { aggregate: true });
    const app = await boot();

    await readInsights(app, "microservice-wordpass", "&categoryId=9&difficultyPercentage=40&status=completed");

    expect(calls.insights).toEqual([
      `${WORDPASS}/games/history/insights?categoryId=9&difficultyPercentage=40&status=completed`,
    ]);
  });

  it.each([
    ["a single category", Array.from({ length: 5 }, (_, index) => ({ id: `s${index}`, categoryId: "x", categoryName: "X" }))],
    ["mixed categories, ids with different case and missing names", manyRows(64)],
    ["more categories than the deficit window", Array.from({ length: 40 }, (_, index) => ({ id: `m${index}`, categoryId: String(index % 9), categoryName: `Cat ${index % 9}` }))],
    ["a name that only appears on a later row", [{ id: "1", categoryId: "A" }, { id: "2", categoryId: "a", categoryName: "Alpha" }, { id: "3", categoryId: "A", categoryName: "Other" }]],
  ])("produces exactly the legacy insights for %s", async (_label, rows) => {
    // legacy: the upstream has no aggregate endpoint, the BFF pages every row
    fakeUpstream(QUIZ, rows, { aggregate: false });
    const legacy = (await readInsights(await boot(), "microservice-quiz")).insights;

    // new: the upstream answers with its GROUP BY
    fakeUpstream(QUIZ, rows, { aggregate: true });
    const aggregated = (await readInsights(await boot(), "microservice-quiz")).insights;

    expect(aggregated).toEqual(legacy);
    expect(aggregated.sampleSize).toBe(rows.length);
  });

  it("returns insights: null for an empty aggregate", async () => {
    fakeUpstream(QUIZ, [], { aggregate: true });
    const body = await readInsights(await boot(), "microservice-quiz");
    expect(body).toMatchObject({ total: 0, rows: [], insights: null });
  });
});

describe("fallback when the service has no aggregate endpoint", () => {
  it("pages the rows on 404 and does not probe again while the answer is remembered", async () => {
    const rows = manyRows(450);
    const calls = fakeUpstream(QUIZ, rows, { aggregate: false });
    const app = await boot();

    const first = await readInsights(app, "microservice-quiz");
    expect(first.insights.sampleSize).toBe(450);
    expect(calls.insights).toHaveLength(1);
    // legacy sweep: ceil(450 / 200) = 3 sequential pages of 200
    expect(calls.history.filter((url) => url.includes("pageSize=200"))).toHaveLength(3);

    await readInsights(app, "microservice-quiz");
    expect(calls.insights).toHaveLength(1);
  });

  it("re-probes after the unsupported marker expired", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const calls = fakeUpstream(QUIZ, manyRows(10), { aggregate: false });
      const app = await boot();
      await readInsights(app, "microservice-quiz");
      vi.setSystemTime(Date.now() + 6 * 60_000);
      await readInsights(app, "microservice-quiz");
      expect(calls.insights).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ["not the expected shape", "invalid" as const],
  ])("falls back when the aggregate is %s", async (_label, mode) => {
    const rows = manyRows(25);
    fakeUpstream(WORDPASS, rows, { aggregate: mode });
    const body = await readInsights(await boot(), "microservice-wordpass");
    expect(body.insights.sampleSize).toBe(25);
  });

  it.each([
    ["an entry that is not an object", { categories: ["x"] }],
    ["a negative count", { categories: [{ categoryId: "1", count: -1 }] }],
    ["a missing count", { categories: [{ categoryId: "1" }] }],
    ["a non-object payload", "text"],
  ])("rejects an aggregate with %s", async (_label, payload) => {
    const rows = manyRows(12);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.includes("/games/history/insights")) return json(payload);
        const params = new URL(url).searchParams;
        return json({ items: rows, total: rows.length, page: 1, pageSize: Number(params.get("pageSize")) });
      }),
    );
    const body = await readInsights(await boot(), "microservice-quiz");
    // legacy path result, not the malformed aggregate
    expect(body.insights.sampleSize).toBe(12);
  });

  it("does not hide real upstream failures behind the paging fallback", async () => {
    const calls = fakeUpstream(QUIZ, manyRows(300), { aggregate: "error" });
    const app = await boot();

    const response = await app.inject({ method: "GET", url: "/v1/backoffice/services/microservice-quiz/data?dataset=history" });

    expect(response.statusCode).toBeGreaterThanOrEqual(500);
    expect(calls.history.filter((url) => url.includes("pageSize=200"))).toHaveLength(0);
  });
});
