import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { fetchKubernetesOverview } from "../app/services/kubernetesObservability.js";

let tempDir = "";
let server: ReturnType<typeof createServer> | null = null;

async function startServer(handler: (request: IncomingMessage, response: ServerResponse) => void): Promise<string> {
  server = createServer(handler);
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Unable to resolve test server address");
  }
  return `http://127.0.0.1:${address.port}`;
}

describe("fetchKubernetesOverview", () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "axiomnode-k8s-observability-"));
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      if (!server) {
        resolve();
        return;
      }
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    server = null;

    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
    tempDir = "";
  });

  it("returns a disabled payload when observability is turned off", async () => {
    const payload = await fetchKubernetesOverview({
      KUBERNETES_OBSERVABILITY_ENABLED: false,
      KUBERNETES_NAMESPACE: "axiomnode-stg",
    } as never);

    expect(payload).toMatchObject({
      enabled: false,
      source: "disabled",
      namespace: "axiomnode-stg",
      message: "Kubernetes observability is disabled by configuration.",
    });
  });

  it("aggregates cluster, workload and hot pod data from the kubernetes APIs", async () => {
    const namespaceFile = path.join(tempDir, "namespace");
    const tokenFile = path.join(tempDir, "token");
    const caFile = path.join(tempDir, "ca.crt");

    await Promise.all([
      writeFile(namespaceFile, "axiomnode-stg\n", "utf8"),
      writeFile(tokenFile, "test-token\n", "utf8"),
      writeFile(caFile, "test-ca\n", "utf8"),
    ]);

    const apiBaseUrl = await startServer((request, response) => {
      const payloads: Record<string, unknown> = {
        "/api/v1/namespaces/axiomnode-stg/pods": {
          items: [
            {
              metadata: {
                name: "microservice-quizz-api-123",
                namespace: "axiomnode-stg",
                ownerReferences: [{ kind: "ReplicaSet", name: "microservice-quizz-api-abc" }],
              },
              spec: {
                nodeName: "node-a",
                containers: [
                  {
                    image: "ghcr.io/axiomnode/microservice-quizz-api:stg",
                    resources: {
                      requests: { cpu: "200m", memory: "128Mi" },
                      limits: { cpu: "400m", memory: "256Mi" },
                    },
                  },
                ],
              },
              status: {
                phase: "Running",
                conditions: [{ type: "Ready", status: "True" }],
                containerStatuses: [{ ready: true, restartCount: 1 }],
              },
            },
            {
              metadata: {
                name: "backoffice-456",
                namespace: "axiomnode-stg",
              },
              spec: {
                nodeName: "node-a",
                containers: [
                  {
                    image: "ghcr.io/axiomnode/backoffice:stg",
                    resources: {
                      requests: { cpu: "100m", memory: "64Mi" },
                      limits: { cpu: "200m", memory: "128Mi" },
                    },
                  },
                ],
              },
              status: {
                phase: "Pending",
                conditions: [{ type: "Ready", status: "False" }],
                containerStatuses: [{ ready: false, restartCount: 0 }],
              },
            },
          ],
        },
        "/apis/apps/v1/namespaces/axiomnode-stg/deployments": {
          items: [
            {
              metadata: { name: "microservice-quizz-api" },
              spec: { replicas: 1 },
              status: { readyReplicas: 1, availableReplicas: 1, updatedReplicas: 1 },
            },
          ],
        },
        "/apis/apps/v1/namespaces/axiomnode-stg/replicasets": {
          items: [
            {
              metadata: {
                name: "microservice-quizz-api-abc",
                ownerReferences: [{ kind: "Deployment", name: "microservice-quizz-api" }],
              },
            },
          ],
        },
        "/api/v1/nodes": {
          items: [
            {
              metadata: { name: "node-a" },
              status: {
                capacity: { cpu: "2", memory: "4Gi" },
                conditions: [{ type: "Ready", status: "True" }],
              },
            },
          ],
        },
        "/apis/metrics.k8s.io/v1beta1/namespaces/axiomnode-stg/pods": {
          items: [
            {
              metadata: { name: "microservice-quizz-api-123" },
              containers: [{ usage: { cpu: "120m", memory: "128Mi" } }],
            },
            {
              metadata: { name: "backoffice-456" },
              containers: [{ usage: { cpu: "30m", memory: "64Mi" } }],
            },
          ],
        },
        "/apis/metrics.k8s.io/v1beta1/nodes": {
          items: [
            {
              metadata: { name: "node-a" },
              usage: { cpu: "500m", memory: "768Mi" },
            },
          ],
        },
      };

      const payload = payloads[request.url ?? ""];
      if (!payload) {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ message: "not found" }));
        return;
      }

      expect(request.headers.authorization).toBe("Bearer test-token");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(payload));
    });

    const payload = await fetchKubernetesOverview({
      KUBERNETES_API_URL: apiBaseUrl,
      KUBERNETES_NAMESPACE_FILE: namespaceFile,
      KUBERNETES_TOKEN_FILE: tokenFile,
      KUBERNETES_CA_FILE: caFile,
      KUBERNETES_REQUEST_TIMEOUT_MS: 2000,
    } as never);

    expect(payload).toMatchObject({
      enabled: true,
      source: "cluster",
      namespace: "axiomnode-stg",
      cluster: {
        apiBaseUrl,
        nodeCount: 1,
        readyNodeCount: 1,
        deploymentCount: 1,
        podCount: 2,
        runningPodCount: 1,
        notReadyPodCount: 1,
        restartCount: 1,
        namespaceCpuRequestMillicores: 300,
        namespaceCpuLimitMillicores: 600,
      },
    });
    expect(payload.cluster.cpuUsageMillicores).toBe(500);
    expect(payload.cluster.memoryUsageBytes).toBe(805306368);
    expect(payload.nodes[0]).toMatchObject({
      name: "node-a",
      ready: true,
      podCount: 2,
      cpuUsageMillicores: 500,
      cpuCapacityMillicores: 2000,
    });
    expect(payload.workloads[0]).toMatchObject({
      name: "microservice-quizz-api",
      podCount: 1,
      readyPodCount: 1,
      cpuUsageMillicores: 120,
      memoryUsageBytes: 134217728,
      cpuRequestMillicores: 200,
      memoryRequestBytes: 134217728,
      status: "healthy",
    });
    expect(payload.topPods[0]).toMatchObject({
      name: "microservice-quizz-api-123",
      workload: "microservice-quizz-api",
      nodeName: "node-a",
      ready: true,
      restartCount: 1,
    });
  });

  it("keeps the overview available when metrics APIs are missing", async () => {
    const namespaceFile = path.join(tempDir, "namespace");
    const tokenFile = path.join(tempDir, "token");
    const caFile = path.join(tempDir, "ca.crt");

    await Promise.all([
      writeFile(namespaceFile, "axiomnode-stg\n", "utf8"),
      writeFile(tokenFile, "test-token\n", "utf8"),
      writeFile(caFile, "test-ca\n", "utf8"),
    ]);

    const apiBaseUrl = await startServer((request, response) => {
      const payloads: Record<string, unknown> = {
        "/api/v1/namespaces/axiomnode-stg/pods": {
          items: [
            {
              metadata: {
                name: "bff-backoffice-123",
                namespace: "axiomnode-stg",
              },
              spec: {
                nodeName: "node-a",
                containers: [
                  {
                    image: "ghcr.io/axiomnode/bff-backoffice:stg",
                    resources: {
                      requests: { cpu: "100m", memory: "128Mi" },
                      limits: { cpu: "200m", memory: "256Mi" },
                    },
                  },
                ],
              },
              status: {
                phase: "Running",
                conditions: [{ type: "Ready", status: "True" }],
                containerStatuses: [{ ready: true, restartCount: 0 }],
              },
            },
          ],
        },
        "/apis/apps/v1/namespaces/axiomnode-stg/deployments": {
          items: [
            {
              metadata: { name: "bff-backoffice" },
              spec: { replicas: 1 },
              status: { readyReplicas: 1, availableReplicas: 1, updatedReplicas: 1 },
            },
          ],
        },
        "/apis/apps/v1/namespaces/axiomnode-stg/replicasets": {
          items: [],
        },
        "/api/v1/nodes": {
          items: [
            {
              metadata: { name: "node-a" },
              status: {
                capacity: { cpu: "2", memory: "4Gi" },
                conditions: [{ type: "Ready", status: "True" }],
              },
            },
          ],
        },
      };

      const payload = payloads[request.url ?? ""];
      if (!payload) {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ message: "not found" }));
        return;
      }

      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(payload));
    });

    const payload = await fetchKubernetesOverview({
      KUBERNETES_API_URL: apiBaseUrl,
      KUBERNETES_NAMESPACE_FILE: namespaceFile,
      KUBERNETES_TOKEN_FILE: tokenFile,
      KUBERNETES_CA_FILE: caFile,
      KUBERNETES_REQUEST_TIMEOUT_MS: 2000,
    } as never);

    expect(payload.enabled).toBe(true);
    expect(payload.source).toBe("cluster");
    expect(payload.cluster.nodeCount).toBe(1);
    expect(payload.cluster.podCount).toBe(1);
    expect(payload.cluster.cpuUsageMillicores).toBe(0);
    expect(payload.nodes[0]).toMatchObject({
      name: "node-a",
      cpuUsageMillicores: null,
      memoryUsageBytes: null,
    });
    expect(payload.message).toContain("Pod metrics API unavailable:");
    expect(payload.message).toContain("Node metrics API unavailable:");
  });
});