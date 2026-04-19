# k8sdash — Architecture

## Big picture
```
+----------------------+         +----------------------+         +-------------------+
|   Browser (SPA)      |  HTTP   |  Node.js server      |  HTTPS  |  Kubernetes API   |
|  index.html + app.js | <-----> |  server.js + lib/k8s | <-----> |  (current context)|
+----------------------+  JSON   +----------------------+  JSON   +-------------------+
```
The server is a thin adapter: it loads the kubeconfig, calls the cluster, projects raw K8s objects into small row-shaped JSON, and hands that to the browser. The browser renders tables. There is no build step and no client framework.

## Components

### 1. Node HTTP server (`server.js`)
- Uses Node's built-in `http` module (or optionally Express — see "Choices" below).
- Binds to `HOST`:`PORT` (default `127.0.0.1:3000`).
- Responsibilities:
  - Serve `public/index.html` at `/`.
  - Serve static assets under `/static/*`.
  - Route `/api/contexts`, `/api/context` (GET + POST), `/api/namespaces`, `/api/resources` to handlers in `lib/k8s.js`.
  - Translate thrown errors into `{ error }` JSON with an appropriate status code.
  - Log requests and cluster errors to stdout/stderr.

### 2. Kubernetes adapter (`lib/k8s.js`)
- Singleton `KubeConfig` loaded at startup via `kc.loadFromDefault()`.
- API clients created lazily and **reset on context switch**:
  - `CoreV1Api`  → namespaces, services, secrets, pods.
  - `AppsV1Api`  → deployments, stateful sets.
- All cluster requests carry an `AbortSignal.timeout(8000)` via a middleware; the server maps the resulting `AbortError` to a `504` response.
- Exposes small async functions the server calls:
  - `listContexts()` → `string[]`
  - `switchContext(name)` → void (validates name, calls `kc.setCurrentContext`, resets clients)
  - `getContext()` → `{ context, cluster, user, server }`
  - `listNamespaces()` → `string[]`
  - `listResources(ns)` → `{ deployments, services, secrets, pods, statefulSets, fetchedAt }`
- Uses `Promise.allSettled` for the five list calls so one failure does not wipe the whole page; per-kind errors surface as `{ error }` within that section's payload.
- Projection helpers convert raw K8s objects into the row shapes defined in `SPEC.md`. Secrets projection **omits `data`**.

### 3. Static client (`public/`)
- `index.html` — semantic layout: header (context dropdown, namespace dropdown, refresh button, auto-refresh toggle, last-updated), then five `<section>` blocks, each with an `<h2>`, count badge, and a `<table>`.
- `app.js` — vanilla ES modules. Responsibilities:
  - On load, fetch `/api/contexts` and `/api/namespaces` in parallel, then `/api/resources?namespace=default`.
  - Debounced refresh: a single in-flight fetch; new requests abort the previous via `AbortController`.
  - Auto-refresh via recursive `setTimeout` at 120_000 ms (not `setInterval`), gated by a checkbox and `document.visibilityState === "visible"`. The timer restarts *after* each fetch completes, so slow fetches never overlap.
  - Small render functions per section; empty results show "No items."; per-section errors show inline.
- `styles.css` — minimal CSS; plain HTML tables, sticky header, monospace for names/IPs.

## Data flow: a single page load
1. Browser requests `/` → server responds with `index.html`.
2. Browser fetches `/api/contexts` and `/api/namespaces` in parallel (populates both dropdowns).
3. Browser fetches `/api/resources?namespace=default`.
4. Server calls K8s API via `AppsV1Api` and `CoreV1Api` in parallel, projects results, returns JSON.
5. Browser renders five tables and updates "Last updated".
6. Every 120 seconds (if auto-refresh enabled and tab visible), step 3 repeats for the currently-selected namespace.

## Error taxonomy
| Scenario                                     | Where handled        | User sees                                          |
|---------------------------------------------|----------------------|----------------------------------------------------|
| No kubeconfig / no current-context           | `lib/k8s.js` init    | Startup log + red banner on first fetch.           |
| Cluster request times out (>8 s)             | timeout middleware   | `504 { error: "cluster request timed out" }`.      |
| Cluster unreachable (network / DNS)          | server fetch catch   | Page-level error banner.                           |
| RBAC forbidden on one kind                   | `Promise.allSettled` | Inline error in just that section's card.          |
| Unknown context name in POST /api/context    | `switchContext()`    | `400 { error: "Unknown context: <name>" }`.        |
| Malformed namespace param                    | request validation   | `400 { error: "invalid namespace" }`.              |
| Unexpected server exception                  | global error hook    | `500 { error }`, console stack trace.              |

## Concurrency & performance
- Five list calls run in parallel per refresh; typical small clusters respond in <500 ms total.
- Client uses `AbortController` to drop stale responses from the previous namespace when the user switches quickly.
- No caching in v1 — each refresh is a live call. A simple TTL cache could be added in `lib/k8s.js` if needed later.

## Security posture
- Loopback-only bind by default (`127.0.0.1`). Changing `HOST` to `0.0.0.0` exposes the API to your LAN — do that only knowingly.
- No auth layer on `/api/*`: the server trusts whoever hits loopback. Anyone on the machine with a browser effectively has your `kubectl` perms via this process. Treat it like `kubectl proxy`.
- Secrets are projected to `{ name, type, dataKeys, age }` **before** leaving the server. Raw `data` never crosses the wire.
- TLS to the API server is handled by `@kubernetes/client-node` using the CA from your kubeconfig.

## Choices (and the alternatives considered)
- **`@kubernetes/client-node`** over shelling out to `kubectl`: stable Node API, reads kubeconfig the same way, no subprocess overhead, returns typed objects.
- **Vanilla JS + no bundler** over React/Vue: the page is five tables; a framework is dead weight and would add a build step.
- **Built-in `http`** over Express: optional. If we want slightly nicer routing/static serving we can swap in Express without changing the client. `SPEC.md` and this doc are agnostic.
- **Polling 120 s** over Server-Sent Events / WebSockets: simpler, matches the "just a dashboard" scope. SSE can be added later in `lib/k8s.js` + a `/api/stream` route.

## Extension points (future)
- Namespace-scoped **search/filter** field in the header.
- Row drill-down: click a pod/deployment to see YAML in a side panel (read-only).
- SSE stream for live updates without polling.
- Simple in-memory TTL cache in `lib/k8s.js` (5–10 s) to protect the API server if the page is kept open in many tabs.

## File map
```
server.js              # HTTP server + routing
lib/
  k8s.js               # kubeconfig + API client + projections
  age.js               # creationTimestamp → human age string ("5d", "3h")
public/
  index.html           # SPA shell
  app.js               # fetch + render
  styles.css           # styles
scripts/
  setup-kind.sh        # local kind cluster with sample fixtures for dev/testing
test/
  age.test.js          # unit tests for age helper
  projections.test.js  # unit tests for k8s projection functions
package.json
SPEC.md  README.md  ARCH.md
```
