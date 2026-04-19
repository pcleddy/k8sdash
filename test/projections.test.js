import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  projectDeployment,
  projectService,
  projectSecret,
  projectPod,
  projectStatefulSet,
} from '../lib/k8s.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const meta = (name, ts = '2024-01-01T00:00:00Z') => ({ name, creationTimestamp: ts });

// ---------------------------------------------------------------------------
// projectDeployment
// ---------------------------------------------------------------------------

test('projectDeployment: full object', () => {
  const d = {
    metadata: meta('my-app'),
    spec: {
      replicas: 3,
      template: { spec: { containers: [{ image: 'nginx:1.25' }] } },
    },
    status: { readyReplicas: 2, availableReplicas: 2, updatedReplicas: 3 },
  };
  const out = projectDeployment(d);
  assert.equal(out.name, 'my-app');
  assert.deepEqual(out.replicas, { desired: 3, ready: 2, available: 2, updated: 3 });
  assert.deepEqual(out.image, ['nginx:1.25']);
  assert.ok(out.age);
});

test('projectDeployment: missing spec/status defaults to 0', () => {
  const out = projectDeployment({ metadata: meta('x') });
  assert.deepEqual(out.replicas, { desired: 0, ready: 0, available: 0, updated: 0 });
  assert.deepEqual(out.image, []);
});

// ---------------------------------------------------------------------------
// projectService
// ---------------------------------------------------------------------------

test('projectService: ClusterIP service', () => {
  const s = {
    metadata: meta('my-svc'),
    spec: {
      type: 'ClusterIP',
      clusterIP: '10.0.0.1',
      ports: [{ port: 80, protocol: 'TCP' }, { port: 443 }],
    },
  };
  const out = projectService(s);
  assert.equal(out.name, 'my-svc');
  assert.equal(out.type, 'ClusterIP');
  assert.equal(out.clusterIP, '10.0.0.1');
  assert.deepEqual(out.ports, ['80/TCP', '443/TCP']);
  assert.deepEqual(out.externalIPs, []);
});

test('projectService: LoadBalancer with external IPs', () => {
  const out = projectService({
    metadata: meta('lb'),
    spec: { type: 'LoadBalancer', clusterIP: '10.0.0.2', externalIPs: ['1.2.3.4'] },
  });
  assert.deepEqual(out.externalIPs, ['1.2.3.4']);
});

test('projectService: empty spec defaults', () => {
  const out = projectService({ metadata: meta('x') });
  assert.equal(out.type, '');
  assert.equal(out.clusterIP, '');
  assert.deepEqual(out.ports, []);
});

// ---------------------------------------------------------------------------
// projectSecret
// ---------------------------------------------------------------------------

test('projectSecret: counts data keys', () => {
  const out = projectSecret({
    metadata: meta('my-secret'),
    type: 'kubernetes.io/tls',
    data: { 'tls.crt': 'abc', 'tls.key': 'xyz' },
  });
  assert.equal(out.name, 'my-secret');
  assert.equal(out.type, 'kubernetes.io/tls');
  assert.equal(out.dataKeys, 2);
});

test('projectSecret: no data → 0 keys', () => {
  const out = projectSecret({ metadata: meta('x'), type: 'Opaque' });
  assert.equal(out.dataKeys, 0);
});

// ---------------------------------------------------------------------------
// projectPod
// ---------------------------------------------------------------------------

test('projectPod: running pod', () => {
  const p = {
    metadata: meta('my-pod'),
    spec: { containers: [{ name: 'app' }], nodeName: 'node-1' },
    status: {
      phase: 'Running',
      containerStatuses: [{ ready: true, restartCount: 0 }],
    },
  };
  const out = projectPod(p);
  assert.equal(out.name, 'my-pod');
  assert.equal(out.phase, 'Running');
  assert.equal(out.ready, '1/1');
  assert.equal(out.restarts, 0);
  assert.equal(out.node, 'node-1');
});

test('projectPod: counts restarts across containers', () => {
  const p = {
    metadata: meta('x'),
    spec: { containers: [{}, {}] },
    status: {
      phase: 'Running',
      containerStatuses: [
        { ready: true, restartCount: 3 },
        { ready: false, restartCount: 1 },
      ],
    },
  };
  const out = projectPod(p);
  assert.equal(out.ready, '1/2');
  assert.equal(out.restarts, 4);
});

test('projectPod: missing status defaults', () => {
  const out = projectPod({ metadata: meta('x') });
  assert.equal(out.phase, '');
  assert.equal(out.ready, '0/0');
  assert.equal(out.restarts, 0);
  assert.equal(out.node, '');
});

// ---------------------------------------------------------------------------
// projectStatefulSet
// ---------------------------------------------------------------------------

test('projectStatefulSet: full object', () => {
  const ss = {
    metadata: meta('my-ss'),
    spec: {
      replicas: 2,
      serviceName: 'my-svc',
      template: { spec: { containers: [{ image: 'redis:7' }] } },
    },
    status: { readyReplicas: 2 },
  };
  const out = projectStatefulSet(ss);
  assert.equal(out.name, 'my-ss');
  assert.deepEqual(out.replicas, { desired: 2, ready: 2 });
  assert.equal(out.serviceName, 'my-svc');
  assert.deepEqual(out.image, ['redis:7']);
});

test('projectStatefulSet: missing spec defaults', () => {
  const out = projectStatefulSet({ metadata: meta('x') });
  assert.deepEqual(out.replicas, { desired: 0, ready: 0 });
  assert.equal(out.serviceName, '');
  assert.deepEqual(out.image, []);
});
