import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { AppConfig } from "../config.js";

export type DeploymentHistoryEntry = {
  version: string;
  deployedAt: string;
  commitSha: string;
  summary: string;
};

export type DeploymentHistoryState = {
  environment: string;
  currentVersion: string;
  currentDeployedAt: string;
  history: DeploymentHistoryEntry[];
};

const EMPTY_STATE: DeploymentHistoryState = {
  environment: "unknown",
  currentVersion: "--",
  currentDeployedAt: "--",
  history: [],
};

function defaultDeploymentHistoryFilePath(): string {
  return path.resolve(process.cwd(), ".runtime", "backoffice-deployment-history.json");
}

function normalizeEntry(raw: unknown): DeploymentHistoryEntry | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const candidate = raw as Record<string, unknown>;
  if (
    typeof candidate.version !== "string" ||
    typeof candidate.deployedAt !== "string" ||
    typeof candidate.commitSha !== "string" ||
    typeof candidate.summary !== "string"
  ) {
    return null;
  }

  return {
    version: candidate.version,
    deployedAt: candidate.deployedAt,
    commitSha: candidate.commitSha,
    summary: candidate.summary,
  };
}

function normalizeState(raw: unknown, fallbackEnvironment: string): DeploymentHistoryState {
  if (!raw || typeof raw !== "object") {
    return {
      ...EMPTY_STATE,
      environment: fallbackEnvironment,
    };
  }

  const candidate = raw as Record<string, unknown>;
  const history = Array.isArray(candidate.history)
    ? candidate.history.map((entry) => normalizeEntry(entry)).filter((entry): entry is DeploymentHistoryEntry => entry !== null)
    : [];

  return {
    environment: typeof candidate.environment === "string" && candidate.environment.trim().length > 0
      ? candidate.environment
      : fallbackEnvironment,
    currentVersion: typeof candidate.currentVersion === "string" && candidate.currentVersion.trim().length > 0
      ? candidate.currentVersion
      : history[0]?.version ?? "--",
    currentDeployedAt: typeof candidate.currentDeployedAt === "string" && candidate.currentDeployedAt.trim().length > 0
      ? candidate.currentDeployedAt
      : history[0]?.deployedAt ?? "--",
    history,
  };
}

function uniqueHistory(entries: DeploymentHistoryEntry[]): DeploymentHistoryEntry[] {
  const seen = new Set<string>();
  const result: DeploymentHistoryEntry[] = [];

  for (const entry of entries) {
    const key = `${entry.version}::${entry.deployedAt}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(entry);
  }

  return result;
}

function buildSeedEntry(config: AppConfig): DeploymentHistoryEntry | null {
  const version = config.RELEASE_VERSION?.trim();
  const deployedAt = config.RELEASE_DEPLOYED_AT?.trim();
  if (!version || !deployedAt) {
    return null;
  }

  return {
    version,
    deployedAt,
    commitSha: config.RELEASE_COMMIT_SHA?.trim() || version,
    summary: config.RELEASE_SUMMARY?.trim() || "Initial recorded deployment",
  };
}

export class DeploymentHistoryStore {
  private readonly filePath: string;
  private readonly fallbackEnvironment: string;
  private state: DeploymentHistoryState;
  private readonly seedEntry: DeploymentHistoryEntry | null;

  constructor(config: AppConfig) {
    this.filePath = config.BACKOFFICE_DEPLOYMENT_HISTORY_FILE?.trim() || defaultDeploymentHistoryFilePath();
    this.fallbackEnvironment = config.RELEASE_ENV?.trim() || "unknown";
    this.seedEntry = buildSeedEntry(config);
    this.state = {
      ...EMPTY_STATE,
      environment: this.fallbackEnvironment,
    };
  }

  async load(): Promise<void> {
    try {
      const payload = await readFile(this.filePath, "utf8");
      this.state = normalizeState(JSON.parse(payload), this.fallbackEnvironment);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      if (code !== "ENOENT") {
        throw error;
      }
      this.state = {
        ...EMPTY_STATE,
        environment: this.fallbackEnvironment,
      };
    }

    if (this.seedEntry && this.state.history.length === 0) {
      await this.record(this.seedEntry);
    }
  }

  get(): DeploymentHistoryState {
    return {
      environment: this.state.environment,
      currentVersion: this.state.currentVersion,
      currentDeployedAt: this.state.currentDeployedAt,
      history: this.state.history.map((entry) => ({ ...entry })),
    };
  }

  async record(entry: DeploymentHistoryEntry): Promise<DeploymentHistoryState> {
    const history = uniqueHistory([{ ...entry }, ...this.state.history]).slice(0, 100);
    this.state = {
      environment: this.state.environment || this.fallbackEnvironment,
      currentVersion: entry.version,
      currentDeployedAt: entry.deployedAt,
      history,
    };

    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(this.state, null, 2)}\n`, "utf8");
    return this.get();
  }
}