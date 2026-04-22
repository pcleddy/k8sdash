import { KubeConfig, CoreV1Api, AppsV1Api } from '@kubernetes/client-node';
import { age } from './age.js';

const kc = new KubeConfig();
try {
  kc.loadFromDefault();
} catch (err) {
  console.error('[k8sdash] Failed to load kubeconfig:', err.message);
}

// Lazily initialised API clients — reset when context switches
let _core = null;
let _apps = null;

const CLIENT_TIMEOUT_MS = 8000;
const timeoutMiddleware = {
  pre:  (ctx) => { ctx.setSignal(AbortSignal.timeout(CLIENT_TIMEOUT_MS)); return { toPromise: () => Promise.resolve(ctx) }; },
  post: (ctx) => ({ toPromise: () => Promise.resolve(ctx) }),
};

function core() {
  if (!_core) {
    _core = kc.makeApiClient(CoreV1Api);
    _core.api.configuration.middleware.push(timeoutMiddleware);
  }
  return _core;
}

function apps() {
  if (!_apps) {
    _apps = kc.makeApiClient(AppsV1Api);
    _apps.api.configuration.middleware.push(timeoutMiddleware);
  }
  return _apps;
}

function resetClients() {
  _core = null;
  _apps = null;
}

// ---------------------------------------------------------------------------
// Context info
// ---------------------------------------------------------------------------


export function listContexts() {
  return kc.getContexts().map((c) => c.name);
}

export function switchContext(name) {
  const valid = kc.getContexts().map((c) => c.name);
  if (!valid.includes(name)) throw new Error(`Unknown context: ${name}`);
  kc.setCurrentContext(name);
  resetClients();
}

export function getContext() {
  const currentCtx = kc.getCurrentContext();
  if (!currentCtx) throw new Error('No current context in kubeconfig');

  const ctx = kc.getContextObject(currentCtx);
  const cluster = kc.getCluster(ctx?.cluster ?? '');
  const user = ctx?.user ?? '';

  return {
    context: currentCtx,
    cluster: ctx?.cluster ?? '',
    user,
    server: cluster?.server ?? '',
  };
}

// ---------------------------------------------------------------------------
// Namespaces
// ---------------------------------------------------------------------------

export async function listNamespaces() {
  const res = await core().listNamespace();
  return (res.items ?? []).map((ns) => ns.metadata?.name ?? '').filter(Boolean);
}

// ---------------------------------------------------------------------------
// Projection helpers
// ---------------------------------------------------------------------------

export function projectDeployment(d) {
  const spec = d.spec ?? {};
  const status = d.status ?? {};
  return {
    name: d.metadata?.name ?? '',
    replicas: {
      desired: spec.replicas ?? 0,
      ready: status.readyReplicas ?? 0,
      available: status.availableReplicas ?? 0,
      updated: status.updatedReplicas ?? 0,
    },
    image: (spec.template?.spec?.containers ?? []).map((c) => c.image ?? ''),
    age: age(d.metadata?.creationTimestamp),
  };
}

export function projectService(s) {
  const spec = s.spec ?? {};
  return {
    name: s.metadata?.name ?? '',
    type: spec.type ?? '',
    clusterIP: spec.clusterIP ?? '',
    externalIPs: spec.externalIPs ?? [],
    ports: (spec.ports ?? []).map((p) => `${p.port}/${p.protocol ?? 'TCP'}`),
    age: age(s.metadata?.creationTimestamp),
  };
}

export function projectSecret(s) {
  return {
    name: s.metadata?.name ?? '',
    type: s.type ?? '',
    dataKeys: Object.keys(s.data ?? {}).length,
    age: age(s.metadata?.creationTimestamp),
  };
}

export function projectPod(p) {
  const status = p.status ?? {};
  const containers = status.containerStatuses ?? [];
  const ready = containers.filter((c) => c.ready).length;
  const total = (p.spec?.containers ?? []).length;
  const restarts = containers.reduce((sum, c) => sum + (c.restartCount ?? 0), 0);
  return {
    name: p.metadata?.name ?? '',
    phase: status.phase ?? '',
    ready: `${ready}/${total}`,
    restarts,
    node: p.spec?.nodeName ?? '',
    age: age(p.metadata?.creationTimestamp),
  };
}

export function projectStatefulSet(ss) {
  const spec = ss.spec ?? {};
  const status = ss.status ?? {};
  return {
    name: ss.metadata?.name ?? '',
    replicas: {
      desired: spec.replicas ?? 0,
      ready: status.readyReplicas ?? 0,
    },
    serviceName: spec.serviceName ?? '',
    image: (spec.template?.spec?.containers ?? []).map((c) => c.image ?? ''),
    age: age(ss.metadata?.creationTimestamp),
  };
}

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------

export async function listResources(namespace) {
  const [deps, svcs, secrets, pods, ssets] = await Promise.allSettled([
    apps().listNamespacedDeployment({ namespace }),
    core().listNamespacedService({ namespace }),
    core().listNamespacedSecret({ namespace }),
    core().listNamespacedPod({ namespace }),
    apps().listNamespacedStatefulSet({ namespace }),
  ]);

  function unwrap(result, project) {
    if (result.status === 'fulfilled') {
      return (result.value.items ?? []).map(project);
    }
    return { error: result.reason?.message ?? String(result.reason) };
  }

  return {
    namespace,
    fetchedAt: new Date().toISOString(),
    deployments: unwrap(deps, projectDeployment),
    services: unwrap(svcs, projectService),
    secrets: unwrap(secrets, projectSecret),
    pods: unwrap(pods, projectPod),
    statefulSets: unwrap(ssets, projectStatefulSet),
  };
}

// ---------------------------------------------------------------------------
// Secret creation
// ---------------------------------------------------------------------------

export async function createSecret(namespace, name, data) {
  // Base64-encode all data values
  const encodedData = {};
  for (const [key, value] of Object.entries(data)) {
    encodedData[key] = Buffer.from(value, 'utf-8').toString('base64');
  }

  const secretObj = {
    apiVersion: 'v1',
    kind: 'Secret',
    metadata: {
      name,
      namespace,
    },
    type: 'Opaque',
    data: encodedData,
  };

  return core().createNamespacedSecret({ namespace, body: secretObj });
}

export async function getSecret(namespace, name) {
  const res = await core().readNamespacedSecret({ namespace, name });

  // Decode the data for display
  const decodedData = {};
  for (const [key, value] of Object.entries(res.data ?? {})) {
    decodedData[key] = Buffer.from(value, 'base64').toString('utf-8');
  }

  return {
    name: res.metadata?.name ?? '',
    namespace: res.metadata?.namespace ?? '',
    type: res.type ?? 'Opaque',
    data: decodedData,
  };
}

export async function updateSecret(namespace, name, data) {
  // Get current secret to preserve metadata
  const current = await core().readNamespacedSecret({ namespace, name });

  // Base64-encode new data values
  const encodedData = {};
  for (const [key, value] of Object.entries(data)) {
    encodedData[key] = Buffer.from(value, 'utf-8').toString('base64');
  }

  // Replace the entire secret (preserves metadata via current object)
  const updated = {
    apiVersion: current.apiVersion ?? 'v1',
    kind: current.kind ?? 'Secret',
    metadata: current.metadata,
    type: current.type ?? 'Opaque',
    data: encodedData,
  };

  return core().replaceNamespacedSecret({
    namespace,
    name,
    body: updated,
  });
}

// ---------------------------------------------------------------------------
// Pod describe
// ---------------------------------------------------------------------------

export async function getPodDetails(namespace, name) {
  const pod = await core().readNamespacedPod({ namespace, name });

  // Extract useful fields, hide low-level metadata
  const status = pod.status ?? {};
  const spec = pod.spec ?? {};
  const metadata = pod.metadata ?? {};

  return {
    name: metadata.name ?? '',
    namespace: metadata.namespace ?? '',
    labels: metadata.labels ?? {},
    annotations: metadata.annotations ?? {},

    // Status info
    phase: status.phase ?? 'Unknown',
    conditions: (status.conditions ?? []).map((c) => ({
      type: c.type ?? '',
      status: c.status ?? '',
      reason: c.reason ?? '',
      message: c.message ?? '',
      lastTransitionTime: c.lastTransitionTime ?? '',
    })),

    // Container info
    containers: (spec.containers ?? []).map((c) => ({
      name: c.name ?? '',
      image: c.image ?? '',
      ready: status.containerStatuses?.find((cs) => cs.name === c.name)?.ready ?? false,
      restartCount: status.containerStatuses?.find((cs) => cs.name === c.name)?.restartCount ?? 0,
      lastState: status.containerStatuses?.find((cs) => cs.name === c.name)?.lastState,
      resources: {
        requests: c.resources?.requests ?? {},
        limits: c.resources?.limits ?? {},
      },
    })),

    initContainers: (spec.initContainers ?? []).map((c) => ({
      name: c.name ?? '',
      image: c.image ?? '',
    })),

    // Scheduling
    nodeName: spec.nodeName ?? 'Not assigned',
    serviceAccount: spec.serviceAccountName ?? 'default',

    // Events (fetch separately)
    events: [],

    // Raw object for YAML view
    raw: pod,
  };
}

export async function getPodEvents(namespace, name) {
  const events = await core().listNamespacedEvent({ namespace });

  // Filter events for this pod, sorted by timestamp (newest first)
  const podEvents = (events.items ?? [])
    .filter((e) => e.involvedObject?.name === name && e.involvedObject?.kind === 'Pod')
    .sort((a, b) => {
      const timeA = new Date(a.lastTimestamp ?? a.firstTimestamp ?? 0).getTime();
      const timeB = new Date(b.lastTimestamp ?? b.firstTimestamp ?? 0).getTime();
      return timeB - timeA;
    })
    .map((e) => ({
      type: e.type ?? '',
      reason: e.reason ?? '',
      message: e.message ?? '',
      count: e.count ?? 1,
      firstTimestamp: e.firstTimestamp ?? '',
      lastTimestamp: e.lastTimestamp ?? '',
    }));

  return podEvents;
}

export async function getPodLogs(namespace, name, containerName, tailLines = 100) {
  try {
    const logs = await core().readNamespacedPodLog({
      namespace,
      name,
      container: containerName,
      tailLines,
    });

    return {
      container: containerName,
      logs: logs ?? '(no logs)',
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    // Handle common errors
    if (err.message?.includes('ContainerCreating') || err.message?.includes('PodInitializing')) {
      return {
        container: containerName,
        logs: '(Container not ready yet)',
        timestamp: new Date().toISOString(),
        error: 'container_not_ready',
      };
    }
    throw err;
  }
}
