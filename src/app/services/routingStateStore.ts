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
        if (candidate.version === 2 && typeof parsed.apiPort === "number") {
          presets.push({
            id: parsed.id,
            name: parsed.name,
            host: parsed.host,
            protocol: parsed.protocol,
            port: 7002,
            updatedAt: parsed.updatedAt,
          });
        }
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

  listAiEnginePresets(): PersistedAiEnginePreset[] {
    return this.state.aiEnginePresets.map((entry) => ({ ...entry }));
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

  async setAiEnginePreset(preset: PersistedAiEnginePreset): Promise<void> {
    const nextPresets = this.state.aiEnginePresets.some((entry) => entry.id === preset.id)
      ? this.state.aiEnginePresets.map((entry) => (entry.id === preset.id ? preset : entry))
      : [...this.state.aiEnginePresets, preset];

    this.state = {
      ...this.state,
      aiEnginePresets: nextPresets,
    };
    await this.persist();
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
    await this.persist();
    return true;
  }

  private async persist(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(this.state, null, 2)}\n`, "utf8");
  }
}