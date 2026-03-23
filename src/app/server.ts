import "dotenv/config";

import cors from "@fastify/cors";
import Fastify from "fastify";

import { loadConfig } from "./config.js";
import { backofficeRoutes } from "./routes/backoffice.js";
import { healthRoutes } from "./routes/health.js";

async function buildServer() {
  const config = loadConfig();
  const app = Fastify({ logger: true });

  const allowedOrigins = config.ALLOWED_ORIGINS.split(",").map((v) => v.trim());
  await app.register(cors, { origin: allowedOrigins });

  await healthRoutes(app);
  await backofficeRoutes(app, config);

  return { app, config };
}

async function main() {
  const { app, config } = await buildServer();
  await app.listen({ host: "0.0.0.0", port: config.SERVICE_PORT });
  app.log.info({ service: config.SERVICE_NAME }, "BFF backoffice started");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
