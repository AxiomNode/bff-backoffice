import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { RoutingStateStore } from "../app/services/routingStateStore.js";

let tempDir = "";
let previousCwd = "";

describe("RoutingStateStore", () => {
  beforeEach(async () => {
    previousCwd = process.cwd();
    tempDir = await mkdtemp(path.join(os.tmpdir(), "axiomnode-bff-routing-state-"));
  });

  afterEach(async () => {
    process.chdir(previousCwd);
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
    tempDir = "";
  });

  it("loads missing state as empty defaults and persists overrides and presets", async () => {
    const stateFile = path.join(tempDir, "routing-state.json");
    const store = new RoutingStateStore({ BACKOFFICE_ROUTING_STATE_FILE: stateFile } as never);

    await store.load();

    expect(store.get("api-gateway")).toBeNull();
    expect(store.listAiEnginePresets()).toHaveLength(2);

    await store.set("api-gateway", {
      baseUrl: "http://api-gateway:7005",
      label: "cluster",
      updatedAt: "2026-04-21T00:00:00.000Z",
    });
    await store.setAiEnginePreset({
      id: "lab",
      name: "Lab",
      host: "10.0.0.10",
      protocol: "https",
      port: 8443,
      updatedAt: "2026-04-21T00:00:00.000Z",
    });

    expect(store.list()).toMatchObject({
      "api-gateway": expect.objectContaining({ baseUrl: "http://api-gateway:7005" }),
    });
    expect(store.listAiEnginePresets()).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "lab", port: 8443 })]),
    );

    const persisted = JSON.parse(await readFile(stateFile, "utf8"));
    expect(persisted.version).toBe(3);
    expect(persisted.overrides["api-gateway"].baseUrl).toBe("http://api-gateway:7005");

    const history = await store.listHistory(10);
    expect(history).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "service-target-set", service: "api-gateway" }),
        expect.objectContaining({ action: "ai-engine-preset-set", presetId: "lab" }),
      ]),
    );

    expect(await store.deleteAiEnginePreset("lab")).toBe(true);
    expect(await store.deleteAiEnginePreset("missing")).toBe(false);
    await store.delete("api-gateway");
    expect(store.get("api-gateway")).toBeNull();
  });

  it("returns routing history in reverse chronological order from persisted JSONL", async () => {
    const stateFile = path.join(tempDir, "routing-state.json");
    const store = new RoutingStateStore({ BACKOFFICE_ROUTING_STATE_FILE: stateFile } as never);

    await store.load();
    await store.set("api-gateway", {
      baseUrl: "http://api-gateway:7005",
      updatedAt: "2026-04-21T00:00:00.000Z",
    });
    await store.setAiEnginePreset({
      id: "lab",
      name: "Lab",
      host: "10.0.0.10",
      protocol: "http",
      port: 7002,
      updatedAt: "2026-04-21T00:00:01.000Z",
    });

    const history = await store.listHistory(2);
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({ action: "ai-engine-preset-set", presetId: "lab" });
    expect(history[1]).toMatchObject({ action: "service-target-set", service: "api-gateway" });
    expect(history[0]?.state.aiEnginePresets).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "lab" })]),
    );
  });

  it("normalizes legacy versions and malformed payloads", async () => {
    const version2File = path.join(tempDir, "version2-state.json");
    await writeFile(
      version2File,
      JSON.stringify({
        version: 2,
        overrides: {
          "microservice-users": {
            baseUrl: "http://microservice-users:7102",
            label: "cluster",
            updatedAt: "2026-04-21T00:00:00.000Z",
          },
          "ai-engine-api": {
            baseUrl: "http://ignored:7001",
            updatedAt: "2026-04-21T00:00:00.000Z",
          },
        },
        aiEnginePresets: [
          {
            id: "legacy",
            name: "Legacy preset",
            host: "192.168.0.50",
            protocol: "http",
            apiPort: 17002,
            updatedAt: "2026-04-21T00:00:00.000Z",
          },
          null,
        ],
      }),
      "utf8",
    );

    const version2Store = new RoutingStateStore({ BACKOFFICE_ROUTING_STATE_FILE: version2File } as never);
    await version2Store.load();

    expect(version2Store.get("microservice-users")).toMatchObject({
      baseUrl: "http://microservice-users:7102",
      label: "cluster",
    });
    expect(version2Store.get("ai-engine-api")).toBeNull();
    expect(version2Store.listAiEnginePresets()).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "legacy", port: 17002 })]),
    );

    const version1File = path.join(tempDir, "version1-state.json");
    await writeFile(
      version1File,
      JSON.stringify({ version: 1, overrides: {} }),
      "utf8",
    );
    const version1Store = new RoutingStateStore({ BACKOFFICE_ROUTING_STATE_FILE: version1File } as never);
    await version1Store.load();
    expect(version1Store.listAiEnginePresets()).toHaveLength(2);

    const malformedFile = path.join(tempDir, "malformed-state.json");
    await writeFile(malformedFile, JSON.stringify({ version: 99, overrides: [] }), "utf8");
    const malformedStore = new RoutingStateStore({ BACKOFFICE_ROUTING_STATE_FILE: malformedFile } as never);
    await malformedStore.load();
    expect(malformedStore.list()).toEqual({});
    expect(malformedStore.listAiEnginePresets()).toHaveLength(2);

    const nullFile = path.join(tempDir, "null-state.json");
    await writeFile(nullFile, "null", "utf8");
    const nullStore = new RoutingStateStore({ BACKOFFICE_ROUTING_STATE_FILE: nullFile } as never);
    await nullStore.load();
    expect(nullStore.list()).toEqual({});
    expect(nullStore.listAiEnginePresets()).toHaveLength(2);

    const partialFile = path.join(tempDir, "partial-state.json");
    await writeFile(
      partialFile,
      JSON.stringify({
        version: 3,
        overrides: {
          "microservice-users": null,
          "bff-mobile": {
            baseUrl: "http://bff-mobile:7010",
            label: 123,
            updatedAt: "2026-04-21T00:00:00.000Z",
          },
          "microservice-wordpass": {
            baseUrl: 42,
            updatedAt: "2026-04-21T00:00:00.000Z",
          },
        },
        aiEnginePresets: [
          {
            id: "missing-port",
            name: "Missing Port",
            host: "10.0.0.8",
            protocol: "https",
            updatedAt: "2026-04-21T00:00:00.000Z",
          },
          {
            id: "invalid-protocol",
            name: "Invalid",
            host: "10.0.0.9",
            protocol: "ftp",
            updatedAt: "2026-04-21T00:00:00.000Z",
          },
        ],
      }),
      "utf8",
    );
    const partialStore = new RoutingStateStore({ BACKOFFICE_ROUTING_STATE_FILE: partialFile } as never);
    await partialStore.load();
    expect(partialStore.list()).toEqual({
      "bff-mobile": {
        baseUrl: "http://bff-mobile:7010",
        label: undefined,
        updatedAt: "2026-04-21T00:00:00.000Z",
      },
    });
    expect(partialStore.listAiEnginePresets()).toEqual([
      expect.objectContaining({ id: "missing-port", port: 7002, protocol: "https" }),
    ]);
  });

  it("falls back to default path and rethrows non-ENOENT filesystem errors", async () => {
    process.chdir(tempDir);
    const runtimeDir = path.join(tempDir, ".runtime");
    const defaultStateFile = path.join(runtimeDir, "backoffice-routing-state.json");
    await mkdir(runtimeDir, { recursive: true });
    await writeFile(defaultStateFile, JSON.stringify({ version: 3, overrides: {}, aiEnginePresets: [] }), "utf8");

    const defaultStore = new RoutingStateStore({ BACKOFFICE_ROUTING_STATE_FILE: "   " } as never);
    await defaultStore.load();
    expect(defaultStore.listAiEnginePresets()).toHaveLength(2);

    const brokenStore = new RoutingStateStore({ BACKOFFICE_ROUTING_STATE_FILE: tempDir } as never);
    await expect(brokenStore.load()).rejects.toMatchObject({ code: "EISDIR" });
  });
});