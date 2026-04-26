import { readFile } from "node:fs/promises";
import http from "node:http";
import https from "node:https";

import type { AppConfig } from "../config.js";

type KubernetesListResponse<T> = {
  items?: T[];
};

type OwnerReference = {
  kind?: string;
  name?: string;
};

type PodContainer = {
  image?: string;
  resources?: {
    requests?: Record<string, string>;
    limits?: Record<string, string>;
  };
};

type PodContainerStatus = {
  ready?: boolean;
  restartCount?: number;
};

type Pod = {
  metadata?: {
    name?: string;
    namespace?: string;
    ownerReferences?: OwnerReference[];
  };
  spec?: {
    nodeName?: string;
    containers?: PodContainer[];
  };
  status?: {
    phase?: string;
    conditions?: Array<{ type?: string; status?: string }>;
    containerStatuses?: PodContainerStatus[];
  };
};

type ReplicaSet = {
  metadata?: {
    name?: string;
    ownerReferences?: OwnerReference[];
  };
};

type Deployment = {
  metadata?: {
    name?: string;
  };
  spec?: {
    replicas?: number;
  };
  status?: {
    readyReplicas?: number;
    availableReplicas?: number;
    updatedReplicas?: number;
  };
};

type ResourceMetricContainer = {
  usage?: Record<string, string>;
};

type PodMetric = {
  metadata?: {
    name?: string;
  };
  containers?: ResourceMetricContainer[];
};

type NodeMetric = {
  metadata?: {
    name?: string;
  };
  usage?: Record<string, string>;
};

type Node = {
  metadata?: {
    name?: string;
  };
  status?: {
    capacity?: Record<string, string>;
    conditions?: Array<{ type?: string; status?: string }>;
  };
};

type AggregatedWorkload = {
  name: string;
  image: string | null;
  podCount: number;
  readyPodCount: number;
  restartCount: number;
  cpuUsageMillicores: number;
  memoryUsageBytes: number;
  cpuRequestMillicores: number;
  cpuLimitMillicores: number;
  memoryRequestBytes: number;
  memoryLimitBytes: number;
};

const DEFAULT_TOKEN_FILE = "/var/run/secrets/axiomnode-kubernetes/token";
const DEFAULT_CA_FILE = "/var/run/secrets/axiomnode-kubernetes/ca.crt";
const DEFAULT_NAMESPACE_FILE = "/var/run/secrets/axiomnode-kubernetes/namespace";

export type KubernetesOverviewPayload = {
  enabled: boolean;
  fetchedAt: string;
  namespace: string;
  source: "cluster" | "disabled";
  message: string | null;
  cluster: {
    apiBaseUrl: string | null;
    nodeCount: number;
    readyNodeCount: number;
    deploymentCount: number;
    podCount: number;
    runningPodCount: number;
    notReadyPodCount: number;
    restartCount: number;
    cpuUsageMillicores: number | null;
    cpuCapacityMillicores: number | null;
    cpuUsageRatio: number | null;
    memoryUsageBytes: number | null;
    memoryCapacityBytes: number | null;
    memoryUsageRatio: number | null;
    namespaceCpuRequestMillicores: number;
    namespaceCpuLimitMillicores: number;
    namespaceMemoryRequestBytes: number;
    namespaceMemoryLimitBytes: number;
  };
  nodes: Array<{
    name: string;
    ready: boolean;
    podCount: number;
    cpuUsageMillicores: number | null;
    cpuCapacityMillicores: number | null;
    cpuUsageRatio: number | null;
    memoryUsageBytes: number | null;
    memoryCapacityBytes: number | null;
    memoryUsageRatio: number | null;
  }>;
  workloads: Array<{
    name: string;
    image: string | null;
    desiredReplicas: number;
    readyReplicas: number;
    availableReplicas: number;
    updatedReplicas: number;
    podCount: number;
    readyPodCount: number;
    restartCount: number;
    cpuUsageMillicores: number;
    memoryUsageBytes: number;
    cpuRequestMillicores: number;
    cpuLimitMillicores: number;
    memoryRequestBytes: number;
    memoryLimitBytes: number;
    status: "healthy" | "degraded" | "down";
  }>;
  topPods: Array<{
    name: string;
    workload: string | null;
    nodeName: string | null;
    phase: string;
    ready: boolean;
    restartCount: number;
    cpuUsageMillicores: number;
    memoryUsageBytes: number;
    cpuRequestMillicores: number;
    memoryRequestBytes: number;
  }>;
};

function buildDisabledPayload(namespace: string, message: string): KubernetesOverviewPayload {
  return {
    enabled: false,
    fetchedAt: new Date().toISOString(),
    namespace,
    source: "disabled",
    message,
    cluster: {
      apiBaseUrl: null,
      nodeCount: 0,
      readyNodeCount: 0,
      deploymentCount: 0,
      podCount: 0,
      runningPodCount: 0,
      notReadyPodCount: 0,
      restartCount: 0,
      cpuUsageMillicores: null,
      cpuCapacityMillicores: null,
      cpuUsageRatio: null,
      memoryUsageBytes: null,
      memoryCapacityBytes: null,
      memoryUsageRatio: null,
      namespaceCpuRequestMillicores: 0,
      namespaceCpuLimitMillicores: 0,
      namespaceMemoryRequestBytes: 0,
      namespaceMemoryLimitBytes: 0,
    },
    nodes: [],
    workloads: [],
    topPods: [],
  };
}

function toInteger(value: number | null): number | null {
  return value === null || Number.isNaN(value) ? null : Math.round(value);
}

function ratio(usage: number | null, capacity: number | null): number | null {
  if (usage === null || capacity === null || capacity <= 0) {
    return null;
  }

  return usage / capacity;
}

function parseCpuQuantity(value: string | undefined): number {
  if (!value) {
    return 0;
  }

  if (value.endsWith("n")) {
    return Number(value.slice(0, -1)) / 1_000_000;
  }

  if (value.endsWith("u")) {
    return Number(value.slice(0, -1)) / 1_000;
  }

  if (value.endsWith("m")) {
    return Number(value.slice(0, -1));
  }

  return Number(value) * 1000;
}

function parseMemoryQuantity(value: string | undefined): number {
  if (!value) {
    return 0;
  }

  const match = value.match(/^([0-9]+(?:\.[0-9]+)?)([A-Za-z]+)?$/);
  if (!match) {
    return 0;
  }

  const amount = Number(match[1]);
  const unit = match[2] ?? "";
  const multipliers: Record<string, number> = {
    Ki: 1024,
    Mi: 1024 ** 2,
    Gi: 1024 ** 3,
    Ti: 1024 ** 4,
    Pi: 1024 ** 5,
    Ei: 1024 ** 6,
    K: 1000,
    M: 1000 ** 2,
    G: 1000 ** 3,
    T: 1000 ** 4,
    P: 1000 ** 5,
    E: 1000 ** 6,
    "": 1,
  };

  return amount * (multipliers[unit] ?? 1);
}

function sumContainerResources(containers: PodContainer[] | undefined): {
  cpuRequestMillicores: number;
  cpuLimitMillicores: number;
  memoryRequestBytes: number;
  memoryLimitBytes: number;
  image: string | null;
} {
  return (containers ?? []).reduce(
    (totals, container) => ({
      cpuRequestMillicores: totals.cpuRequestMillicores + parseCpuQuantity(container.resources?.requests?.cpu),
      cpuLimitMillicores: totals.cpuLimitMillicores + parseCpuQuantity(container.resources?.limits?.cpu),
      memoryRequestBytes: totals.memoryRequestBytes + parseMemoryQuantity(container.resources?.requests?.memory),
      memoryLimitBytes: totals.memoryLimitBytes + parseMemoryQuantity(container.resources?.limits?.memory),
      image: totals.image ?? container.image ?? null,
    }),
    {
      cpuRequestMillicores: 0,
      cpuLimitMillicores: 0,
      memoryRequestBytes: 0,
      memoryLimitBytes: 0,
      image: null as string | null,
    },
  );
}

function sumMetricContainers(containers: ResourceMetricContainer[] | undefined): {
  cpuUsageMillicores: number;
  memoryUsageBytes: number;
} {
  return (containers ?? []).reduce(
    (totals, container) => ({
      cpuUsageMillicores: totals.cpuUsageMillicores + parseCpuQuantity(container.usage?.cpu),
      memoryUsageBytes: totals.memoryUsageBytes + parseMemoryQuantity(container.usage?.memory),
    }),
    {
      cpuUsageMillicores: 0,
      memoryUsageBytes: 0,
    },
  );
}

function isPodReady(pod: Pod): boolean {
  const conditions = pod.status?.conditions ?? [];
  const readyCondition = conditions.find((condition) => condition.type === "Ready");
  if (readyCondition?.status === "True") {
    return true;
  }

  const containerStatuses = pod.status?.containerStatuses ?? [];
  return containerStatuses.length > 0 && containerStatuses.every((status) => status.ready === true);
}

function countPodRestarts(pod: Pod): number {
  return (pod.status?.containerStatuses ?? []).reduce((total, status) => total + (status.restartCount ?? 0), 0);
}

function resolveApiBaseUrl(config: AppConfig): string {
  if (config.KUBERNETES_API_URL) {
    return config.KUBERNETES_API_URL;
  }

  const host = process.env.KUBERNETES_SERVICE_HOST;
  const port = process.env.KUBERNETES_SERVICE_PORT_HTTPS ?? process.env.KUBERNETES_SERVICE_PORT;

  if (host && port) {
    return `https://${host}:${port}`;
  }

  return "https://kubernetes.default.svc";
}

async function readTrimmedFile(filePath: string | undefined): Promise<string | null> {
  if (!filePath) {
    return null;
  }

  try {
    const value = await readFile(filePath, "utf8");
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

async function requestJson<T>(
  apiBaseUrl: string,
  resourcePath: string,
  token: string,
  ca: string,
  timeoutMs: number,
): Promise<T> {
  const url = new URL(resourcePath, apiBaseUrl);
  const transport = url.protocol === "http:" ? http : https;

  return new Promise<T>((resolve, reject) => {
    const request = transport.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${token}`,
        },
        ...(url.protocol === "https:" ? { ca } : {}),
      },
      (response) => {
        const chunks: Buffer[] = [];

        response.on("data", (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
        });

        response.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          const statusCode = response.statusCode ?? 500;

          if (statusCode < 200 || statusCode >= 300) {
            reject(new Error(`Kubernetes API ${statusCode}: ${body || "empty response"}`));
            return;
          }

          try {
            resolve(JSON.parse(body) as T);
          } catch (error) {
            reject(new Error(`Invalid Kubernetes API response: ${error instanceof Error ? error.message : String(error)}`));
          }
        });
      },
    );

    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error("Kubernetes API request timed out"));
    });

    request.on("error", reject);
    request.end();
  });
}

export async function fetchKubernetesOverview(config: AppConfig): Promise<KubernetesOverviewPayload> {
  const namespace =
    config.KUBERNETES_NAMESPACE
    ?? await readTrimmedFile(config.KUBERNETES_NAMESPACE_FILE ?? DEFAULT_NAMESPACE_FILE)
    ?? process.env.POD_NAMESPACE
    ?? "default";

  if (config.KUBERNETES_OBSERVABILITY_ENABLED === false) {
    return buildDisabledPayload(namespace, "Kubernetes observability is disabled by configuration.");
  }

  const [token, ca] = await Promise.all([
    readTrimmedFile(config.KUBERNETES_TOKEN_FILE ?? DEFAULT_TOKEN_FILE),
    readTrimmedFile(config.KUBERNETES_CA_FILE ?? DEFAULT_CA_FILE),
  ]);

  if (!token || !ca) {
    return buildDisabledPayload(namespace, "Kubernetes service account credentials are unavailable.");
  }

  const apiBaseUrl = resolveApiBaseUrl(config);
  const timeoutMs = config.KUBERNETES_REQUEST_TIMEOUT_MS ?? 5000;

  const [podList, deploymentList, replicaSetList, nodeList, podMetricList, nodeMetricList] = await Promise.all([
    requestJson<KubernetesListResponse<Pod>>(apiBaseUrl, `/api/v1/namespaces/${encodeURIComponent(namespace)}/pods`, token, ca, timeoutMs),
    requestJson<KubernetesListResponse<Deployment>>(apiBaseUrl, `/apis/apps/v1/namespaces/${encodeURIComponent(namespace)}/deployments`, token, ca, timeoutMs),
    requestJson<KubernetesListResponse<ReplicaSet>>(apiBaseUrl, `/apis/apps/v1/namespaces/${encodeURIComponent(namespace)}/replicasets`, token, ca, timeoutMs),
    requestJson<KubernetesListResponse<Node>>(apiBaseUrl, "/api/v1/nodes", token, ca, timeoutMs),
    requestJson<KubernetesListResponse<PodMetric>>(apiBaseUrl, `/apis/metrics.k8s.io/v1beta1/namespaces/${encodeURIComponent(namespace)}/pods`, token, ca, timeoutMs),
    requestJson<KubernetesListResponse<NodeMetric>>(apiBaseUrl, "/apis/metrics.k8s.io/v1beta1/nodes", token, ca, timeoutMs),
  ]);

  const pods = podList.items ?? [];
  const deployments = deploymentList.items ?? [];
  const replicaSets = replicaSetList.items ?? [];
  const nodes = nodeList.items ?? [];
  const podMetrics = new Map((podMetricList.items ?? []).map((metric) => [metric.metadata?.name ?? "", metric]));
  const nodeMetrics = new Map((nodeMetricList.items ?? []).map((metric) => [metric.metadata?.name ?? "", metric]));
  const replicaSetOwners = new Map<string, string>();

  for (const replicaSet of replicaSets) {
    const replicaSetName = replicaSet.metadata?.name;
    const owner = replicaSet.metadata?.ownerReferences?.find((entry) => entry.kind === "Deployment");
    if (replicaSetName && owner?.name) {
      replicaSetOwners.set(replicaSetName, owner.name);
    }
  }

  const workloads = new Map<string, AggregatedWorkload>();
  const nodePodCounts = new Map<string, number>();
  let runningPodCount = 0;
  let notReadyPodCount = 0;
  let restartCount = 0;
  let namespaceCpuRequestMillicores = 0;
  let namespaceCpuLimitMillicores = 0;
  let namespaceMemoryRequestBytes = 0;
  let namespaceMemoryLimitBytes = 0;

  const topPods = pods.map((pod) => {
    const podName = pod.metadata?.name ?? "unknown-pod";
    const podOwner = pod.metadata?.ownerReferences?.[0];
    const workloadName = podOwner?.kind === "ReplicaSet"
      ? (replicaSetOwners.get(podOwner.name ?? "") ?? podOwner.name ?? null)
      : podOwner?.name ?? null;
    const metricTotals = sumMetricContainers(podMetrics.get(podName)?.containers);
    const resourceTotals = sumContainerResources(pod.spec?.containers);
    const ready = isPodReady(pod);
    const podRestartCount = countPodRestarts(pod);
    const nodeName = pod.spec?.nodeName ?? null;

    if ((pod.status?.phase ?? "Unknown") === "Running") {
      runningPodCount += 1;
    }
    if (!ready) {
      notReadyPodCount += 1;
    }
    restartCount += podRestartCount;
    namespaceCpuRequestMillicores += resourceTotals.cpuRequestMillicores;
    namespaceCpuLimitMillicores += resourceTotals.cpuLimitMillicores;
    namespaceMemoryRequestBytes += resourceTotals.memoryRequestBytes;
    namespaceMemoryLimitBytes += resourceTotals.memoryLimitBytes;

    if (nodeName) {
      nodePodCounts.set(nodeName, (nodePodCounts.get(nodeName) ?? 0) + 1);
    }

    if (workloadName) {
      const existing = workloads.get(workloadName) ?? {
        name: workloadName,
        image: null,
        podCount: 0,
        readyPodCount: 0,
        restartCount: 0,
        cpuUsageMillicores: 0,
        memoryUsageBytes: 0,
        cpuRequestMillicores: 0,
        cpuLimitMillicores: 0,
        memoryRequestBytes: 0,
        memoryLimitBytes: 0,
      };
      workloads.set(workloadName, {
        ...existing,
        image: existing.image ?? resourceTotals.image,
        podCount: existing.podCount + 1,
        readyPodCount: existing.readyPodCount + (ready ? 1 : 0),
        restartCount: existing.restartCount + podRestartCount,
        cpuUsageMillicores: existing.cpuUsageMillicores + metricTotals.cpuUsageMillicores,
        memoryUsageBytes: existing.memoryUsageBytes + metricTotals.memoryUsageBytes,
        cpuRequestMillicores: existing.cpuRequestMillicores + resourceTotals.cpuRequestMillicores,
        cpuLimitMillicores: existing.cpuLimitMillicores + resourceTotals.cpuLimitMillicores,
        memoryRequestBytes: existing.memoryRequestBytes + resourceTotals.memoryRequestBytes,
        memoryLimitBytes: existing.memoryLimitBytes + resourceTotals.memoryLimitBytes,
      });
    }

    return {
      name: podName,
      workload: workloadName,
      nodeName,
      phase: pod.status?.phase ?? "Unknown",
      ready,
      restartCount: podRestartCount,
      cpuUsageMillicores: metricTotals.cpuUsageMillicores,
      memoryUsageBytes: metricTotals.memoryUsageBytes,
      cpuRequestMillicores: resourceTotals.cpuRequestMillicores,
      memoryRequestBytes: resourceTotals.memoryRequestBytes,
    };
  }).sort((left, right) => {
    if (right.memoryUsageBytes !== left.memoryUsageBytes) {
      return right.memoryUsageBytes - left.memoryUsageBytes;
    }

    return right.cpuUsageMillicores - left.cpuUsageMillicores;
  }).slice(0, 8);

  const workloadRows = deployments.map((deployment) => {
    const name = deployment.metadata?.name ?? "unknown-deployment";
    const aggregate = workloads.get(name) ?? {
      name,
      image: null,
      podCount: 0,
      readyPodCount: 0,
      restartCount: 0,
      cpuUsageMillicores: 0,
      memoryUsageBytes: 0,
      cpuRequestMillicores: 0,
      cpuLimitMillicores: 0,
      memoryRequestBytes: 0,
      memoryLimitBytes: 0,
    };
    const desiredReplicas = deployment.spec?.replicas ?? 0;
    const readyReplicas = deployment.status?.readyReplicas ?? 0;
    const availableReplicas = deployment.status?.availableReplicas ?? 0;
    const updatedReplicas = deployment.status?.updatedReplicas ?? 0;
    const status: "healthy" | "degraded" | "down" = desiredReplicas === 0 || readyReplicas >= desiredReplicas
      ? "healthy"
      : readyReplicas > 0 || aggregate.readyPodCount > 0
        ? "degraded"
        : "down";

    return {
      name,
      image: aggregate.image,
      desiredReplicas,
      readyReplicas,
      availableReplicas,
      updatedReplicas,
      podCount: aggregate.podCount,
      readyPodCount: aggregate.readyPodCount,
      restartCount: aggregate.restartCount,
      cpuUsageMillicores: aggregate.cpuUsageMillicores,
      memoryUsageBytes: aggregate.memoryUsageBytes,
      cpuRequestMillicores: aggregate.cpuRequestMillicores,
      cpuLimitMillicores: aggregate.cpuLimitMillicores,
      memoryRequestBytes: aggregate.memoryRequestBytes,
      memoryLimitBytes: aggregate.memoryLimitBytes,
      status,
    };
  }).sort((left, right) => {
    const statusOrder = { down: 0, degraded: 1, healthy: 2 };
    if (statusOrder[left.status] !== statusOrder[right.status]) {
      return statusOrder[left.status] - statusOrder[right.status];
    }

    return right.memoryUsageBytes - left.memoryUsageBytes;
  });

  const nodeRows = nodes.map((node) => {
    const name = node.metadata?.name ?? "unknown-node";
    const metric = nodeMetrics.get(name);
    const ready = (node.status?.conditions ?? []).some((condition) => condition.type === "Ready" && condition.status === "True");
    const cpuUsageMillicores = metric ? parseCpuQuantity(metric.usage?.cpu) : null;
    const cpuCapacityMillicores = toInteger(parseCpuQuantity(node.status?.capacity?.cpu));
    const memoryUsageBytes = metric ? parseMemoryQuantity(metric.usage?.memory) : null;
    const memoryCapacityBytes = toInteger(parseMemoryQuantity(node.status?.capacity?.memory));

    return {
      name,
      ready,
      podCount: nodePodCounts.get(name) ?? 0,
      cpuUsageMillicores: toInteger(cpuUsageMillicores),
      cpuCapacityMillicores,
      cpuUsageRatio: ratio(cpuUsageMillicores, cpuCapacityMillicores),
      memoryUsageBytes: toInteger(memoryUsageBytes),
      memoryCapacityBytes,
      memoryUsageRatio: ratio(memoryUsageBytes, memoryCapacityBytes),
    };
  }).sort((left, right) => left.name.localeCompare(right.name));

  const totalCpuUsage = nodeRows.reduce((total, node) => total + (node.cpuUsageMillicores ?? 0), 0);
  const totalCpuCapacity = nodeRows.reduce((total, node) => total + (node.cpuCapacityMillicores ?? 0), 0);
  const totalMemoryUsage = nodeRows.reduce((total, node) => total + (node.memoryUsageBytes ?? 0), 0);
  const totalMemoryCapacity = nodeRows.reduce((total, node) => total + (node.memoryCapacityBytes ?? 0), 0);

  return {
    enabled: true,
    fetchedAt: new Date().toISOString(),
    namespace,
    source: "cluster",
    message: null,
    cluster: {
      apiBaseUrl,
      nodeCount: nodeRows.length,
      readyNodeCount: nodeRows.filter((node) => node.ready).length,
      deploymentCount: workloadRows.length,
      podCount: pods.length,
      runningPodCount,
      notReadyPodCount,
      restartCount,
      cpuUsageMillicores: toInteger(totalCpuUsage),
      cpuCapacityMillicores: totalCpuCapacity > 0 ? totalCpuCapacity : null,
      cpuUsageRatio: ratio(totalCpuUsage, totalCpuCapacity > 0 ? totalCpuCapacity : null),
      memoryUsageBytes: toInteger(totalMemoryUsage),
      memoryCapacityBytes: totalMemoryCapacity > 0 ? totalMemoryCapacity : null,
      memoryUsageRatio: ratio(totalMemoryUsage, totalMemoryCapacity > 0 ? totalMemoryCapacity : null),
      namespaceCpuRequestMillicores,
      namespaceCpuLimitMillicores,
      namespaceMemoryRequestBytes,
      namespaceMemoryLimitBytes,
    },
    nodes: nodeRows,
    workloads: workloadRows,
    topPods,
  };
}