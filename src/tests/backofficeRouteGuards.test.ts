import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import {
  getDataDeleteRequestOrReply,
  getDataMutationRequestOrReply,
  getDataUpdateRequestOrReply,
  getConfigurableServiceTargetKeyOrReply,
  getEditableGameServiceOrReply,
  getGenerationProcessesRequestOrReply,
  getGenerationStartRequestOrReply,
  getGenerationTaskRequestOrReply,
  getServiceKeyOrReply,
  isEditableGameService,
} from "../app/routes/backofficeRouteGuards.js";

function createReplyDouble() {
  const state = {
    statusCode: 200,
    payload: undefined as unknown,
  };

  const reply = {
    status(code: number) {
      state.statusCode = code;
      return this;
    },
    send(payload: unknown) {
      state.payload = payload;
      return this;
    },
  };

  return { reply, state };
}

describe("backofficeRouteGuards", () => {
  it("accepts valid service keys and rejects invalid ones", async () => {
    const app = Fastify();

    expect(isEditableGameService("microservice-quiz")).toBe(true);
    expect(isEditableGameService("microservice-wordpass")).toBe(true);
    expect(isEditableGameService("microservice-users")).toBe(false);

    await app.close();
  });

  it("writes 400 responses for invalid service and configurable service keys", async () => {
    const app = Fastify();

    app.get("/service", async (_request, reply) => {
      const service = getServiceKeyOrReply(reply, "not-real");
      if (!service) {
        return;
      }

      return reply.send({ service });
    });

    app.get("/configurable", async (_request, reply) => {
      const service = getConfigurableServiceTargetKeyOrReply(reply, "not-real");
      if (!service) {
        return;
      }

      return reply.send({ service });
    });

    const invalidService = await app.inject({ method: "GET", url: "/service" });
    const invalidConfigurable = await app.inject({ method: "GET", url: "/configurable" });

    expect(invalidService.statusCode).toBe(400);
    expect(invalidService.json()).toEqual({ message: "Invalid service" });
    expect(invalidConfigurable.statusCode).toBe(400);
    expect(invalidConfigurable.json()).toEqual({ message: "Invalid configurable service" });

    await app.close();
  });

  it("writes 400 responses for unsupported editable-game services and returns editable ones", async () => {
    const app = Fastify();

    app.get("/editable/ok", async (_request, reply) => {
      const service = getEditableGameServiceOrReply(reply, "microservice-quiz", "game generation");
      if (!service) {
        return;
      }

      return reply.send({ service });
    });

    app.get("/editable/unsupported", async (_request, reply) => {
      const service = getEditableGameServiceOrReply(reply, "microservice-users", "game generation");
      if (!service) {
        return;
      }

      return reply.send({ service });
    });

    const valid = await app.inject({ method: "GET", url: "/editable/ok" });
    const unsupported = await app.inject({ method: "GET", url: "/editable/unsupported" });

    expect(valid.statusCode).toBe(200);
    expect(valid.json()).toEqual({ service: "microservice-quiz" });
    expect(unsupported.statusCode).toBe(400);
    expect(unsupported.json()).toEqual({
      message: "Service 'microservice-users' does not support game generation",
    });

    await app.close();
  });

  it("validates generation detail params and normalizes includeItems", async () => {
    const app = Fastify();

    app.get("/generation/:service/:taskId", async (request, reply) => {
      const data = getGenerationTaskRequestOrReply(reply, request.params, request.query);
      if (!data) {
        return;
      }

      return reply.send(data);
    });

    const invalidParams = await app.inject({
      method: "GET",
      url: "/generation/microservice-quiz/not-a-uuid?includeItems=false",
    });
    const valid = await app.inject({
      method: "GET",
      url: "/generation/microservice-quiz/550e8400-e29b-41d4-a716-446655440000?includeItems=bad-bool",
    });

    expect(invalidParams.statusCode).toBe(400);
    expect(invalidParams.json()).toMatchObject({ message: "Invalid path parameters" });
    expect(valid.statusCode).toBe(200);
    expect(valid.json()).toEqual({
      service: "microservice-quiz",
      taskId: "550e8400-e29b-41d4-a716-446655440000",
      includeItems: true,
    });

    await app.close();
  });

  it("validates delete requests before resolving editable services", async () => {
    const app = Fastify();

    app.get("/delete/:service/:entryId", async (request, reply) => {
      const data = getDataDeleteRequestOrReply(reply, request.params, request.query);
      if (!data) {
        return;
      }

      return reply.send(data);
    });

    const invalidQuery = await app.inject({
      method: "GET",
      url: "/delete/microservice-quiz/entry-1?dataset=invalid",
    });
    const invalidPath = await app.inject({
      method: "GET",
      url: "/delete/microservice-quiz/%20?dataset=history",
    });
    const unsupported = await app.inject({
      method: "GET",
      url: "/delete/microservice-users/entry-7?dataset=history",
    });
    const valid = await app.inject({
      method: "GET",
      url: "/delete/microservice-wordpass/entry-7?dataset=history",
    });

    expect(invalidQuery.statusCode).toBe(400);
    expect(invalidQuery.json()).toMatchObject({ message: "Invalid query parameters" });
    expect(invalidPath.statusCode).toBe(200);
    expect(invalidPath.json()).toEqual({
      service: "microservice-quiz",
      entryId: " ",
    });
    expect(unsupported.statusCode).toBe(400);
    expect(unsupported.json()).toEqual({
      message: "Service 'microservice-users' does not support manual data deletion",
    });
    expect(valid.statusCode).toBe(200);
    expect(valid.json()).toEqual({
      service: "microservice-wordpass",
      entryId: "entry-7",
    });

    await app.close();
  });

  it("validates manual insert and update payloads through the shared helpers", async () => {
    const app = Fastify();

    app.post("/mutation/:service", async (request, reply) => {
      const data = getDataMutationRequestOrReply(reply, request.params, request.body);
      if (!data) {
        return;
      }

      return reply.send(data);
    });

    app.patch("/update/:service/:entryId", async (request, reply) => {
      const data = getDataUpdateRequestOrReply(reply, request.params, request.body);
      if (!data) {
        return;
      }

      return reply.send(data);
    });

    const invalidInsert = await app.inject({
      method: "POST",
      url: "/mutation/microservice-quiz",
      payload: {},
    });
    const validInsert = await app.inject({
      method: "POST",
      url: "/mutation/microservice-wordpass",
      payload: {
        dataset: "history",
        categoryId: "11",
        language: "es",
        difficultyPercentage: 55,
        content: { question: "Q" },
      },
    });
    const unsupportedUpdate = await app.inject({
      method: "PATCH",
      url: "/update/microservice-users/entry-1",
      payload: {
        dataset: "history",
        status: "pending_review",
      },
    });
    const validUpdate = await app.inject({
      method: "PATCH",
      url: "/update/microservice-quiz/entry-2",
      payload: {
        dataset: "history",
        status: "validated",
      },
    });

    expect(invalidInsert.statusCode).toBe(400);
    expect(invalidInsert.json()).toMatchObject({ message: "Invalid payload" });
    expect(validInsert.statusCode).toBe(200);
    expect(validInsert.json()).toEqual({
      service: "microservice-wordpass",
      payload: {
        dataset: "history",
        categoryId: "11",
        language: "es",
        difficultyPercentage: 55,
        content: { question: "Q" },
        status: "manual",
      },
    });
    expect(unsupportedUpdate.statusCode).toBe(400);
    expect(unsupportedUpdate.json()).toEqual({
      message: "Service 'microservice-users' does not support manual data updates",
    });
    expect(validUpdate.statusCode).toBe(200);
    expect(validUpdate.json()).toEqual({
      service: "microservice-quiz",
      entryId: "entry-2",
      payload: {
        dataset: "history",
        status: "validated",
      },
    });

    await app.close();
  });

  it("validates generation start and process list requests through the shared helpers", async () => {
    const app = Fastify();

    app.post("/generation-start/:service", async (request, reply) => {
      const data = getGenerationStartRequestOrReply(reply, request.params, request.body);
      if (!data) {
        return;
      }

      return reply.send(data);
    });

    app.get("/generation-processes/:service", async (request, reply) => {
      const data = getGenerationProcessesRequestOrReply(reply, request.params, request.query);
      if (!data) {
        return;
      }

      return reply.send(data);
    });

    const invalidStart = await app.inject({
      method: "POST",
      url: "/generation-start/microservice-quiz",
      payload: {},
    });
    const validStart = await app.inject({
      method: "POST",
      url: "/generation-start/microservice-wordpass",
      payload: {
        categoryId: "11",
        language: "es",
        numQuestions: 6,
      },
    });
    const invalidProcesses = await app.inject({
      method: "GET",
      url: "/generation-processes/microservice-quiz?limit=0",
    });
    const unsupportedStart = await app.inject({
      method: "POST",
      url: "/generation-start/microservice-users",
      payload: {
        categoryId: "11",
        language: "es",
      },
    });
    const unsupportedProcesses = await app.inject({
      method: "GET",
      url: "/generation-processes/microservice-users?limit=25",
    });
    const validProcesses = await app.inject({
      method: "GET",
      url: "/generation-processes/microservice-quiz?limit=25&status=running&requestedBy=backoffice",
    });

    expect(invalidStart.statusCode).toBe(400);
    expect(invalidStart.json()).toMatchObject({ message: "Invalid payload" });
    expect(validStart.statusCode).toBe(200);
    expect(validStart.json()).toEqual({
      service: "microservice-wordpass",
      payload: {
        categoryId: "11",
        language: "es",
        numQuestions: 6,
        count: 10,
      },
    });
    expect(invalidProcesses.statusCode).toBe(400);
    expect(invalidProcesses.json()).toMatchObject({ message: "Invalid query parameters" });
    expect(unsupportedStart.statusCode).toBe(400);
    expect(unsupportedStart.json()).toEqual({
      message: "Service 'microservice-users' does not support game generation",
    });
    expect(unsupportedProcesses.statusCode).toBe(400);
    expect(unsupportedProcesses.json()).toEqual({
      message: "Service 'microservice-users' does not support game generation",
    });
    expect(validProcesses.statusCode).toBe(200);
    expect(validProcesses.json()).toEqual({
      service: "microservice-quiz",
      limit: 25,
      status: "running",
      requestedBy: "backoffice",
    });

    await app.close();
  });

  it("rejects invalid path params in update and delete helpers even outside Fastify routing", () => {
    const update = createReplyDouble();
    const updateResult = getDataUpdateRequestOrReply(update.reply as never, {}, {
      dataset: "history",
      status: "validated",
    });

    const deletion = createReplyDouble();
    const deleteResult = getDataDeleteRequestOrReply(deletion.reply as never, {}, {
      dataset: "history",
    });

    expect(updateResult).toBeNull();
    expect(update.state.statusCode).toBe(400);
    expect(update.state.payload).toMatchObject({ message: "Invalid path parameters" });
    expect(deleteResult).toBeNull();
    expect(deletion.state.statusCode).toBe(400);
    expect(deletion.state.payload).toMatchObject({ message: "Invalid path parameters" });
  });
});