# k8sdash — Feature Roadmap

**Status indicators**:
- 🟡 **Not started** — Listed but no work yet
- 🟠 **In progress** — Actively working on it
- 🟢 **Complete** — Implemented, tested, working
- ⚠️ **Partial** — Some functionality done, more work needed
- ❌ **Blocked** — Issue preventing progress (document below)

---

## Core Features

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| 1 | **Pod Logs** — View stdout/stderr from containers (tail, follow, search) | 🟢 Complete | Last 200 lines per container; multi-container dropdown; terminal-style view |
| 2 | **Port Forward** — Proxy local port to service/pod for dev access | 🟡 Not started | Requires TCP tunneling; may need separate daemon or `kubectl port-forward` wrapper |
| 3 | **Exec/Shell** — Interactive terminal into running pods | 🟡 Not started | Complex; needs SPDY/WebSocket for interactivity; security implications |
| 4 | **Resource YAML Editor** — View/edit raw manifests (Deployments, Services, etc.) | 🟡 Not started | Start with read-only, then add edit capability for other resource types |
| 5 | **Pod Metrics** — Real-time CPU/memory usage per pod | 🟡 Not started | Requires metrics-server; would query Prometheus or metrics API |
| 6 | **Deployment Scaling** — Scale replicas up/down directly from UI | 🟡 Not started | Straightforward PATCH endpoint; similar to secret edit pattern |
| 7 | **Events Stream** — Cluster events log (pod crashes, warnings, status changes) | 🟡 Not started | List events per namespace; consider auto-refresh or tail |
| 8 | **ConfigMap/Secret Browser** — View/manage all configs and secrets in namespace | ⚠️ Partial | Secrets viewing/create/edit done; ConfigMaps read-only; need ConfigMap mutations |
| 9 | **Pod Describe** — Full pod metadata (conditions, events, resource requests, node assignment) | 🟢 Complete | Status, conditions, containers, labels, events, raw YAML toggle |
| 10 | **Resource Deletion** — Safe delete with confirmation (pods, deployments, etc.) | 🟡 Not started | Start with secrets; add confirmation modal; could cascade to other resource types |

---

## Completed Features

- ✅ **Secret Management** — Create, view (Show), edit with multiline value support
- ✅ **Pod Debugging** — Describe (status, conditions, containers, events) + Logs (multi-container, dark terminal view)
- ✅ **Context Switching** — Switch between kubeconfig contexts at runtime
- ✅ **Namespace Browsing** — View resources across all namespaces
- ✅ **Auto-refresh** — Automatic refresh every 2 minutes with manual override

---

## Implementation Notes

### Easy wins (1-2 effort)
- Pod describe: Fetch full pod object, render JSON or structured UI
- Events: List events per namespace, auto-refresh
- Pod logs: Hook into existing Kubernetes API (no WebSocket needed for initial version)

### Medium complexity (2-3 effort)
- Deployment scaling: Similar to secret edit; PATCH replicas field
- ConfigMap CRUD: Apply same create/edit/delete pattern as secrets
- Resource YAML editor (read-only first): Display raw manifest, format nicely

### Higher complexity (3-5+ effort)
- Port forward: Requires TCP tunneling or wrapper around `kubectl`
- Exec/shell: Needs SPDY or WebSocket; significant security review needed
- Metrics: Depends on metrics-server availability; Prometheus integration optional
- Streaming logs: Consider server-sent events (SSE) or polling for MVP

---

## Blocked Issues

None currently.

---

## Notes

- All features respect kubeconfig RBAC permissions (cluster denies unauthorized operations)
- UI should follow existing k8sdash patterns: modals for actions, tables for lists, green success banners
- Multiline value support added for INI/JSON/YAML config storage (secrets feature)
