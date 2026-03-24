import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { LeaderboardQuerySchema } from "@axiomnode/shared-sdk-client/contracts";
import { buildUrl, forwardHttp } from "@axiomnode/shared-sdk-client/proxy";

import type { AppConfig } from "../config.js";

async function forwardRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  targetUrl: string,
  method: "GET" | "POST" | "PATCH",
  body?: unknown,
): Promise<void> {
  const idTokenHeader = request.headers["x-firebase-id-token"];
  const normalizedHeaders: Record<string, string | undefined> = {
    ...(request.headers as Record<string, string | undefined>),
    authorization:
      typeof idTokenHeader === "string" && idTokenHeader.length > 0
        ? `Bearer ${idTokenHeader}`
        : request.headers.authorization,
  };

  const result = await forwardHttp({
    targetUrl,
    method,
    requestHeaders: normalizedHeaders,
    body,
  });

  reply.code(result.status);
  reply.header("content-type", result.contentType);
  reply.send(result.payload);
}

export async function backofficeRoutes(app: FastifyInstance, config: AppConfig): Promise<void> {
  app.post("/v1/backoffice/auth/session", async (request, reply) => {
    const url = buildUrl(config.USERS_SERVICE_URL, "/users/firebase/session", {});
    await forwardRequest(request, reply, url, "POST", request.body);
  });

  app.get("/v1/backoffice/auth/me", async (request, reply) => {
    const url = buildUrl(config.USERS_SERVICE_URL, "/users/me/profile", {});
    await forwardRequest(request, reply, url, "GET");
  });

  app.get("/v1/backoffice/users/leaderboard", async (request, reply) => {
    const query = LeaderboardQuerySchema.parse(request.query);
    const url = buildUrl(config.USERS_SERVICE_URL, "/users/leaderboard", query);
    await forwardRequest(request, reply, url, "GET");
  });

  app.get("/v1/backoffice/monitor/stats", async (request, reply) => {
    const url = buildUrl(config.USERS_SERVICE_URL, "/monitor/stats", request.query as Record<string, unknown>);
    await forwardRequest(request, reply, url, "GET");
  });

  app.post("/v1/backoffice/users/events/manual", async (request, reply) => {
    const url = buildUrl(config.USERS_SERVICE_URL, "/users/me/games/events", {});
    await forwardRequest(request, reply, url, "POST", request.body);
  });

  app.get("/v1/backoffice/admin/users/roles", async (request, reply) => {
    const url = buildUrl(config.USERS_SERVICE_URL, "/users/admin/roles", {});
    await forwardRequest(request, reply, url, "GET");
  });

  app.patch("/v1/backoffice/admin/users/roles/:firebaseUid", async (request, reply) => {
    const params = request.params as { firebaseUid: string };
    const url = buildUrl(
      config.USERS_SERVICE_URL,
      `/users/admin/roles/${encodeURIComponent(params.firebaseUid)}`,
      {},
    );
    await forwardRequest(request, reply, url, "PATCH", request.body);
  });
}
