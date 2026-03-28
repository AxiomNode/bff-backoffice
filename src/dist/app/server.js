import "dotenv/config";
import cors from "@fastify/cors";
import Fastify from "fastify";
import { isUpstreamTimeoutError } from "@axiomnode/shared-sdk-client/proxy";
import { loadConfig } from "./config.js";
import { backofficeRoutes } from "./routes/backoffice.js";
import { healthRoutes } from "./routes/health.js";
import { monitoringRoutes } from "./routes/monitoring.js";
import { ServiceMetrics } from "./services/serviceMetrics.js";
async function buildServer() {
    const config = loadConfig();
    const app = Fastify({ logger: true });
    const metrics = new ServiceMetrics(config);
    const allowedOrigins = config.ALLOWED_ORIGINS.split(",").map((v) => v.trim());
    await app.register(cors, { origin: allowedOrigins });
    app.addHook("onRequest", async (request) => {
        const requestAny = request;
        const contentLength = Number(request.headers["content-length"] ?? 0);
        requestAny._requestBytes = Number.isFinite(contentLength) ? contentLength : 0;
    });
    app.addHook("onResponse", async (request, reply) => {
        const requestAny = request;
        const responseContentLength = Number(reply.getHeader("content-length") ?? 0);
        const responseBytes = Number.isFinite(responseContentLength) ? responseContentLength : 0;
        const route = (request.routeOptions.url ?? request.url.split("?")[0]);
        metrics.recordIncomingRequest({
            method: request.method,
            route,
            statusCode: reply.statusCode,
            requestBytes: requestAny._requestBytes ?? 0,
            responseBytes,
        });
    });
    await healthRoutes(app);
    await monitoringRoutes(app, metrics);
    await backofficeRoutes(app, config, metrics);
    app.setErrorHandler((error, _request, reply) => {
        if (isUpstreamTimeoutError(error)) {
            reply.status(504).send({
                message: "Upstream request timed out",
                error: error instanceof Error ? error.message : "Timeout",
            });
            return;
        }
        reply.send(error);
    });
    return { app, config, metrics };
}
async function main() {
    const { app, config, metrics } = await buildServer();
    await app.listen({ host: "0.0.0.0", port: config.SERVICE_PORT });
    metrics.recordLog("info", "bff_backoffice_started", { port: config.SERVICE_PORT });
    app.log.info({ service: config.SERVICE_NAME }, "BFF backoffice started");
}
main().catch((error) => {
    console.error(error);
    process.exit(1);
});
