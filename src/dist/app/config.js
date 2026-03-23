import { z } from "zod";
const envSchema = z.object({
    SERVICE_NAME: z.string().min(1),
    SERVICE_PORT: z.coerce.number().int().positive(),
    ALLOWED_ORIGINS: z.string().min(1),
    USERS_SERVICE_URL: z.string().url(),
});
export function loadConfig() {
    return envSchema.parse(process.env);
}
