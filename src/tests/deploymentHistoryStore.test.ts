import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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
});