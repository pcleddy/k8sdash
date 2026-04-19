#!/usr/bin/env bash
# setup-kind.sh — spin up a kind cluster pre-loaded with sample k8s objects
# for testing k8sdash locally.
#
# Usage:
#   ./scripts/setup-kind.sh            # create cluster + load fixtures
#   ./scripts/setup-kind.sh --delete   # tear down the cluster

set -euo pipefail

CLUSTER_NAME="k8sdash-dev"
K8S_VERSION="v1.30.0"  # change if you need a different version

# ── colours ────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[setup]${NC} $*"; }
warn()  { echo -e "${YELLOW}[setup]${NC} $*"; }
error() { echo -e "${RED}[setup]${NC} $*" >&2; }

# ── delete flag ─────────────────────────────────────────────────────────────
if [[ "${1:-}" == "--delete" ]]; then
  info "Deleting kind cluster '${CLUSTER_NAME}'…"
  kind delete cluster --name "${CLUSTER_NAME}"
  info "Done."
  exit 0
fi

# ── prerequisite checks ─────────────────────────────────────────────────────
check_cmd() {
  if ! command -v "$1" &>/dev/null; then
    error "Required tool not found: $1"
    echo "  Install it and re-run this script."
    case "$1" in
      docker) echo "  https://docs.docker.com/get-docker/" ;;
      kind)   echo "  brew install kind  OR  go install sigs.k8s.io/kind@latest" ;;
      kubectl) echo "  brew install kubectl  OR  https://kubernetes.io/docs/tasks/tools/" ;;
    esac
    exit 1
  fi
}

check_cmd docker
check_cmd kind
check_cmd kubectl

# Verify Docker is running
if ! docker info &>/dev/null; then
  error "Docker daemon is not running. Start Docker Desktop and try again."
  exit 1
fi

# ── create cluster ───────────────────────────────────────────────────────────
if kind get clusters 2>/dev/null | grep -q "^${CLUSTER_NAME}$"; then
  warn "Cluster '${CLUSTER_NAME}' already exists — skipping creation."
else
  info "Creating kind cluster '${CLUSTER_NAME}' (k8s ${K8S_VERSION})…"
  kind create cluster \
    --name "${CLUSTER_NAME}" \
    --image "kindest/node:${K8S_VERSION}" \
    --wait 90s
fi

# Point kubectl at the new cluster
kubectl config use-context "kind-${CLUSTER_NAME}"
info "kubectl context → kind-${CLUSTER_NAME}"

# ── helper: wait for a deployment to become available ────────────────────────
wait_deploy() {
  local ns="$1" name="$2"
  kubectl rollout status deployment/"${name}" -n "${ns}" --timeout=120s \
    2>/dev/null || warn "  Timed out waiting for ${ns}/${name} (may still be pulling image)"
}

# ════════════════════════════════════════════════════════════════════════════
# NAMESPACES
# ════════════════════════════════════════════════════════════════════════════
info "Creating namespaces…"
for ns in staging monitoring; do
  kubectl create namespace "${ns}" --dry-run=client -o yaml | kubectl apply -f -
done

# ════════════════════════════════════════════════════════════════════════════
# SECRETS
# ════════════════════════════════════════════════════════════════════════════
info "Creating secrets…"
kubectl apply -f - <<'EOF'
---
apiVersion: v1
kind: Secret
metadata:
  name: app-db-credentials
  namespace: default
type: Opaque
data:
  username: YWRtaW4=        # admin
  password: c3VwZXJzZWNyZXQ= # supersecret
---
apiVersion: v1
kind: Secret
metadata:
  name: tls-cert
  namespace: default
type: kubernetes.io/tls
data:
  tls.crt: ""
  tls.key: ""
---
apiVersion: v1
kind: Secret
metadata:
  name: registry-pull-secret
  namespace: default
type: kubernetes.io/dockerconfigjson
data:
  .dockerconfigjson: eyJhdXRocyI6e319
---
apiVersion: v1
kind: Secret
metadata:
  name: monitoring-token
  namespace: monitoring
type: Opaque
data:
  token: bXktbW9uaXRvcmluZy10b2tlbg==  # my-monitoring-token
---
apiVersion: v1
kind: Secret
metadata:
  name: staging-db-pass
  namespace: staging
type: Opaque
data:
  password: c3RhZ2luZ3Bhc3M=  # stagingpass
EOF

# ════════════════════════════════════════════════════════════════════════════
# CONFIGMAPS (used by some deployments below)
# ════════════════════════════════════════════════════════════════════════════
info "Creating ConfigMaps…"
kubectl apply -f - <<'EOF'
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config
  namespace: default
data:
  LOG_LEVEL: info
  MAX_CONNECTIONS: "50"
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: nginx-config
  namespace: staging
data:
  nginx.conf: |
    worker_processes 1;
    events { worker_connections 1024; }
    http { server { listen 80; location / { return 200 "ok"; } } }
EOF

# ════════════════════════════════════════════════════════════════════════════
# SERVICES  (ClusterIP, NodePort, headless)
# ════════════════════════════════════════════════════════════════════════════
info "Creating Services…"
kubectl apply -f - <<'EOF'
---
apiVersion: v1
kind: Service
metadata:
  name: frontend
  namespace: default
spec:
  selector:
    app: frontend
  type: ClusterIP
  ports:
    - name: http
      port: 80
      targetPort: 80
      protocol: TCP
---
apiVersion: v1
kind: Service
metadata:
  name: backend-api
  namespace: default
spec:
  selector:
    app: backend
  type: ClusterIP
  ports:
    - name: http
      port: 8080
      targetPort: 8080
      protocol: TCP
    - name: grpc
      port: 9090
      targetPort: 9090
      protocol: TCP
---
apiVersion: v1
kind: Service
metadata:
  name: nodeport-debug
  namespace: default
spec:
  selector:
    app: backend
  type: NodePort
  ports:
    - port: 8080
      targetPort: 8080
      nodePort: 30080
      protocol: TCP
---
apiVersion: v1
kind: Service
metadata:
  name: postgres-headless
  namespace: default
spec:
  selector:
    app: postgres
  clusterIP: None
  ports:
    - port: 5432
      targetPort: 5432
---
apiVersion: v1
kind: Service
metadata:
  name: nginx-staging
  namespace: staging
spec:
  selector:
    app: nginx
  type: ClusterIP
  ports:
    - port: 80
      targetPort: 80
---
apiVersion: v1
kind: Service
metadata:
  name: prometheus
  namespace: monitoring
spec:
  selector:
    app: prometheus
  type: ClusterIP
  ports:
    - name: web
      port: 9090
      targetPort: 9090
EOF

# ════════════════════════════════════════════════════════════════════════════
# DEPLOYMENTS
# ════════════════════════════════════════════════════════════════════════════
info "Creating Deployments…"
kubectl apply -f - <<'EOF'
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: frontend
  namespace: default
spec:
  replicas: 2
  selector:
    matchLabels:
      app: frontend
  template:
    metadata:
      labels:
        app: frontend
    spec:
      containers:
        - name: nginx
          image: nginx:1.25-alpine
          ports:
            - containerPort: 80
          resources:
            requests:
              cpu: 50m
              memory: 64Mi
            limits:
              cpu: 200m
              memory: 128Mi
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: backend
  namespace: default
spec:
  replicas: 3
  selector:
    matchLabels:
      app: backend
  template:
    metadata:
      labels:
        app: backend
    spec:
      containers:
        - name: backend
          image: hashicorp/http-echo:latest
          args: ["-text=hello from backend", "-listen=:8080"]
          ports:
            - containerPort: 8080
          envFrom:
            - configMapRef:
                name: app-config
          resources:
            requests:
              cpu: 50m
              memory: 32Mi
            limits:
              cpu: 100m
              memory: 64Mi
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nginx-staging
  namespace: staging
spec:
  replicas: 1
  selector:
    matchLabels:
      app: nginx
  template:
    metadata:
      labels:
        app: nginx
    spec:
      containers:
        - name: nginx
          image: nginx:1.25-alpine
          ports:
            - containerPort: 80
          volumeMounts:
            - name: config
              mountPath: /etc/nginx/nginx.conf
              subPath: nginx.conf
      volumes:
        - name: config
          configMap:
            name: nginx-config
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: prometheus
  namespace: monitoring
spec:
  replicas: 1
  selector:
    matchLabels:
      app: prometheus
  template:
    metadata:
      labels:
        app: prometheus
    spec:
      containers:
        - name: prometheus
          image: prom/prometheus:v2.51.2
          ports:
            - containerPort: 9090
          resources:
            requests:
              cpu: 100m
              memory: 256Mi
            limits:
              cpu: 500m
              memory: 512Mi
EOF

# ════════════════════════════════════════════════════════════════════════════
# STATEFULSETS
# ════════════════════════════════════════════════════════════════════════════
info "Creating StatefulSets…"
kubectl apply -f - <<'EOF'
---
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: postgres
  namespace: default
spec:
  serviceName: postgres-headless
  replicas: 1
  selector:
    matchLabels:
      app: postgres
  template:
    metadata:
      labels:
        app: postgres
    spec:
      containers:
        - name: postgres
          image: postgres:16-alpine
          ports:
            - containerPort: 5432
          env:
            - name: POSTGRES_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: app-db-credentials
                  key: password
            - name: POSTGRES_DB
              value: appdb
          resources:
            requests:
              cpu: 100m
              memory: 256Mi
            limits:
              cpu: 500m
              memory: 512Mi
          volumeMounts:
            - name: data
              mountPath: /var/lib/postgresql/data
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
        accessModes: [ReadWriteOnce]
        resources:
          requests:
            storage: 1Gi
---
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: redis
  namespace: default
spec:
  serviceName: redis
  replicas: 1
  selector:
    matchLabels:
      app: redis
  template:
    metadata:
      labels:
        app: redis
    spec:
      containers:
        - name: redis
          image: redis:7-alpine
          ports:
            - containerPort: 6379
          command: [redis-server, --save, "60", "1"]
          resources:
            requests:
              cpu: 50m
              memory: 64Mi
            limits:
              cpu: 200m
              memory: 128Mi
          volumeMounts:
            - name: data
              mountPath: /data
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
        accessModes: [ReadWriteOnce]
        resources:
          requests:
            storage: 512Mi
EOF

# ════════════════════════════════════════════════════════════════════════════
# STANDALONE PODS  (not managed by a controller — shows up in Pods table)
# ════════════════════════════════════════════════════════════════════════════
info "Creating standalone Pods…"
kubectl apply -f - <<'EOF'
---
apiVersion: v1
kind: Pod
metadata:
  name: debug-shell
  namespace: default
  labels:
    purpose: debug
spec:
  restartPolicy: Always
  containers:
    - name: shell
      image: busybox:1.36
      command: [sh, -c, "while true; do sleep 3600; done"]
      resources:
        requests:
          cpu: 10m
          memory: 16Mi
        limits:
          cpu: 50m
          memory: 32Mi
---
apiVersion: v1
kind: Pod
metadata:
  name: curl-probe
  namespace: staging
  labels:
    purpose: probe
spec:
  restartPolicy: Always
  containers:
    - name: curl
      image: curlimages/curl:8.7.1
      command: [sh, -c, "while true; do sleep 60; done"]
      resources:
        requests:
          cpu: 10m
          memory: 16Mi
        limits:
          cpu: 50m
          memory: 32Mi
EOF

# ════════════════════════════════════════════════════════════════════════════
# Wait for rollouts
# ════════════════════════════════════════════════════════════════════════════
info "Waiting for Deployments to roll out (images may need a moment to pull)…"
wait_deploy default  frontend
wait_deploy default  backend
wait_deploy staging  nginx-staging
wait_deploy monitoring prometheus

# ════════════════════════════════════════════════════════════════════════════
# Summary
# ════════════════════════════════════════════════════════════════════════════
echo ""
info "Cluster ready. Quick summary:"
echo ""
echo "  Namespaces:"
kubectl get ns --no-headers | awk '{printf "    %s\n", $1}'
echo ""
echo "  Deployments (all namespaces):"
kubectl get deployments -A --no-headers | awk '{printf "    %-20s %-20s %s/%s\n", $1, $2, $4, $3}'
echo ""
echo "  StatefulSets (all namespaces):"
kubectl get statefulsets -A --no-headers | awk '{printf "    %-20s %-20s %s/%s\n", $1, $2, $4, $3}'
echo ""
echo "  Services (all namespaces):"
kubectl get svc -A --no-headers | awk '{printf "    %-20s %-25s %s\n", $1, $2, $4}'
echo ""
info "Start the dashboard:"
echo ""
echo "    npm start"
echo ""
info "To tear down:  ./scripts/setup-kind.sh --delete"
echo ""
