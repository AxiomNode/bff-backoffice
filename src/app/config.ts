import { z } from "zod";

/** @module config — Environment-based configuration loader for the BFF-Backoffice service. */

const envSchema = z.object({
  SERVICE_NAME: z.string().min(1),
  SERVICE_PORT: z.coerce.number().int().positive(),
  ALLOWED_ORIGINS: z.string().min(1),
  USERS_SERVICE_URL: z.string().url(),
  QUIZZ_SERVICE_URL: z.string().url().default("http://localhost:7100"),
  WORDPASS_SERVICE_URL: z.string().url().default("http://localhost:7101"),
  BFF_MOBILE_URL: z.string().url().default("http://localhost:7010"),
  API_GATEWAY_URL: z.string().url().default("http://localhost:7005"),
  AI_ENGINE_STATS_URL: z.string().url().default("http://localhost:7000"),
  AI_ENGINE_API_URL: z.string().url().default("http://localhost:7001"),
  BACKOFFICE_DEPLOYMENT_HISTORY_FILE: z.string().min(1).optional(),
  RELEASE_ENV: z.string().min(1).optional(),
  RELEASE_VERSION: z.string().min(1).optional(),
  RELEASE_DEPLOYED_AT: z.string().min(1).optional(),
  RELEASE_COMMIT_SHA: z.string().min(1).optional(),
  RELEASE_SUMMARY: z.string().min(1).optional(),
  KUBERNETES_API_URL: z.string().url().optional(),
  KUBERNETES_NAMESPACE: z.string().min(1).optional(),
  KUBERNETES_TOKEN_FILE: z.string().min(1).optional(),
  KUBERNETES_CA_FILE: z.string().min(1).optional(),
  KUBERNETES_NAMESPACE_FILE: z.string().min(1).optional(),
  KUBERNETES_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(500).max(120000).default(5000),
  KUBERNETES_OBSERVABILITY_ENABLED: z
    .string()
    .optional()
    .transform((value) => (value === undefined ? true : value.toLowerCase() !== "false")),
  UPSTREAM_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(15000),
  UPSTREAM_OPERATIONAL_SUMMARY_TIMEOUT_MS: z.coerce.number().int().min(250).max(120000).default(3000),
  UPSTREAM_METRICS_CACHE_TTL_MS: z.coerce.number().int().min(0).max(60000).default(5000),
  UPSTREAM_CATALOGS_CACHE_TTL_MS: z.coerce.number().int().min(0).max(600000).default(60000),
  UPSTREAM_CIRCUIT_FAILURE_THRESHOLD: z.coerce.number().int().min(1).max(20).default(3),
  UPSTREAM_CIRCUIT_RESET_TIMEOUT_MS: z.coerce.number().int().min(1000).max(600000).default(30000),
  AI_ENGINE_BRIDGE_API_KEY: z.string().optional(),
  AI_ENGINE_API_KEY: z.string().optional(),
  API_GATEWAY_ADMIN_TOKEN: z.string().optional(),
  METRICS_LOG_BUFFER_SIZE: z.coerce.number().int().min(50).max(5000).default(1000),
  BACKOFFICE_ROUTING_STATE_FILE: z.string().min(1).optional(),
  ALLOWED_ROUTING_TARGET_HOSTS: z.string().min(1).optional(),
  AUDIT_TRAIL_ENABLED: z
    .string()
    .optional()
    .transform((value) => (value === undefined ? true : value.toLowerCase() !== "false")),
  AUDIT_TRAIL_DIR: z.string().min(1).optional(),
  AUDIT_TRAIL_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(90),
});

type ParsedConfig = z.infer<typeof envSchema>;

/** Application configuration type with optional override fields. */
export type AppConfig = Omit<
  ParsedConfig,
  | "QUIZZ_SERVICE_URL"
  | "WORDPASS_SERVICE_URL"
  | "BFF_MOBILE_URL"
  | "API_GATEWAY_URL"
  | "AI_ENGINE_STATS_URL"
  | "AI_ENGINE_API_URL"
  | "BACKOFFICE_DEPLOYMENT_HISTORY_FILE"
  | "RELEASE_ENV"
  | "RELEASE_VERSION"
  | "RELEASE_DEPLOYED_AT"
  | "RELEASE_COMMIT_SHA"
  | "RELEASE_SUMMARY"
  | "KUBERNETES_API_URL"
  | "KUBERNETES_NAMESPACE"
  | "KUBERNETES_TOKEN_FILE"
  | "KUBERNETES_CA_FILE"
  | "KUBERNETES_NAMESPACE_FILE"
  | "KUBERNETES_REQUEST_TIMEOUT_MS"
  | "KUBERNETES_OBSERVABILITY_ENABLED"
  | "UPSTREAM_TIMEOUT_MS"
  | "UPSTREAM_OPERATIONAL_SUMMARY_TIMEOUT_MS"
  | "UPSTREAM_METRICS_CACHE_TTL_MS"
  | "UPSTREAM_CATALOGS_CACHE_TTL_MS"
  | "UPSTREAM_CIRCUIT_FAILURE_THRESHOLD"
  | "UPSTREAM_CIRCUIT_RESET_TIMEOUT_MS"
  | "AI_ENGINE_BRIDGE_API_KEY"
  | "AI_ENGINE_API_KEY"
  | "API_GATEWAY_ADMIN_TOKEN"
  | "METRICS_LOG_BUFFER_SIZE"
  | "BACKOFFICE_ROUTING_STATE_FILE"
  | "ALLOWED_ROUTING_TARGET_HOSTS"
  | "AUDIT_TRAIL_ENABLED"
  | "AUDIT_TRAIL_DIR"
  | "AUDIT_TRAIL_RETENTION_DAYS"
> & {
  QUIZZ_SERVICE_URL?: string;
  WORDPASS_SERVICE_URL?: string;
  BFF_MOBILE_URL?: string;
  API_GATEWAY_URL?: string;
  AI_ENGINE_STATS_URL?: string;
  AI_ENGINE_API_URL?: string;
  BACKOFFICE_DEPLOYMENT_HISTORY_FILE?: string;
  RELEASE_ENV?: string;
  RELEASE_VERSION?: string;
  RELEASE_DEPLOYED_AT?: string;
  RELEASE_COMMIT_SHA?: string;
  RELEASE_SUMMARY?: string;
  KUBERNETES_API_URL?: string;
  KUBERNETES_NAMESPACE?: string;
  KUBERNETES_TOKEN_FILE?: string;
  KUBERNETES_CA_FILE?: string;
  KUBERNETES_NAMESPACE_FILE?: string;
  KUBERNETES_REQUEST_TIMEOUT_MS?: number;
  KUBERNETES_OBSERVABILITY_ENABLED?: boolean;
  UPSTREAM_TIMEOUT_MS?: number;
  UPSTREAM_OPERATIONAL_SUMMARY_TIMEOUT_MS?: number;
  UPSTREAM_METRICS_CACHE_TTL_MS?: number;
  UPSTREAM_CATALOGS_CACHE_TTL_MS?: number;
  UPSTREAM_CIRCUIT_FAILURE_THRESHOLD?: number;
  UPSTREAM_CIRCUIT_RESET_TIMEOUT_MS?: number;
  AI_ENGINE_BRIDGE_API_KEY?: string;
  AI_ENGINE_API_KEY?: string;
  API_GATEWAY_ADMIN_TOKEN?: string;
  METRICS_LOG_BUFFER_SIZE?: number;
  BACKOFFICE_ROUTING_STATE_FILE?: string;
  ALLOWED_ROUTING_TARGET_HOSTS?: string;
  AUDIT_TRAIL_ENABLED?: boolean;
  AUDIT_TRAIL_DIR?: string;
  AUDIT_TRAIL_RETENTION_DAYS?: number;
};

/** Parses and validates environment variables into a typed config object. */
export function loadConfig(): AppConfig {
  return envSchema.parse(process.env);
}
