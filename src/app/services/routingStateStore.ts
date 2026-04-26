import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
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

export type PersistedAiEnginePreset = {
  id: string;
  name: string;
  host: string;
  protocol: "http" | "https";
  port: number;
  updatedAt: string;
};

type PersistedRoutingState = {
  version: 3;
  overrides: Partial<Record<PersistedRoutingServiceKey, PersistedRoutingOverride>>;
  aiEnginePresets: PersistedAiEnginePreset[];
};

export type PersistedRoutingHistoryEntry = {
  recordedAt: string;
  action:
    | "service-target-set"
    | "service-target-delete"
    | "ai-engine-preset-set"
    | "ai-engine-preset-delete";
  service?: PersistedRoutingServiceKey;
  presetId?: string;
  state: PersistedRoutingState;
};

const DEFAULT_AI_ENGINE_PRESETS: PersistedAiEnginePreset[] = [
  {
    id: "this-pc-lan",
    name: "Este PC (192.168.0.14)",
    host: "192.168.0.14",
    protocol: "http",
    port: 7002,
    updatedAt: "2026-04-19T00:00:00.000Z",
  },
  {
    id: "workstation-public",
    name: "Workstation publica (195.35.48.40)",
    host: "195.35.48.40",
    protocol: "http",
    port: 7002,
    updatedAt: "2026-04-19T00:00:00.000Z",
  },
];

const EMPTY_STATE: PersistedRoutingState = {
  version: 3,
  overrides: {},
  aiEnginePresets: DEFAULT_AI_ENGINE_PRESETS.map((entry) => ({ ...entry })),
};

function defaultStateFilePath(): string {
  return path.resolve(process.cwd(), ".runtime", "backoffice-routing-state.json");
}

function defaultHistoryFilePath(): string {
  return path.resolve(process.cwd(), ".runtime", "backoffice-routing-history.jsonl");
}

function buildHistoryFilePath(stateFilePath: string): string {
  const parsed = path.parse(stateFilePath);
  if (!parsed.dir) {
    return defaultHistoryFilePath();
  }
  return path.join(parsed.dir, `${parsed.name}.history.jsonl`);
}

function normalizeState(raw: unknown): PersistedRoutingState {
  if (!raw || typeof raw !== "object") {
    return { ...EMPTY_STATE };
  }

  const candidate = raw as { version?: unknown; overrides?: unknown; aiEnginePresets?: unknown };
  if ((candidate.version !== 1 && candidate.version !== 2 && candidate.version !== 3) || !candidate.overrides || typeof candidate.overrides !== "object") {
    return { ...EMPTY_STATE };
  }

  const overrides: PersistedRoutingState["overrides"] = {};
  for (const [service, value] of Object.entries(candidate.overrides)) {
    if (service === "ai-engine-api" || service === "ai-engine-stats") {
      continue;
    }

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

  const presets: PersistedAiEnginePreset[] = [];
  if (Array.isArray(candidate.aiEnginePresets)) {
    for (const value of candidate.aiEnginePresets) {
      if (!value || typeof value !== "object") {
        continue;
      }

      const parsed = value as Record<string, unknown>;
      if (
        typeof parsed.id !== "string" ||
        typeof parsed.name !== "string" ||
        typeof parsed.host !== "string" ||
        (parsed.protocol !== "http" && parsed.protocol !== "https") ||
        typeof parsed.updatedAt !== "string"
      ) {
        continue;
      }

      if (candidate.version === 2 && typeof parsed.apiPort === "number") {
        presets.push({
          id: parsed.id,
          name: parsed.name,
          host: parsed.host,
          protocol: parsed.protocol,
          port: parsed.apiPort,
          updatedAt: parsed.updatedAt,
        });
        continue;
      }

      presets.push({
        id: parsed.id,
        name: parsed.name,
        host: parsed.host,
        protocol: parsed.protocol,
        port: typeof parsed.port === "number" ? parsed.port : 7002,
        updatedAt: parsed.updatedAt,
      });
    }
  }

  return {
    version: 3,
    overrides,
    aiEnginePresets: candidate.version === 1 ? DEFAULT_AI_ENGINE_PRESETS.map((entry) => ({ ...entry })) : (presets.length > 0 ? presets : DEFAULT_AI_ENGINE_PRESETS.map((entry) => ({ ...entry }))),
  };
}

export class RoutingStateStore {
  private state: PersistedRoutingState = { ...EMPTY_STATE };
  private readonly filePath: string;
  private readonly historyFilePath: string;

  constructor(config: AppConfig) {
    this.filePath = config.BACKOFFICE_ROUTING_STATE_FILE?.trim() || defaultStateFilePath();
    this.historyFilePath = buildHistoryFilePath(this.filePath);
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

  listAiEnginePresets(): PersistedAiEnginePreset[] {
    return this.state.aiEnginePresets.map((entry) => ({ ...entry }));
  }

  async listHistory(limit = 20): Promise<PersistedRoutingHistoryEntry[]> {
    const normalizedLimit = Number.isInteger(limit) ? Math.max(1, Math.min(limit, 200)) : 20;

    try {
      const payload = await readFile(this.historyFilePath, "utf8");
      const entries = payload
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => normalizeHistoryEntry(JSON.parse(line)))
        .filter((entry): entry is PersistedRoutingHistoryEntry => entry !== null);

      return entries.slice(-normalizedLimit).reverse();
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      if (code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  async set(service: PersistedRoutingServiceKey, override: PersistedRoutingOverride): Promise<void> {
    this.state = {
      ...this.state,
      overrides: {
        ...this.state.overrides,
        [service]: override,
      },
    };
    await this.persist({ action: "service-target-set", service });
  }

  async delete(service: PersistedRoutingServiceKey): Promise<void> {
    const nextOverrides = { ...this.state.overrides };
    delete nextOverrides[service];
    this.state = {
      ...this.state,
      overrides: nextOverrides,
    };
    await this.persist({ action: "service-target-delete", service });
  }

  async setAiEnginePreset(preset: PersistedAiEnginePreset): Promise<void> {
    const nextPresets = this.state.aiEnginePresets.some((entry) => entry.id === preset.id)
      ? this.state.aiEnginePresets.map((entry) => (entry.id === preset.id ? preset : entry))
      : [...this.state.aiEnginePresets, preset];

    this.state = {
      ...this.state,
      aiEnginePresets: nextPresets,
    };
    await this.persist({ action: "ai-engine-preset-set", presetId: preset.id });
  }

  async deleteAiEnginePreset(id: string): Promise<boolean> {
    const nextPresets = this.state.aiEnginePresets.filter((entry) => entry.id !== id);
    if (nextPresets.length === this.state.aiEnginePresets.length) {
      return false;
    }

    this.state = {
      ...this.state,
      aiEnginePresets: nextPresets,
    };
    await this.persist({ action: "ai-engine-preset-delete", presetId: id });
    return true;
  }

  private async persist(change: Omit<PersistedRoutingHistoryEntry, "recordedAt" | "state">): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(this.state, null, 2)}\n`, "utf8");

    const entry: PersistedRoutingHistoryEntry = {
      recordedAt: new Date().toISOString(),
      ...change,
      state: cloneState(this.state),
    };
    await appendFile(this.historyFilePath, `${JSON.stringify(entry)}\n`, "utf8");
  }
}

function cloneState(state: PersistedRoutingState): PersistedRoutingState {
  return {
    version: 3,
    overrides: Object.fromEntries(
      Object.entries(state.overrides).map(([service, override]) => [
        service,
        override ? { ...override } : override,
      ]),
    ) as PersistedRoutingState["overrides"],
    aiEnginePresets: state.aiEnginePresets.map((entry) => ({ ...entry })),
  };
}

function normalizeHistoryEntry(raw: unknown): PersistedRoutingHistoryEntry | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const candidate = raw as {
    recordedAt?: unknown;
    action?: unknown;
    service?: unknown;
    presetId?: unknown;
    state?: unknown;
  };

  if (
    typeof candidate.recordedAt !== "string" ||
    (candidate.action !== "service-target-set" &&
      candidate.action !== "service-target-delete" &&
      candidate.action !== "ai-engine-preset-set" &&
      candidate.action !== "ai-engine-preset-delete")
  ) {
    return null;
  }

  return {
    recordedAt: candidate.recordedAt,
    action: candidate.action,
    service:
      typeof candidate.service === "string"
        ? (candidate.service as PersistedRoutingServiceKey)
        : undefined,
    presetId: typeof candidate.presetId === "string" ? candidate.presetId : undefined,
    state: normalizeState(candidate.state),
  };
}