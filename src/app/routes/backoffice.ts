import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { LeaderboardQuerySchema } from "@axiomnode/shared-sdk-client/contracts";
import { buildUrl, forwardHttp } from "@axiomnode/shared-sdk-client/proxy";

import type { AppConfig } from "../config.js";

async function forwardGet(request: FastifyRequest, reply: FastifyReply, targetUrl: string): Promise<void> {
  const result = await forwardHttp({
    targetUrl,
    method: "GET",
    requestHeaders: request.headers as Record<string, string | undefined>,
  });

  reply.code(result.status);
  reply.header("content-type", result.contentType);
  reply.send(result.payload);
}

export async function backofficeRoutes(app: FastifyInstance, config: AppConfig): Promise<void> {
  app.get("/v1/backoffice/users/leaderboard", async (request, reply) => {
    const query = LeaderboardQuerySchema.parse(request.query);
    const url = buildUrl(config.USERS_SERVICE_URL, "/users/leaderboard", query);
    await forwardGet(request, reply, url);
  });

  app.get("/v1/backoffice/monitor/stats", async (request, reply) => {
    const url = buildUrl(config.USERS_SERVICE_URL, "/monitor/stats", request.query as Record<string, unknown>);
    await forwardGet(request, reply, url);
  });
}
