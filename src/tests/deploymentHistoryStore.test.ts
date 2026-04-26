import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { DeploymentHistoryStore } from "../app/services/deploymentHistoryStore.js";

let tempDir = "";

describe("DeploymentHistoryStore", () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "axiomnode-bff-deployment-history-"));
  });

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
    tempDir = "";
  });

  it("seeds state from release config and persists new deployments", async () => {
    const filePath = path.join(tempDir, "deployment-history.json");
    const store = new DeploymentHistoryStore({
      BACKOFFICE_DEPLOYMENT_HISTORY_FILE: filePath,
      RELEASE_ENV: "stg",
      RELEASE_VERSION: "abc1234",
      RELEASE_DEPLOYED_AT: "2026-04-26 20:10 UTC",
      RELEASE_COMMIT_SHA: "abc123456789",
      RELEASE_SUMMARY: "Seed release",
    } as never);

    await store.load();

    expect(store.get()).toMatchObject({
      environment: "stg",
      currentVersion: "abc1234",
      currentDeployedAt: "2026-04-26 20:10 UTC",
      history: [expect.objectContaining({ version: "abc1234" })],
    });

    await store.record({
      version: "def5678",
      deployedAt: "2026-04-26 21:15 UTC",
      commitSha: "def56789abcdef",
      summary: "Runtime rollout",
    });

    expect(store.get()).toMatchObject({
      currentVersion: "def5678",
      currentDeployedAt: "2026-04-26 21:15 UTC",
    });
    expect(store.get().history[0]).toMatchObject({ version: "def5678" });

    const persisted = JSON.parse(await readFile(filePath, "utf8"));
    expect(persisted.history).toHaveLength(2);
    expect(persisted.history[0].version).toBe("def5678");
  });

  it("loads persisted state, preserves explicit environment and deduplicates repeated releases", async () => {
    const filePath = path.join(tempDir, "deployment-history.json");
    await writeFile(
      filePath,
      `${JSON.stringify({
        environment: "prod",
        currentVersion: "abc1234",
        currentDeployedAt: "2026-04-20 09:00 UTC",
        history: [
          {
            version: "abc1234",
            deployedAt: "2026-04-20 09:00 UTC",
            commitSha: "abc123456789",
            summary: "Initial release",
          },
        ],
      })}\n`,
      "utf8",
    );

    const store = new DeploymentHistoryStore({
      BACKOFFICE_DEPLOYMENT_HISTORY_FILE: filePath,
      RELEASE_ENV: "stg",
      RELEASE_VERSION: "seed999",
      RELEASE_DEPLOYED_AT: "2026-04-26 20:10 UTC",
    } as never);

    await store.load();
    await store.record({
      version: "abc1234",
      deployedAt: "2026-04-20 09:00 UTC",
      commitSha: "abc123456789",
      summary: "Initial release",
    });

    expect(store.get()).toMatchObject({
      environment: "prod",
      currentVersion: "abc1234",
      history: [expect.objectContaining({ version: "abc1234" })],
    });
    expect(store.get().history).toHaveLength(1);
  });

  it("falls back to defaults when the persisted payload is malformed", async () => {
    const filePath = path.join(tempDir, "deployment-history.json");
    await writeFile(
      filePath,
      `${JSON.stringify({
        environment: "",
        currentVersion: "",
        currentDeployedAt: "",
        history: [{ version: 42, deployedAt: null, commitSha: [], summary: {} }],
      })}\n`,
      "utf8",
    );

    const store = new DeploymentHistoryStore({
      BACKOFFICE_DEPLOYMENT_HISTORY_FILE: filePath,
      RELEASE_ENV: "stg",
    } as never);

    await store.load();

    expect(store.get()).toEqual({
      environment: "stg",
      currentVersion: "--",
      currentDeployedAt: "--",
      history: [],
    });
  });

  it("derives current release fields from the first valid history entry when explicit values are blank", async () => {
    const filePath = path.join(tempDir, "deployment-history.json");
    await writeFile(
      filePath,
      `${JSON.stringify({
        environment: "",
        currentVersion: "",
        currentDeployedAt: "",
        history: [
          {
            version: "rel-1",
            deployedAt: "2026-04-20 09:00 UTC",
            commitSha: "rel-1",
            summary: "Recorded release",
          },
        ],
      })}\n`,
      "utf8",
    );

    const store = new DeploymentHistoryStore({
      BACKOFFICE_DEPLOYMENT_HISTORY_FILE: filePath,
      RELEASE_ENV: "stg",
    } as never);

    await store.load();

    expect(store.get()).toMatchObject({
      environment: "stg",
      currentVersion: "rel-1",
      currentDeployedAt: "2026-04-20 09:00 UTC",
      history: [expect.objectContaining({ version: "rel-1" })],
    });
  });

  it("uses default seed commit and summary values when optional release metadata is absent", async () => {
    const filePath = path.join(tempDir, "deployment-history.json");
    const store = new DeploymentHistoryStore({
      BACKOFFICE_DEPLOYMENT_HISTORY_FILE: filePath,
      RELEASE_ENV: "stg",
      RELEASE_VERSION: "seed-only",
      RELEASE_DEPLOYED_AT: "2026-04-26 20:10 UTC",
    } as never);

    await store.load();

    expect(store.get().history[0]).toEqual({
      version: "seed-only",
      deployedAt: "2026-04-26 20:10 UTC",
      commitSha: "seed-only",
      summary: "Initial recorded deployment",
    });
  });

  it("rethrows unexpected load errors when the persisted file is unreadable json", async () => {
    const filePath = path.join(tempDir, "deployment-history.json");
    await writeFile(filePath, "{not-json}\n", "utf8");

    const store = new DeploymentHistoryStore({
      BACKOFFICE_DEPLOYMENT_HISTORY_FILE: filePath,
      RELEASE_ENV: "stg",
    } as never);

    await expect(store.load()).rejects.toThrow();
  });
});