import { mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

import type { AppConfig } from "../config.js";

/** @module auditTrailStore — Append-only JSONL audit log for admin/mutating actions with daily rotation and retention. */

export type AuditEvent = {
  ts: string;
  correlationId: string;
  actor: string;
  ip: string;
  method: string;
  route: string;
  category: string;
  action: string;
  statusCode: number;
  success: boolean;
  durationMs: number;
  requestBytes: number;
};

export type AuditEventInput = Omit<AuditEvent, "ts" | "success">;

type ClassifyResult = { audit: false } | { audit: true; category: string; action: string };

const ADMIN_ROUTE_RULES: Array<{
  test: (method: string, route: string) => boolean;
  category: string;
  action: (method: string, route: string) => string;
}> = [
  {
    test: (method, route) =>
      ["POST", "PUT", "PATCH", "DELETE"].includes(method) &&
      route.startsWith("/v1/backoffice/admin/"),
    category: "admin.users",
    action: (method, route) => `${method} ${route}`,
  },
  {
    test: (method, route) =>
      ["PUT", "DELETE"].includes(method) && route.startsWith("/v1/backoffice/service-targets/"),
    category: "routing.target",
    action: (method, route) => `${method} ${route}`,
  },
  {
    test: (method, route) => route.startsWith("/v1/backoffice/ai-engine/presets"),
    category: "routing.ai-engine.preset",
    action: (method, route) => `${method} ${route}`,
  },
  {
    test: (method, route) =>
      ["PUT", "DELETE", "POST"].includes(method) && route.startsWith("/v1/backoffice/ai-engine/target"),
    category: "routing.ai-engine.target",
    action: (method, route) => `${method} ${route}`,
  },
  {
    test: (method, route) =>
      ["POST", "PATCH", "DELETE"].includes(method) &&
      /^\/v1\/backoffice\/services\/[^/]+\/data/.test(route),
    category: "data.mutation",
    action: (method, route) => `${method} ${route}`,
  },
  {
    test: (method, route) =>
      method === "POST" &&
      /^\/v1\/backoffice\/services\/[^/]+\/generation\//.test(route),
    category: "ai.generation.start",
    action: (method, route) => `${method} ${route}`,
  },
  {
    test: (method, route) => method === "POST" && route === "/v1/backoffice/ai-diagnostics/tests/run",
    category: "ai.diagnostics",
    action: () => "POST /v1/backoffice/ai-diagnostics/tests/run",
  },
  {
    test: (method, route) => method === "POST" && route === "/v1/backoffice/users/events/manual",
    category: "users.events.manual",
    action: () => "POST /v1/backoffice/users/events/manual",
  },
];

/** Classify a route+method to determine if it should be audited and under which category. */
export function classifyAdminAction(method: string, route: string): ClassifyResult {
  for (const rule of ADMIN_ROUTE_RULES) {
    if (rule.test(method, route)) {
      return { audit: true, category: rule.category, action: rule.action(method, route) };
    }
  }
  return { audit: false };
}

function defaultAuditDir(): string {
  return path.resolve(process.cwd(), ".runtime", "audit");
}

function dailyFileName(date: Date): string {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `audit-${yyyy}-${mm}-${dd}.jsonl`;
}

/** Persists audit events to daily-rotated JSONL files with retention enforcement. */
export class AuditTrailStore {
  private readonly enabled: boolean;
  private readonly dir: string;
  private readonly retentionDays: number;
  private writeChain: Promise<void> = Promise.resolve();
  private lastRetentionRun = 0;

  constructor(config: AppConfig) {
    this.enabled = config.AUDIT_TRAIL_ENABLED ?? true;
    this.dir = config.AUDIT_TRAIL_DIR?.trim() || defaultAuditDir();
    this.retentionDays = Math.max(1, config.AUDIT_TRAIL_RETENTION_DAYS ?? 90);
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  directory(): string {
    return this.dir;
  }

  /** Append an audit event, queued to avoid interleaved writes. Errors are swallowed to never block the request. */
  record(input: AuditEventInput, now: Date = new Date()): Promise<void> {
    if (!this.enabled) {
      return Promise.resolve();
    }

    const event: AuditEvent = {
      ts: now.toISOString(),
      success: input.statusCode < 400,
      ...input,
    };

    this.writeChain = this.writeChain.then(() => this.writeEvent(event, now)).catch(() => undefined);
    return this.writeChain;
  }

  /** Read recent events (newest first) across the most recent files, capped by limit. */
  async query(limit = 100): Promise<AuditEvent[]> {
    if (!existsSync(this.dir)) {
      return [];
    }

    const entries = await readdir(this.dir);
    const files = entries.filter((name) => name.startsWith("audit-") && name.endsWith(".jsonl")).sort().reverse();

    const out: AuditEvent[] = [];
    for (const file of files) {
      if (out.length >= limit) {
        break;
      }
      const content = await readFile(path.join(this.dir, file), "utf-8");
      const lines = content.split("\n").filter((line) => line.trim().length > 0).reverse();
      for (const line of lines) {
        if (out.length >= limit) {
          break;
        }
        try {
          out.push(JSON.parse(line) as AuditEvent);
        } catch {
          /* skip malformed lines */
        }
      }
    }

    return out;
  }

  private async writeEvent(event: AuditEvent, now: Date): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const filePath = path.join(this.dir, dailyFileName(now));
    const line = `${JSON.stringify(event)}\n`;
    let existing = "";
    if (existsSync(filePath)) {
      existing = await readFile(filePath, "utf-8");
    }
    await writeFile(filePath, existing + line, "utf-8");

    if (now.getTime() - this.lastRetentionRun > 60_000) {
      this.lastRetentionRun = now.getTime();
      await this.enforceRetention(now);
    }
  }

  private async enforceRetention(now: Date): Promise<void> {
    try {
      const cutoff = now.getTime() - this.retentionDays * 24 * 60 * 60 * 1000;
      const entries = await readdir(this.dir);
      for (const name of entries) {
        if (!name.startsWith("audit-") || !name.endsWith(".jsonl")) {
          continue;
        }
        const filePath = path.join(this.dir, name);
        const stats = await stat(filePath);
        if (stats.mtimeMs < cutoff) {
          await unlink(filePath);
        }
      }
    } catch {
      /* best-effort retention; never block writes */
    }
  }
}

/** Resolves the actor identifier from request headers without storing PII. */
export function resolveActor(headers: Record<string, string | string[] | undefined>): string {
  const directUid = headers["x-firebase-uid"];
  if (typeof directUid === "string" && directUid.trim().length > 0) {
    return directUid.trim().slice(0, 80);
  }
  const auth = headers["authorization"];
  if (typeof auth === "string" && auth.startsWith("Bearer ") && auth.length > 12) {
    const token = auth.slice(7);
    return `bearer:${token.slice(-8)}`;
  }
  return "anonymous";
}
