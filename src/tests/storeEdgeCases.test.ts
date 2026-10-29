import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { AuditTrailStore, resolveActor } from "../app/services/auditTrailStore.js";
import { RoutingStateStore } from "../app/services/routingStateStore.js";

let dir = "";
let previousCwd = "";

beforeEach(async () => {
  previousCwd = process.cwd();
  dir = await mkdtemp(path.join(os.tmpdir(), "axiomnode-bff-edge-"));
});

afterEach(async () => {
  process.chdir(previousCwd);
  await rm(dir, { recursive: true, force: true });
});

const event = (n: number) => ({
  category: "admin.users",
  action: `PATCH /x/${n}`,
  method: "PATCH",
  path: `/x/${n}`,
  statusCode: 200,
  actor: "uid",
}) as never;

describe("AuditTrailStore edge cases", () => {
  it("falls back to defaults when the optional settings are absent", () => {
    const store = new AuditTrailStore({ AUDIT_TRAIL_DIR: "   " } as never);
    expect(store.isEnabled()).toBe(true);
    expect(store.directory()).toBe(path.resolve(process.cwd(), ".runtime", "audit"));
  });

  it("caps query results across files and skips malformed lines and foreign files", async () => {
    const store = new AuditTrailStore({ AUDIT_TRAIL_DIR: dir } as never);
    await store.record(event(1), new Date("2026-01-01T10:00:00Z"));
    await store.record(event(2), new Date("2026-01-02T10:00:00Z"));
    await store.record(event(3), new Date("2026-01-02T11:00:00Z"));
    await writeFile(path.join(dir, "audit-2025-12-31.jsonl"), "not-json\n", "utf-8");
    await writeFile(path.join(dir, "notes.txt"), "ignored", "utf-8");

    expect(await store.query(1)).toHaveLength(1);
    expect(await store.query(2)).toHaveLength(2);
    expect((await store.query(10)).length).toBe(3);
  });

  it("returns an empty list when the directory does not exist", async () => {
    const store = new AuditTrailStore({ AUDIT_TRAIL_DIR: path.join(dir, "missing") } as never);
    expect(await store.query()).toEqual([]);
  });

  it("does nothing when disabled", async () => {
    const store = new AuditTrailStore({ AUDIT_TRAIL_ENABLED: false, AUDIT_TRAIL_DIR: dir } as never);
    await store.record(event(1));
    expect(await store.query()).toEqual([]);
  });

  it("resolves actors from uid, bearer token or anonymous", () => {
    expect(resolveActor({ "x-firebase-uid": "  abc  " })).toBe("abc");
    expect(resolveActor({ authorization: "Bearer 0123456789abcdef" })).toBe("bearer:89abcdef");
    expect(resolveActor({ authorization: "Bearer x" })).toBe("anonymous");
    expect(resolveActor({})).toBe("anonymous");
  });
});

describe("RoutingStateStore edge cases", () => {
  it("uses the default runtime path when no state file is configured", async () => {
    process.chdir(dir);
    const store = new RoutingStateStore({} as never);
    await store.load();
    expect(store.list()).toEqual({});
    expect(await store.listHistory()).toEqual([]);
  });

  it("normalises history limits and ignores invalid history entries", async () => {
    const stateFile = path.join(dir, "state.json");
    const store = new RoutingStateStore({ BACKOFFICE_ROUTING_STATE_FILE: stateFile } as never);
    const lines = [
      JSON.stringify({ recordedAt: "2026-01-01T00:00:00Z", action: "service-target-set", service: "mobile", presetId: "p1", state: {} }),
      JSON.stringify({ recordedAt: "2026-01-02T00:00:00Z", action: "ai-engine-preset-delete", service: 7, presetId: 3, state: null }),
      JSON.stringify({ recordedAt: 1, action: "service-target-set", state: {} }),
      JSON.stringify({ recordedAt: "2026-01-03T00:00:00Z", action: "unknown", state: {} }),
      JSON.stringify("scalar"),
      "",
    ];
    await writeFile(path.join(dir, "state.history.jsonl"), lines.join("\n"), "utf8");

    const all = await store.listHistory(1.5);
    expect(all).toHaveLength(2);
    expect(all[0].action).toBe("ai-engine-preset-delete");
    expect(all[0].service).toBeUndefined();
    expect(all[0].presetId).toBeUndefined();
    expect(all[1].service).toBe("mobile");
    expect(all[1].presetId).toBe("p1");
    expect(await store.listHistory(0)).toHaveLength(1);
    expect(await store.listHistory(5000)).toHaveLength(2);
  });
});
