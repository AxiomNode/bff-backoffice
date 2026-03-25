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
    METRICS_LOG_BUFFER_SIZE: z.coerce.number().int().min(50).max(5000).default(1000),
});
export function loadConfig() {
    return envSchema.parse(process.env);
}
