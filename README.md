# k8sdash

A tiny single-page Kubernetes dashboard. A small Node.js server reads your existing `~/.kube/config`, talks to the cluster with `@kubernetes/client-node`, and serves a one-page UI that lists **Deployments, Services, Secrets, Pods, and StatefulSets** for a selected namespace.

Read-only. Localhost by default. No database, no build step.

## Requirements
- Node.js **18+** (uses built-in `fetch` and modern ESM).
- A working `~/.kube/config` — i.e. `kubectl get pods` already works on your machine.
- Network access from your machine to the cluster's API server.

## Quick start
```bash
# from the project root
npm install
npm start
```
Then open <http://localhost:3000>.

The dashboard uses the **current-context** from your kubeconfig and loads the `default` namespace on first paint. Use the dropdown to switch namespaces.

## Configuration
Environment variables, all optional:

| Variable     | Default     | Purpose                                       |
|--------------|-------------|-----------------------------------------------|
| `PORT`       | `3000`      | HTTP port for the server.                     |
| `HOST`       | `127.0.0.1` | Bind address. Keep on loopback unless needed. |
| `KUBECONFIG` | unset       | Path to a kubeconfig (overrides `~/.kube/config`). |

Example:
```bash
PORT=8080 KUBECONFIG=~/.kube/prod npm start
```

## Usage
- **Context dropdown** — switches the active kubeconfig context; reloads namespaces and all five tables.
- **Namespace dropdown** — switches the fetch target; all five tables reload.
- **Refresh** button — forces an immediate re-fetch.
- **Auto-refresh** checkbox — on by default; refetches every 2 minutes.
- **Last updated** timestamp — when the current data was retrieved.

Secrets are shown by **name, type, key count, and age**. Values are never sent to the browser.

## Endpoints (for curl / debugging)
- `GET /api/contexts` — `{ contexts: string[], current: "<name>" }`.
- `GET /api/context` — current context, cluster, user, and server.
- `POST /api/context` — switch context; body `{ "context": "<name>" }`.
- `GET /api/namespaces` — `{ namespaces: string[], current: "default" }`.
- `GET /api/resources?namespace=default` — combined payload used by the UI.

## Local development (kind cluster)
If you don't have a cluster handy, `scripts/setup-kind.sh` spins up a local [kind](https://kind.sigs.k8s.io/) cluster pre-loaded with sample objects across three namespaces (`default`, `staging`, `monitoring`):

```bash
# Prerequisites: docker, kind, kubectl
./scripts/setup-kind.sh          # create cluster + load fixtures, then npm start
./scripts/setup-kind.sh --delete # tear down when done
```

The script creates Deployments, StatefulSets (postgres, redis), Services, Secrets, and standalone Pods so every table in the dashboard has data to show.

## Project layout
```
k8sdash/
  server.js              # Node HTTP server + API routes
  lib/
    k8s.js               # @kubernetes/client-node wrapper, projections
    age.js               # creationTimestamp → human age string ("5d", "3h")
  public/
    index.html           # single-page UI shell
    app.js               # client-side fetch + render
    styles.css           # styles
  scripts/
    setup-kind.sh        # spin up a local kind cluster with sample fixtures
  test/
    age.test.js          # unit tests for age helper
    projections.test.js  # unit tests for k8s projection functions
  package.json
  SPEC.md  ARCH.md  README.md
```

## Troubleshooting
- **`ENOENT ~/.kube/config`** — no kubeconfig found. Set `KUBECONFIG` or create one with `kubectl config`.
- **`Unable to connect to the server`** — the cluster API is unreachable. Try `kubectl get ns` to confirm outside the app.
- **Some tables say "Forbidden"** — your context's RBAC denies listing that kind. The other tables still render.
- **Nothing updates** — check the browser console for fetch errors; check the server console for stack traces.

## Scripts
| Command        | What it does                           |
|----------------|----------------------------------------|
| `npm start`    | Starts the server on `$PORT`           |
| `npm run dev`  | Starts with `--watch` reload           |
| `npm test`     | Runs unit tests (`test/*.test.js`)     |

## License
MIT (or your preference — update before publishing).
