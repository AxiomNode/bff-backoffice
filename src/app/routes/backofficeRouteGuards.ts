import type { FastifyReply } from "fastify";
import { z } from "zod";

export type ServiceKey =
  | "api-gateway"
  | "bff-backoffice"
  | "bff-mobile"
  | "microservice-users"
  | "microservice-quiz"
  | "microservice-wordpass"
  | "ai-engine-stats"
  | "ai-engine-api";

export type ConfigurableServiceTargetKey =
  | "api-gateway"
  | "bff-mobile"
  | "microservice-users"
  | "microservice-quiz"
  | "microservice-wordpass"
  | "ai-engine-stats"
  | "ai-engine-api";

export type EditableGameService = "microservice-quiz" | "microservice-wordpass";

const DataDeleteQuerySchema = z.object({
  dataset: z.literal("history"),
});

const DataMutationSchema = z.object({
  dataset: z.literal("history"),
  categoryId: z.string().min(1),
  language: z.string().min(2).max(5),
  difficultyPercentage: z.coerce.number().int().min(0).max(100),
  content: z.record(z.unknown()).refine((value) => Object.keys(value).length > 0, {
    message: "content must include at least one field",
  }),
  status: z.enum(["manual", "validated", "pending_review"]).default("manual"),
});

const DataUpdateSchema = z.object({
  dataset: z.literal("history"),
  categoryId: z.string().min(1).optional(),
  language: z.string().min(2).max(5).optional(),
  difficultyPercentage: z.coerce.number().int().min(0).max(100).optional(),
  content: z.record(z.unknown()).refine((value) => Object.keys(value).length > 0, {
    message: "content must include at least one field",
  }).optional(),
  status: z.enum(["manual", "validated", "pending_review"]).optional(),
}).refine((value) => Object.keys(value).some((key) => key !== "dataset"), {
  message: "At least one editable field is required",
});

const EntryIdParamsSchema = z.object({
  entryId: z.string().min(1),
});

const GenerationTaskParamsSchema = z.object({
  taskId: z.string().uuid(),
});

const GenerationTaskQuerySchema = z.object({
  includeItems: z.coerce.boolean().default(false),
});

const GenerationProcessStartSchema = z.object({
  categoryId: z.string().min(1),
  language: z.string().min(2).max(5),
  difficultyPercentage: z.coerce.number().int().min(0).max(100).optional(),
  itemCount: z.coerce.number().int().min(1).max(50).optional(),
  numQuestions: z.coerce.number().int().min(1).max(50).optional(),
  letters: z.string().optional(),
  count: z.coerce.number().int().min(1).max(100).default(10),
});

const GenerationWorkerStartSchema = z.object({
  countPerIteration: z.coerce.number().int().min(1).max(200).default(10),
  categoryIds: z.array(z.string().min(1)).max(500).optional(),
  difficultyLevels: z.array(z.enum(["easy", "medium", "hard"]))
    .max(3)
    .optional(),
});

const GenerationProcessesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  status: z.enum(["running", "completed", "failed"]).optional(),
  requestedBy: z.enum(["api", "backoffice"]).optional(),
});

export type DataMutationPayload = z.infer<typeof DataMutationSchema>;
export type DataUpdatePayload = z.infer<typeof DataUpdateSchema>;
export type GenerationProcessStartPayload = z.infer<typeof GenerationProcessStartSchema>;
export type GenerationWorkerStartPayload = z.infer<typeof GenerationWorkerStartSchema>;
export type GenerationProcessesPayload = z.infer<typeof GenerationProcessesQuerySchema>;

export const ServiceKeySchema = z.enum([
  "api-gateway",
  "bff-backoffice",
  "bff-mobile",
  "microservice-users",
  "microservice-quiz",
  "microservice-wordpass",
  "ai-engine-stats",
  "ai-engine-api",
]);

export const ConfigurableServiceTargetKeySchema = z.enum([
  "api-gateway",
  "bff-mobile",
  "microservice-users",
  "microservice-quiz",
  "microservice-wordpass",
  "ai-engine-stats",
  "ai-engine-api",
]);

export const CONFIGURABLE_SERVICE_TARGET_KEYS: ConfigurableServiceTargetKey[] = [
  "api-gateway",
  "bff-mobile",
  "microservice-users",
  "microservice-quiz",
  "microservice-wordpass",
  "ai-engine-stats",
  "ai-engine-api",
];

export function isEditableGameService(service: ServiceKey): service is EditableGameService {
  return service === "microservice-quiz" || service === "microservice-wordpass";
}

export function getServiceKeyOrReply(reply: FastifyReply, rawService: unknown): ServiceKey | null {
  const parsed = ServiceKeySchema.safeParse(rawService);
  if (!parsed.success) {
    reply.status(400).send({ message: "Invalid service" });
    return null;
  }

  return parsed.data;
}

export function getConfigurableServiceTargetKeyOrReply(
  reply: FastifyReply,
  rawService: unknown,
): ConfigurableServiceTargetKey | null {
  const parsed = ConfigurableServiceTargetKeySchema.safeParse(rawService);
  if (!parsed.success) {
    reply.status(400).send({ message: "Invalid configurable service" });
    return null;
  }

  return parsed.data;
}

export function getEditableGameServiceOrReply(
  reply: FastifyReply,
  rawService: unknown,
  capabilityLabel: string,
): EditableGameService | null {
  const service = getServiceKeyOrReply(reply, rawService);
  if (!service) {
    return null;
  }

  if (!isEditableGameService(service)) {
    reply.status(400).send({
      message: `Service '${service}' does not support ${capabilityLabel}`,
    });
    return null;
  }

  return service;
}

export function getGenerationTaskRequestOrReply(
  reply: FastifyReply,
  rawParams: unknown,
  rawQuery: unknown,
): { service: EditableGameService; taskId: string; includeItems: boolean } | null {
  /* v8 ignore next -- helper callers always pass params objects; the nullish fallback is defensive only */
  const parsedParams = GenerationTaskParamsSchema.safeParse(rawParams ?? {});
  if (!parsedParams.success) {
    reply.status(400).send({
      message: "Invalid path parameters",
      errors: parsedParams.error.flatten(),
    });
    return null;
  }

  /* v8 ignore next -- helper callers always pass query objects; the nullish fallback is defensive only */
  const parsedQuery = GenerationTaskQuerySchema.parse(rawQuery ?? {});

  const service = getEditableGameServiceOrReply(
    reply,
    (rawParams as { service?: string } | undefined)?.service,
    "game generation",
  );
  if (!service) {
    return null;
  }

  return {
    service,
    taskId: parsedParams.data.taskId,
    includeItems: parsedQuery.includeItems,
  };
}

export function getDataMutationRequestOrReply(
  reply: FastifyReply,
  rawParams: unknown,
  rawBody: unknown,
): { service: EditableGameService; payload: DataMutationPayload } | null {
  /* v8 ignore next -- helper callers always pass bodies; the nullish fallback is defensive only */
  const parsedPayload = DataMutationSchema.safeParse(rawBody ?? {});
  if (!parsedPayload.success) {
    reply.status(400).send({
      message: "Invalid payload",
      errors: parsedPayload.error.flatten(),
    });
    return null;
  }

  const service = getEditableGameServiceOrReply(
    reply,
    (rawParams as { service?: string } | undefined)?.service,
    "manual data insertion",
  );
  if (!service) {
    return null;
  }

  return {
    service,
    payload: parsedPayload.data,
  };
}

export function getDataUpdateRequestOrReply(
  reply: FastifyReply,
  rawParams: unknown,
  rawBody: unknown,
): { service: EditableGameService; entryId: string; payload: DataUpdatePayload } | null {
  /* v8 ignore next -- helper callers always pass params objects; the nullish fallback is defensive only */
  const parsedParams = EntryIdParamsSchema.safeParse(rawParams ?? {});
  if (!parsedParams.success) {
    reply.status(400).send({
      message: "Invalid path parameters",
      errors: parsedParams.error.flatten(),
    });
    return null;
  }

  /* v8 ignore next -- helper callers always pass bodies; the nullish fallback is defensive only */
  const parsedPayload = DataUpdateSchema.safeParse(rawBody ?? {});
  if (!parsedPayload.success) {
    reply.status(400).send({
      message: "Invalid payload",
      errors: parsedPayload.error.flatten(),
    });
    return null;
  }

  const service = getEditableGameServiceOrReply(
    reply,
    (rawParams as { service?: string } | undefined)?.service,
    "manual data updates",
  );
  if (!service) {
    return null;
  }

  return {
    service,
    entryId: parsedParams.data.entryId,
    payload: parsedPayload.data,
  };
}

export function getGenerationStartRequestOrReply(
  reply: FastifyReply,
  rawParams: unknown,
  rawBody: unknown,
): { service: EditableGameService; payload: GenerationProcessStartPayload } | null {
  /* v8 ignore next -- helper callers always pass bodies; the nullish fallback is defensive only */
  const parsedPayload = GenerationProcessStartSchema.safeParse(rawBody ?? {});
  if (!parsedPayload.success) {
    reply.status(400).send({
      message: "Invalid payload",
      errors: parsedPayload.error.flatten(),
    });
    return null;
  }

  const service = getEditableGameServiceOrReply(
    reply,
    (rawParams as { service?: string } | undefined)?.service,
    "game generation",
  );
  if (!service) {
    return null;
  }

  return {
    service,
    payload: parsedPayload.data,
  };
}

export function getGenerationWorkerStartRequestOrReply(
  reply: FastifyReply,
  rawParams: unknown,
  rawBody: unknown,
): { service: EditableGameService; payload: GenerationWorkerStartPayload } | null {
  /* v8 ignore next -- helper callers always pass bodies; the nullish fallback is defensive only */
  const parsedPayload = GenerationWorkerStartSchema.safeParse(rawBody ?? {});
  if (!parsedPayload.success) {
    reply.status(400).send({
      message: "Invalid payload",
      errors: parsedPayload.error.flatten(),
    });
    return null;
  }

  const service = getEditableGameServiceOrReply(
    reply,
    (rawParams as { service?: string } | undefined)?.service,
    "runtime game generation",
  );
  if (!service) {
    return null;
  }

  return {
    service,
    payload: parsedPayload.data,
  };
}

export function getGenerationProcessesRequestOrReply(
  reply: FastifyReply,
  rawParams: unknown,
  rawQuery: unknown,
): ({ service: EditableGameService } & GenerationProcessesPayload) | null {
  /* v8 ignore next -- helper callers always pass query objects; the nullish fallback is defensive only */
  const parsedQuery = GenerationProcessesQuerySchema.safeParse(rawQuery ?? {});
  if (!parsedQuery.success) {
    reply.status(400).send({
      message: "Invalid query parameters",
      errors: parsedQuery.error.flatten(),
    });
    return null;
  }

  const service = getEditableGameServiceOrReply(
    reply,
    (rawParams as { service?: string } | undefined)?.service,
    "game generation",
  );
  if (!service) {
    return null;
  }

  return {
    service,
    ...parsedQuery.data,
  };
}

export function getDataDeleteRequestOrReply(
  reply: FastifyReply,
  rawParams: unknown,
  rawQuery: unknown,
): { service: EditableGameService; entryId: string } | null {
  /* v8 ignore next -- helper callers always pass params objects; the nullish fallback is defensive only */
  const parsedParams = EntryIdParamsSchema.safeParse(rawParams ?? {});
  if (!parsedParams.success) {
    reply.status(400).send({
      message: "Invalid path parameters",
      errors: parsedParams.error.flatten(),
    });
    return null;
  }

  /* v8 ignore next -- helper callers always pass query objects; the nullish fallback is defensive only */
  const parsedQuery = DataDeleteQuerySchema.safeParse(rawQuery ?? {});
  if (!parsedQuery.success) {
    reply.status(400).send({
      message: "Invalid query parameters",
      errors: parsedQuery.error.flatten(),
    });
    return null;
  }

  const service = getEditableGameServiceOrReply(
    reply,
    (rawParams as { service?: string } | undefined)?.service,
    "manual data deletion",
  );
  if (!service) {
    return null;
  }

  return {
    service,
    entryId: parsedParams.data.entryId,
  };
}