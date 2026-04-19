// k8sdash — client-side app (vanilla ES modules, no bundler)

const AUTO_REFRESH_MS = 120_000;

// DOM refs
const ctxSelect    = document.getElementById('ctx-select');
const nsSelect     = document.getElementById('ns-select');
const refreshBtn   = document.getElementById('refresh-btn');
const autoRefreshCb = document.getElementById('auto-refresh');
const lastUpdated  = document.getElementById('last-updated');
const errorBanner  = document.getElementById('error-banner');

// In-flight AbortController for resource fetches
let controller = null;
let autoTimer  = null;

// ---------------------------------------------------------------------------
// Error banner
// ---------------------------------------------------------------------------

function showBanner(msg) {
  errorBanner.textContent = msg;
  errorBanner.classList.add('visible');
}
function hideBanner() {
  errorBanner.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function phaseClass(phase) {
  const map = { Running: 'phase-running', Pending: 'phase-pending',
                Failed: 'phase-failed', Succeeded: 'phase-succeeded' };
  return map[phase] ?? 'phase-unknown';
}

function setBadge(id, count) {
  const el = document.getElementById(`badge-${id}`);
  if (el) el.textContent = count;
}

function setBody(id, html) {
  const el = document.getElementById(`tbody-${id}`);
  if (el) el.innerHTML = html;
}

// ---------------------------------------------------------------------------
// Render functions per resource type
// ---------------------------------------------------------------------------

function renderDeployments(items) {
  if (!items.length) return '<tr class="empty-row"><td colspan="6">No items.</td></tr>';
  return items.map((d) => `<tr>
    <td>${esc(d.name)}</td>
    <td>${esc(d.replicas.ready)}/${esc(d.replicas.desired)}</td>
    <td>${esc(d.replicas.available)}</td>
    <td>${esc(d.replicas.updated)}</td>
    <td>${d.image.map(esc).join('<br>')}</td>
    <td>${esc(d.age)}</td>
  </tr>`).join('');
}

function renderServices(items) {
  if (!items.length) return '<tr class="empty-row"><td colspan="6">No items.</td></tr>';
  return items.map((s) => `<tr>
    <td>${esc(s.name)}</td>
    <td>${esc(s.type)}</td>
    <td>${esc(s.clusterIP)}</td>
    <td>${s.externalIPs.length ? s.externalIPs.map(esc).join(', ') : '–'}</td>
    <td>${s.ports.length ? s.ports.map(esc).join(', ') : '–'}</td>
    <td>${esc(s.age)}</td>
  </tr>`).join('');
}

function renderSecrets(items) {
  if (!items.length) return '<tr class="empty-row"><td colspan="4">No items.</td></tr>';
  return items.map((s) => `<tr>
    <td>${esc(s.name)}</td>
    <td>${esc(s.type)}</td>
    <td>${esc(s.dataKeys)}</td>
    <td>${esc(s.age)}</td>
  </tr>`).join('');
}

function renderPods(items) {
  if (!items.length) return '<tr class="empty-row"><td colspan="6">No items.</td></tr>';
  return items.map((p) => `<tr>
    <td>${esc(p.name)}</td>
    <td><span class="phase ${phaseClass(p.phase)}">${esc(p.phase)}</span></td>
    <td>${esc(p.ready)}</td>
    <td>${esc(p.restarts)}</td>
    <td>${esc(p.node)}</td>
    <td>${esc(p.age)}</td>
  </tr>`).join('');
}

function renderStatefulSets(items) {
  if (!items.length) return '<tr class="empty-row"><td colspan="5">No items.</td></tr>';
  return items.map((ss) => `<tr>
    <td>${esc(ss.name)}</td>
    <td>${esc(ss.replicas.ready)}/${esc(ss.replicas.desired)}</td>
    <td>${esc(ss.serviceName)}</td>
    <td>${ss.image.map(esc).join('<br>')}</td>
    <td>${esc(ss.age)}</td>
  </tr>`).join('');
}

function renderSection(key, renderFn, colspan) {
  return (data) => {
    if (data && data.error) {
      setBadge(key, '!');
      setBody(key, `<tr><td colspan="${colspan}"><div class="section-error">Error: ${esc(data.error)}</div></td></tr>`);
    } else {
      const items = Array.isArray(data) ? data : [];
      setBadge(key, items.length);
      setBody(key, renderFn(items));
    }
  };
}

const applyDeployments  = renderSection('deployments',  renderDeployments,  6);
const applyServices     = renderSection('services',     renderServices,     6);
const applySecrets      = renderSection('secrets',      renderSecrets,      4);
const applyPods         = renderSection('pods',         renderPods,         6);
const applyStatefulSets = renderSection('statefulsets', renderStatefulSets, 5);

// ---------------------------------------------------------------------------
// Context switching
// ---------------------------------------------------------------------------

async function switchContext(name) {
  ctxSelect.disabled = true;
  nsSelect.disabled = true;
  try {
    const res = await fetch('/api/context', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context: name }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    hideBanner();
    await reloadNamespaces();
    refresh();
  } catch (err) {
    showBanner(`Failed to switch context: ${err.message}`);
  } finally {
    ctxSelect.disabled = false;
  }
}

async function reloadNamespaces() {
  nsSelect.disabled = true;
  try {
    const res = await fetch('/api/namespaces');
    if (!res.ok) return;
    const { namespaces } = await res.json();
    nsSelect.innerHTML = namespaces
      .map((ns) => `<option value="${esc(ns)}">${esc(ns)}</option>`)
      .join('');
    nsSelect.value = namespaces.includes('default') ? 'default' : (namespaces[0] ?? '');
  } finally {
    nsSelect.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Fetch resources
// ---------------------------------------------------------------------------

async function fetchResources(namespace) {
  // Cancel any in-flight fetch
  if (controller) controller.abort();
  controller = new AbortController();
  const { signal } = controller;

  try {
    const res = await fetch(`/api/resources?namespace=${encodeURIComponent(namespace)}`, { signal });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    const data = await res.json();
    hideBanner();

    applyDeployments(data.deployments);
    applyServices(data.services);
    applySecrets(data.secrets);
    applyPods(data.pods);
    applyStatefulSets(data.statefulSets);

    const ts = data.fetchedAt ? new Date(data.fetchedAt).toLocaleTimeString() : new Date().toLocaleTimeString();
    lastUpdated.textContent = `Last updated: ${ts}`;
  } catch (err) {
    if (err.name === 'AbortError') return; // superseded — ignore
    showBanner(`Failed to fetch resources: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Auto-refresh
// ---------------------------------------------------------------------------

function scheduleAutoRefresh() {
  clearTimeout(autoTimer);
  if (!autoRefreshCb.checked) return;
  autoTimer = setTimeout(() => {
    if (document.visibilityState === 'visible') {
      fetchResources(nsSelect.value);
    }
    scheduleAutoRefresh();
  }, AUTO_REFRESH_MS);
}

// Reset the timer whenever we do a manual/triggered refresh
function refresh() {
  fetchResources(nsSelect.value);
  scheduleAutoRefresh();
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

async function init() {
  const [ctxRes, nsRes] = await Promise.allSettled([
    fetch('/api/contexts').then((r) => r.json()),
    fetch('/api/namespaces').then((r) => r.json()),
  ]);

  if (ctxRes.status === 'fulfilled' && !ctxRes.value.error) {
    const { contexts, current } = ctxRes.value;
    ctxSelect.innerHTML = contexts
      .map((c) => `<option value="${esc(c)}"${c === current ? ' selected' : ''}>${esc(c)}</option>`)
      .join('');
    ctxSelect.disabled = false;
  }

  if (nsRes.status === 'fulfilled' && !nsRes.value.error) {
    const { namespaces } = nsRes.value;
    nsSelect.innerHTML = namespaces
      .map((ns) => `<option value="${esc(ns)}">${esc(ns)}</option>`)
      .join('');
    nsSelect.value = namespaces.includes('default') ? 'default' : (namespaces[0] ?? '');
    nsSelect.disabled = false;
  } else {
    nsSelect.disabled = false;
  }

  refresh();
}

// ---------------------------------------------------------------------------
// Event listeners
// ---------------------------------------------------------------------------

ctxSelect.addEventListener('change', () => switchContext(ctxSelect.value));
nsSelect.addEventListener('change', () => refresh());
refreshBtn.addEventListener('click', () => refresh());
autoRefreshCb.addEventListener('change', () => scheduleAutoRefresh());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') scheduleAutoRefresh();
});

init().catch((err) => showBanner(`Startup error: ${err.message}`));
