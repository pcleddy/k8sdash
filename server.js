import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getContext, listContexts, switchContext, listNamespaces, listResources } from './lib/k8s.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, 'public');

const PORT = parseInt(process.env.PORT ?? '3000', 10);
const HOST = process.env.HOST ?? '127.0.0.1';

// ---------------------------------------------------------------------------
// Static file helpers
// ---------------------------------------------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

function serveFile(res, filePath) {
  const ext = path.extname(filePath);
  const contentType = MIME[ext] ?? 'application/octet-stream';
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

// ---------------------------------------------------------------------------
// JSON response helpers
// ---------------------------------------------------------------------------

function apiError(err) {
  if (err.name === 'AbortError' || err.type === 'aborted') {
    console.warn(`[timeout] ${err.message}`);
    return { status: 504, message: 'cluster request timed out' };
  }
  console.error(err);
  return { status: 500, message: err.message };
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

// Validate namespace: alphanumeric + hyphens, max 63 chars (RFC 1123)
function validNamespace(ns) {
  return typeof ns === 'string' && /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$|^[a-z0-9]$/.test(ns);
}

// ---------------------------------------------------------------------------
// Request handler
// ---------------------------------------------------------------------------

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  const { pathname } = url;

  console.log(`${req.method} ${pathname}`);

  // Serve index
  if (pathname === '/') {
    serveFile(res, path.join(PUBLIC, 'index.html'));
    return;
  }

  // Serve static assets: /static/<file>
  if (pathname.startsWith('/static/')) {
    const rel = pathname.slice('/static/'.length);
    // Prevent directory traversal
    const filePath = path.resolve(PUBLIC, rel);
    if (!filePath.startsWith(PUBLIC)) {
      json(res, 403, { error: 'Forbidden' });
      return;
    }
    serveFile(res, filePath);
    return;
  }

  // API routes
if (pathname === '/api/contexts' && req.method === 'GET') {
    try {
      json(res, 200, { contexts: listContexts(), current: getContext().context });
    } catch (err) {
      console.error(err);
      json(res, 500, { error: err.message });
    }
    return;
  }

  if (pathname === '/api/context' && req.method === 'GET') {
    try {
      json(res, 200, getContext());
    } catch (err) {
      console.error(err);
      json(res, 500, { error: err.message });
    }
    return;
  }

  if (pathname === '/api/context' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const { context } = JSON.parse(body);
        if (typeof context !== 'string' || !context) {
          json(res, 400, { error: 'context required' });
          return;
        }
        switchContext(context);
        json(res, 200, getContext());
      } catch (err) {
        console.error(err);
        json(res, 400, { error: err.message });
      }
    });
    return;
  }

  if (pathname === '/api/namespaces') {
    try {
      const namespaces = await listNamespaces();
      json(res, 200, { namespaces, current: 'default' });
    } catch (err) {
      const { status, message } = apiError(err);
      json(res, status, { error: message });
    }
    return;
  }

  if (pathname === '/api/resources') {
    const ns = url.searchParams.get('namespace') ?? 'default';
    if (!validNamespace(ns)) {
      json(res, 400, { error: 'invalid namespace' });
      return;
    }
    try {
      const data = await listResources(ns);
      json(res, 200, data);
    } catch (err) {
      const { status, message } = apiError(err);
      json(res, status, { error: message });
    }
    return;
  }

  json(res, 404, { error: 'Not found' });
}

// ---------------------------------------------------------------------------
// Server bootstrap
// ---------------------------------------------------------------------------

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((err) => {
    console.error('[unhandled]', err);
    try {
      json(res, 500, { error: 'Internal server error' });
    } catch (_) {
      res.end();
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[k8sdash] Listening on http://${HOST}:${PORT}`);
  try {
    const ctx = getContext();
    console.log(`[k8sdash] Context: ${ctx.context}  Cluster: ${ctx.cluster}  Server: ${ctx.server}`);
  } catch (err) {
    console.warn(`[k8sdash] Warning: ${err.message}`);
  }
});
