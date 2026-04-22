# k8sdash — Specification

## Overview
A minimal single-page web app for browsing and managing Kubernetes cluster state (read-only resources, with read-write support for secrets). A tiny Node.js server reads the current kubeconfig at `~/.kube/config`, talks to the cluster via `@kubernetes/client-node`, and serves a static HTML page plus a small JSON API. The page renders five resource sections for the selected namespace with actions for secret management.

## Goals
- Zero config beyond an existing, working `~/.kube/config`.
- Show the live state of the **current context** in the kubeconfig.
- Display five resource kinds side-by-side in one page: Deployments, Services, Secrets, Pods, StatefulSets.
- Let the user switch namespaces via a dropdown (defaults to `default`).
- Support manual refresh and automatic refresh every 2 minutes.

## Non-Goals (v1)
- Authentication / multi-user support (assumes single local user).
- Mutating other cluster resources (Deployments, Pods, etc.; secrets are an exception).
- Streaming logs, exec into pods, port-forward.
- Advanced filtering, search, or sorting beyond simple table rendering.
- Production hardening (TLS termination, rate limiting, RBAC proxy).

## Users
A single local developer or operator who already has `kubectl` working against a cluster and wants a quick visual overview.

## Functional Requirements

### FR-1: Kubeconfig loading and context switching
The server exposes `GET /api/contexts` to list all contexts in the kubeconfig and `POST /api/context` to switch the active context at runtime. After a context switch the server resets its API clients so subsequent requests target the new cluster.

### FR-1a: Kubeconfig loading
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
- A header containing a context `<select>` dropdown and a namespace `<select>` dropdown.
- A "Refresh" button and a small "Last updated …" timestamp.
- Five stacked sections, each a table: Deployments, Services, Secrets, Pods, StatefulSets.
- Each section shows a count badge and a table body; empty results render "No items."

### FR-5: Refresh behavior
The page fetches `/api/resources` on load, on namespace change, when the user clicks **Refresh**, and automatically every **120 seconds**. Auto-refresh can be toggled off via a checkbox (defaults on). A fetch in flight MUST cancel or supersede any pending auto-refresh so tabs left open do not pile up requests.

### FR-6: Error handling
If the backend returns an error (e.g., cluster unreachable, RBAC denied for a kind), the affected section shows an inline error message with the backend's error text, and the other sections still render if their fetches succeeded.

### FR-7: Secrets management
The Secrets table shows: name, type, data-key count, age. Secret values are **not displayed by default** (hidden for safety). Each secret row has two action buttons:
- **Show**: Fetches and displays decoded secret values in a read-only modal.
- **Edit**: Opens a modal to create/modify secret key/value pairs. Values support multiline input for storing file contents (INI, JSON, YAML, etc.).

### FR-8: Secret creation and editing
- **Create**: "+ Add Secret" button in the Secrets header. Form allows:
  - Namespace selection
  - Secret name input (alphanumeric + hyphens)
  - Multiple key/value pairs (dynamic add/remove)
  - Multiline value support for file contents
  - Server validates and creates Opaque-type secret via Kubernetes API

- **Edit**: "Edit" button on each secret row. Form allows:
  - View/modify current secret data
  - Namespace and name fields locked (read-only)
  - Add/remove key/value pairs
  - Server uses PUT (full replacement) to update secret, preserving metadata

- **View**: "Show" button fetches secret and displays all decoded key/value pairs in a modal with proper formatting (whitespace/newlines preserved).

All operations respect kubeconfig permissions; cluster RBAC denies unauthorized mutations.

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
| Method | Path                                      | Description                                         |
|--------|-------------------------------------------|-----------------------------------------------------|
| GET    | `/`                                       | Serves `index.html`.                                |
| GET    | `/static/*`                               | Serves static client assets (JS, CSS).              |
| GET    | `/api/contexts`                           | Returns `{ contexts: string[], current: string }`.  |
| GET    | `/api/context`                            | Returns current context + cluster name.             |
| POST   | `/api/context`                            | Switches context; body `{ context: string }`.       |
| GET    | `/api/namespaces`                         | Returns list of namespaces.                         |
| GET    | `/api/resources?namespace=<ns>`           | Returns all five resource lists for `ns`.           |
| POST   | `/api/secrets`                            | Creates a secret; body `{ namespace, name, data }`. |
| GET    | `/api/secrets/:namespace/:name`           | Returns decoded secret; `{ name, namespace, type, data }`. |
| PUT    | `/api/secrets/:namespace/:name`           | Updates secret data; body `{ data }`. Preserves metadata. |

All API responses are JSON; errors use `{ error: string }` with an appropriate HTTP status code (`4xx` for client issues, `5xx` for backend/cluster issues).

## Configuration
| Variable     | Default     | Purpose                                    |
|--------------|-------------|--------------------------------------------|
| `PORT`       | `3000`      | HTTP port for the Node server.             |
| `KUBECONFIG` | unset       | If set, overrides `~/.kube/config`.        |
| `HOST`       | `127.0.0.1` | Bind address; keep loopback by default.    |

## Security Considerations
- Binds to `127.0.0.1` by default; no auth is added because the surface is localhost only.
- Secret mutation endpoints (`POST`, `PUT`) exist only for secrets; all other resources are read-only.
- Secret values are **not displayed by default**; revealed only via explicit "Show" action.
- All secret operations (create, view, edit) respect kubeconfig permissions. The server forwards whatever permissions the kubeconfig grants; cluster RBAC denies unauthorized mutations.
- Base64-encoded values are decoded only for display and storage; never logged or persisted unencrypted.

## Acceptance Criteria

### Core (Read-Only)
1. `npm install && npm start` launches the server with only a working `~/.kube/config`.
2. Visiting `http://localhost:3000` shows the five sections populated with data from the `default` namespace.
3. Changing the dropdown re-queries the server and updates all five tables.
4. Clicking Refresh re-fetches immediately; the "Last updated" timestamp changes.
5. With auto-refresh enabled, tables update automatically about every 2 minutes.
6. If the cluster is unreachable, the page surfaces a clear error rather than hanging.

### Secret Management
7. Click "+ Add Secret" button opens a form to create a secret with namespace, name, and key/value pairs.
8. Value fields support multiline input; INI/JSON/YAML file contents can be pasted as values.
9. Submitting creates the secret in the cluster; table refreshes and shows success message.
10. Click "Show" on a secret opens a read-only modal displaying all decoded key/value pairs (preserving multiline formatting).
11. Click "Edit" on a secret opens the form pre-populated with current data; namespace and name fields are locked.
12. Editing and submitting updates the secret in place, preserving metadata; shows success message.
13. Creating/editing respects kubeconfig RBAC; cluster rejection errors surface clearly.
