import { z } from "zod";

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
  UPSTREAM_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(15000),
  AI_ENGINE_BRIDGE_API_KEY: z.string().optional(),
  AI_ENGINE_API_KEY: z.string().optional(),
  METRICS_LOG_BUFFER_SIZE: z.coerce.number().int().min(50).max(5000).default(1000),
});

type ParsedConfig = z.infer<typeof envSchema>;

export type AppConfig = Omit<
  ParsedConfig,
  | "QUIZZ_SERVICE_URL"
  | "WORDPASS_SERVICE_URL"
  | "BFF_MOBILE_URL"
  | "API_GATEWAY_URL"
  | "AI_ENGINE_STATS_URL"
  | "AI_ENGINE_API_URL"
  | "UPSTREAM_TIMEOUT_MS"
  | "AI_ENGINE_BRIDGE_API_KEY"
  | "AI_ENGINE_API_KEY"
  | "METRICS_LOG_BUFFER_SIZE"
> & {
  QUIZZ_SERVICE_URL?: string;
  WORDPASS_SERVICE_URL?: string;
  BFF_MOBILE_URL?: string;
  API_GATEWAY_URL?: string;
  AI_ENGINE_STATS_URL?: string;
  AI_ENGINE_API_URL?: string;
  UPSTREAM_TIMEOUT_MS?: number;
  AI_ENGINE_BRIDGE_API_KEY?: string;
  AI_ENGINE_API_KEY?: string;
  METRICS_LOG_BUFFER_SIZE?: number;
};

export function loadConfig(): AppConfig {
  return envSchema.parse(process.env);
}
