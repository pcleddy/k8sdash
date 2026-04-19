# k8sdash — Specification

## Overview
A minimal single-page web app for browsing read-only Kubernetes cluster state. A tiny Node.js server reads the current kubeconfig at `~/.kube/config`, talks to the cluster via `@kubernetes/client-node`, and serves a static HTML page plus a small JSON API. The page renders five resource sections for the selected namespace.

## Goals
- Zero config beyond an existing, working `~/.kube/config`.
- Show the live state of the **current context** in the kubeconfig.
- Display five resource kinds side-by-side in one page: Deployments, Services, Secrets, Pods, StatefulSets.
- Let the user switch namespaces via a dropdown (defaults to `default`).
- Support manual refresh and automatic refresh every 2 minutes.

## Non-Goals (v1)
- Authentication / multi-user support (assumes single local user).
- Mutating the cluster (no create / edit / delete).
- Switching kube contexts or clusters from the UI.
- Streaming logs, exec into pods, port-forward.
- Advanced filtering, search, or sorting beyond simple table rendering.
- Production hardening (TLS termination, rate limiting, RBAC proxy).

## Users
A single local developer or operator who already has `kubectl` working against a cluster and wants a quick visual overview.

## Functional Requirements

### FR-1: Kubeconfig loading
The server MUST load the user's default kubeconfig (`~/.kube/config` or `$KUBECONFIG`) using `KubeConfig.loadFromDefault()`. The **current-context** determines the target cluster. If no valid context is found, the server returns a clear error on the relevant endpoints and logs a helpful message at startup.

### FR-2: Namespaces endpoint
`GET /api/namespaces` returns `{ namespaces: string[], current: string }`. `current` is `"default"` for the initial load. The client populates the dropdown from this list.

### FR-3: Resources endpoint
`GET /api/resources?namespace=<ns>` returns a single JSON payload with all five sections for one namespace:
```
{
  namespace: "default",
  fetchedAt: "2026-04-18T12:34:56.789Z",
  deployments:  [ ... ],
  services:     [ ... ],
  secrets:      [ ... ],
  pods:         [ ... ],
  statefulSets: [ ... ]
}
```
Each array item is a compact projection of the corresponding Kubernetes object (see Data Shapes below), not the raw API response.

### FR-4: Page layout
The SPA is a single HTML page with:
- A header containing the cluster/context name and a namespace `<select>` dropdown.
- A "Refresh" button and a small "Last updated …" timestamp.
- Five stacked sections, each a table: Deployments, Services, Secrets, Pods, StatefulSets.
- Each section shows a count badge and a table body; empty results render "No items."

### FR-5: Refresh behavior
The page fetches `/api/resources` on load, on namespace change, when the user clicks **Refresh**, and automatically every **120 seconds**. Auto-refresh can be toggled off via a checkbox (defaults on). A fetch in flight MUST cancel or supersede any pending auto-refresh so tabs left open do not pile up requests.

### FR-6: Error handling
If the backend returns an error (e.g., cluster unreachable, RBAC denied for a kind), the affected section shows an inline error message with the backend's error text, and the other sections still render if their fetches succeeded.

### FR-7: Secrets safety
The Secrets table MUST NOT display the decoded `data` values. It shows only: name, type, data-key count, age. This keeps secret material off the page by default.

## Data Shapes

### Deployment row
`{ name, replicas: { desired, ready, available, updated }, image: string[], age }`

### Service row
`{ name, type, clusterIP, externalIPs: string[], ports: string[] (e.g. "80/TCP"), age }`

### Secret row
`{ name, type, dataKeys: number, age }`  *(values intentionally omitted)*

### Pod row
`{ name, phase, ready: "m/n", restarts: number, node, age }`

### StatefulSet row
`{ name, replicas: { desired, ready }, serviceName, image: string[], age }`

`age` is a human-friendly string (e.g. `5d`, `3h`, `42m`) derived from `metadata.creationTimestamp`.

## HTTP API Summary
| Method | Path                              | Description                                |
|--------|-----------------------------------|--------------------------------------------|
| GET    | `/`                               | Serves `index.html`.                       |
| GET    | `/static/*`                       | Serves static client assets (JS, CSS).     |
| GET    | `/api/context`                    | Returns current context + cluster name.    |
| GET    | `/api/namespaces`                 | Returns list of namespaces.                |
| GET    | `/api/resources?namespace=<ns>`   | Returns all five resource lists for `ns`.  |

All API responses are JSON; errors use `{ error: string }` with an appropriate HTTP status code (`4xx` for client issues, `5xx` for backend/cluster issues).

## Configuration
| Variable     | Default     | Purpose                                    |
|--------------|-------------|--------------------------------------------|
| `PORT`       | `3000`      | HTTP port for the Node server.             |
| `KUBECONFIG` | unset       | If set, overrides `~/.kube/config`.        |
| `HOST`       | `127.0.0.1` | Bind address; keep loopback by default.    |

## Security Considerations
- Binds to `127.0.0.1` by default; no auth is added because the surface is localhost only.
- No mutation endpoints.
- Secret values are never serialized to the client.
- The server forwards whatever permissions the kubeconfig grants; the UI surfaces per-kind errors if RBAC denies a list call.

## Acceptance Criteria
1. `npm install && npm start` launches the server with only a working `~/.kube/config`.
2. Visiting `http://localhost:3000` shows the five sections populated with data from the `default` namespace.
3. Changing the dropdown re-queries the server and updates all five tables.
4. Clicking Refresh re-fetches immediately; the "Last updated" timestamp changes.
5. With auto-refresh enabled, tables update automatically about every 2 minutes.
6. If the cluster is unreachable, the page surfaces a clear error rather than hanging.
