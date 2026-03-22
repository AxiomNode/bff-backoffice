import { z } from "zod";

const envSchema = z.object({
  SERVICE_NAME: z.string().min(1),
  SERVICE_PORT: z.coerce.number().int().positive(),
  ALLOWED_ORIGINS: z.string().min(1),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(): AppConfig {
  return envSchema.parse(process.env);
}
