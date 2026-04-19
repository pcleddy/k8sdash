import k8s from '@kubernetes/client-node';
import { age } from './age.js';

const kc = new k8s.KubeConfig();
try {
  kc.loadFromDefault();
} catch (err) {
  console.error('[k8sdash] Failed to load kubeconfig:', err.message);
}

// Lazily initialised API clients — reset when context switches
let _core = null;
let _apps = null;

function core() {
  if (!_core) _core = kc.makeApiClient(k8s.CoreV1Api);
  return _core;
}

function apps() {
  if (!_apps) _apps = kc.makeApiClient(k8s.AppsV1Api);
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
  return (res.body?.items ?? res.items ?? []).map((ns) => ns.metadata?.name ?? '').filter(Boolean);
}

// ---------------------------------------------------------------------------
// Projection helpers
// ---------------------------------------------------------------------------

function projectDeployment(d) {
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

function projectService(s) {
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

function projectSecret(s) {
  return {
    name: s.metadata?.name ?? '',
    type: s.type ?? '',
    dataKeys: Object.keys(s.data ?? {}).length,
    age: age(s.metadata?.creationTimestamp),
  };
}

function projectPod(p) {
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

function projectStatefulSet(ss) {
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
    apps().listNamespacedDeployment(namespace),
    core().listNamespacedService(namespace),
    core().listNamespacedSecret(namespace),
    core().listNamespacedPod(namespace),
    apps().listNamespacedStatefulSet(namespace),
  ]);

  function unwrap(result, project) {
    if (result.status === 'fulfilled') {
      const items = result.value.body?.items ?? result.value.items ?? [];
      return items.map(project);
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
