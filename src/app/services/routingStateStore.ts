import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { AppConfig } from "../config.js";

export type PersistedRoutingServiceKey =
  | "api-gateway"
  | "bff-mobile"
  | "microservice-users"
  | "microservice-quiz"
  | "microservice-wordpass"
  | "ai-engine-stats"
  | "ai-engine-api";

export type PersistedRoutingOverride = {
  baseUrl: string;
  label?: string;
  updatedAt: string;
};

type PersistedRoutingState = {
  version: 1;
  overrides: Partial<Record<PersistedRoutingServiceKey, PersistedRoutingOverride>>;
};

const EMPTY_STATE: PersistedRoutingState = {
  version: 1,
  overrides: {},
};

function defaultStateFilePath(): string {
  return path.resolve(process.cwd(), ".runtime", "backoffice-routing-state.json");
}

function normalizeState(raw: unknown): PersistedRoutingState {
  if (!raw || typeof raw !== "object") {
    return { ...EMPTY_STATE };
  }

  const candidate = raw as { version?: unknown; overrides?: unknown };
  if (candidate.version !== 1 || !candidate.overrides || typeof candidate.overrides !== "object") {
    return { ...EMPTY_STATE };
  }

  const overrides: PersistedRoutingState["overrides"] = {};
  for (const [service, value] of Object.entries(candidate.overrides)) {
    if (!value || typeof value !== "object") {
      continue;
    }

    const parsed = value as { baseUrl?: unknown; label?: unknown; updatedAt?: unknown };
    if (typeof parsed.baseUrl !== "string" || typeof parsed.updatedAt !== "string") {
      continue;
    }

    overrides[service as PersistedRoutingServiceKey] = {
      baseUrl: parsed.baseUrl,
      label: typeof parsed.label === "string" ? parsed.label : undefined,
      updatedAt: parsed.updatedAt,
    };
  }

  return {
    version: 1,
    overrides,
  };
}

export class RoutingStateStore {
  private state: PersistedRoutingState = { ...EMPTY_STATE };
  private readonly filePath: string;

  constructor(config: AppConfig) {
    this.filePath = config.BACKOFFICE_ROUTING_STATE_FILE?.trim() || defaultStateFilePath();
  }

  async load(): Promise<void> {
    try {
      const payload = await readFile(this.filePath, "utf8");
      this.state = normalizeState(JSON.parse(payload));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      if (code !== "ENOENT") {
        throw error;
      }
      this.state = { ...EMPTY_STATE };
    }
  }

  get(service: PersistedRoutingServiceKey): PersistedRoutingOverride | null {
    return this.state.overrides[service] ?? null;
  }

  list(): Partial<Record<PersistedRoutingServiceKey, PersistedRoutingOverride>> {
    return { ...this.state.overrides };
  }

  async set(service: PersistedRoutingServiceKey, override: PersistedRoutingOverride): Promise<void> {
    this.state = {
      ...this.state,
      overrides: {
        ...this.state.overrides,
        [service]: override,
      },
    };
    await this.persist();
  }

  async delete(service: PersistedRoutingServiceKey): Promise<void> {
    const nextOverrides = { ...this.state.overrides };
    delete nextOverrides[service];
    this.state = {
      ...this.state,
      overrides: nextOverrides,
    };
    await this.persist();
  }

  private async persist(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(this.state, null, 2)}\n`, "utf8");
  }
}