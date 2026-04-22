import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { mkdtemp, readdir, readFile, rm, writeFile, utimes } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  AuditTrailStore,
  classifyAdminAction,
  resolveActor,
} from "../app/services/auditTrailStore.js";

const baseConfig = {
  SERVICE_NAME: "bff-backoffice",
  SERVICE_PORT: 7011,
  ALLOWED_ORIGINS: "http://localhost:3000",
  USERS_SERVICE_URL: "http://users:7102",
};

let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "axiomnode-audit-"));
});

afterEach(async () => {
  if (dir) {
    await rm(dir, { recursive: true, force: true });
    dir = "";
  }
});

describe("classifyAdminAction", () => {
  it("captures admin user role mutations", () => {
    const result = classifyAdminAction("PATCH", "/v1/backoffice/admin/users/roles/abc");
    expect(result).toEqual({
      audit: true,
      category: "admin.users",
      action: "PATCH /v1/backoffice/admin/users/roles/abc",
    });
  });

  it("captures routing target overrides", () => {
    expect(classifyAdminAction("PUT", "/v1/backoffice/service-targets/api-gateway").audit).toBe(true);
    expect(classifyAdminAction("DELETE", "/v1/backoffice/service-targets/api-gateway").audit).toBe(true);
  });

  it("captures ai-engine preset and target mutations", () => {
    const presetResult = classifyAdminAction("POST", "/v1/backoffice/ai-engine/presets");
    const targetResult = classifyAdminAction("PUT", "/v1/backoffice/ai-engine/target");
    expect(presetResult.audit && presetResult.category).toBe("routing.ai-engine.preset");
    expect(targetResult.audit && targetResult.category).toBe("routing.ai-engine.target");
  });

  it("captures data mutations and generation starts", () => {
    const dataResult = classifyAdminAction("POST", "/v1/backoffice/services/microservice-quiz/data");
    const genResult = classifyAdminAction("POST", "/v1/backoffice/services/microservice-quiz/generation/process");
    expect(dataResult.audit && dataResult.category).toBe("data.mutation");
    expect(genResult.audit && genResult.category).toBe("ai.generation.start");
  });

  it("ignores reads and unknown routes", () => {
    expect(classifyAdminAction("GET", "/v1/backoffice/admin/users/roles").audit).toBe(false);
    expect(classifyAdminAction("GET", "/v1/backoffice/services/microservice-quiz/data").audit).toBe(false);
    expect(classifyAdminAction("POST", "/v1/backoffice/auth/session").audit).toBe(false);
  });
});

describe("resolveActor", () => {
  it("prefers explicit firebase uid header", () => {
    expect(resolveActor({ "x-firebase-uid": "uid-123" })).toBe("uid-123");
  });

  it("falls back to last 8 chars of bearer token", () => {
    expect(resolveActor({ authorization: "Bearer abcdefghijKLMN" })).toBe("bearer:ghijKLMN");
  });

  it("returns anonymous when no identity headers are present", () => {
    expect(resolveActor({})).toBe("anonymous");
  });
});

describe("AuditTrailStore", () => {
  it("appends events as JSONL and returns them via query", async () => {
    const store = new AuditTrailStore({ ...baseConfig, AUDIT_TRAIL_DIR: dir, AUDIT_TRAIL_ENABLED: true } as never);
    await store.record({
      correlationId: "corr-1",
      actor: "uid-1",
      ip: "1.2.3.4",
      method: "PATCH",
      route: "/v1/backoffice/admin/users/roles/abc",
      category: "admin.users",
      action: "PATCH /v1/backoffice/admin/users/roles/abc",
      statusCode: 200,
      durationMs: 12,
      requestBytes: 64,
    });
    await store.record({
      correlationId: "corr-2",
      actor: "uid-2",
      ip: "1.2.3.5",
      method: "DELETE",
      route: "/v1/backoffice/ai-engine/target",
      category: "routing.ai-engine.target",
      action: "DELETE /v1/backoffice/ai-engine/target",
      statusCode: 500,
      durationMs: 30,
      requestBytes: 0,
    });

    const events = await store.query(10);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ correlationId: "corr-2", success: false });
    expect(events[1]).toMatchObject({ correlationId: "corr-1", success: true });

    const files = await readdir(dir);
    expect(files.some((name) => name.startsWith("audit-"))).toBe(true);
  });

  it("noop when disabled", async () => {
    const store = new AuditTrailStore({
      ...baseConfig,
      AUDIT_TRAIL_DIR: dir,
      AUDIT_TRAIL_ENABLED: false,
    } as never);
    await store.record({
      correlationId: "corr-1",
      actor: "uid-1",
      ip: "1.2.3.4",
      method: "PATCH",
      route: "/v1/backoffice/admin/users/roles/abc",
      category: "admin.users",
      action: "PATCH /v1/backoffice/admin/users/roles/abc",
      statusCode: 200,
      durationMs: 12,
      requestBytes: 64,
    });
    expect(await store.query()).toEqual([]);
  });

  it("enforces retention by deleting files older than the configured window", async () => {
    const store = new AuditTrailStore({
      ...baseConfig,
      AUDIT_TRAIL_DIR: dir,
      AUDIT_TRAIL_ENABLED: true,
      AUDIT_TRAIL_RETENTION_DAYS: 1,
    } as never);

    const oldFile = path.join(dir, "audit-2020-01-01.jsonl");
    await writeFile(oldFile, '{"ts":"2020-01-01T00:00:00.000Z"}\n', "utf-8");
    const oldDate = new Date(2020, 0, 1);
    await utimes(oldFile, oldDate, oldDate);

    await store.record({
      correlationId: "corr-now",
      actor: "uid-x",
      ip: "0.0.0.0",
      method: "POST",
      route: "/v1/backoffice/ai-engine/presets",
      category: "routing.ai-engine.preset",
      action: "POST /v1/backoffice/ai-engine/presets",
      statusCode: 201,
      durationMs: 10,
      requestBytes: 16,
    });

    const remaining = await readdir(dir);
    expect(remaining.includes("audit-2020-01-01.jsonl")).toBe(false);
    expect(remaining.length).toBe(1);
    const content = await readFile(path.join(dir, remaining[0]), "utf-8");
    expect(content).toContain("corr-now");
  });
});
