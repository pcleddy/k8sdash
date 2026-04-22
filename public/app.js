// k8sdash — client-side app (vanilla ES modules, no bundler)

const AUTO_REFRESH_MS = 120_000;

// DOM refs
const ctxSelect    = document.getElementById('ctx-select');
const nsSelect     = document.getElementById('ns-select');
const refreshBtn   = document.getElementById('refresh-btn');
const autoRefreshCb = document.getElementById('auto-refresh');
const lastUpdated  = document.getElementById('last-updated');
const errorBanner  = document.getElementById('error-banner');

// Secret modal refs
const addSecretModal = document.getElementById('add-secret-modal');
const addSecretBtn   = document.getElementById('add-secret-btn');
const modalClose     = document.getElementById('modal-close');
const modalCancel    = document.getElementById('modal-cancel');
const addSecretForm  = document.getElementById('add-secret-form');
const secretNs       = document.getElementById('secret-ns');
const secretName     = document.getElementById('secret-name');
const kvPairs        = document.getElementById('kv-pairs');
const addKvBtn       = document.getElementById('add-kv-btn');
let kvCounter        = 0;
let modalMode        = 'create'; // 'create' or 'edit'
let editingSecret    = null; // { namespace, name } when editing

// View secret modal refs
const viewSecretModal    = document.getElementById('view-secret-modal');
const viewSecretName     = document.getElementById('view-secret-name');
const viewSecretBody     = document.getElementById('view-secret-body');
const viewClose          = document.getElementById('view-close');
const viewCloseBtn       = document.getElementById('view-close-btn');

// Pod logs modal refs
const podLogsModal       = document.getElementById('pod-logs-modal');
const logsPodsName       = document.getElementById('logs-pod-name');
const logsBody           = document.getElementById('pod-logs-body');
const logsContainerSelect = document.getElementById('logs-container-select');
const logsClose          = document.getElementById('logs-close');
const logsCloseBtn       = document.getElementById('logs-close-btn');
let currentPodName       = null;
let currentPodNamespace  = null;
let currentContainers    = [];

// Describe pod modal refs
const describePodModal   = document.getElementById('describe-pod-modal');
const describePodName    = document.getElementById('describe-pod-name');
const describePodBody    = document.getElementById('describe-pod-body');
const describeClose      = document.getElementById('describe-close');
const describeCloseBtn   = document.getElementById('describe-close-btn');
const yamlToggle        = document.getElementById('yaml-toggle');

// In-flight AbortController for resource fetches
let controller = null;
let autoTimer  = null;

// ---------------------------------------------------------------------------
// Error banner
// ---------------------------------------------------------------------------

function showBanner(msg) {
  errorBanner.textContent = msg;
  errorBanner.classList.add('visible');
  // Add success styling if message starts with ✓
  if (msg.startsWith('✓')) {
    errorBanner.classList.add('success');
  } else {
    errorBanner.classList.remove('success');
  }
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
  if (!items.length) return '<tr class="empty-row"><td colspan="5">No items.</td></tr>';
  return items.map((s) => `<tr>
    <td>${esc(s.name)}</td>
    <td>${esc(s.type)}</td>
    <td>${esc(s.dataKeys)}</td>
    <td>${esc(s.age)}</td>
    <td>
      <button class="show-secret-btn" data-name="${esc(s.name)}" type="button" title="View secret values">Show</button>
      <button class="edit-secret-btn" data-name="${esc(s.name)}" type="button" title="Edit secret">Edit</button>
    </td>
  </tr>`).join('');
}

function renderPods(items) {
  if (!items.length) return '<tr class="empty-row"><td colspan="8">No items.</td></tr>';
  return items.map((p) => `<tr>
    <td>${esc(p.name)}</td>
    <td><span class="phase ${phaseClass(p.phase)}">${esc(p.phase)}</span></td>
    <td>${esc(p.ready)}</td>
    <td>${esc(p.restarts)}</td>
    <td>${esc(p.node)}</td>
    <td>${esc(p.age)}</td>
    <td>
      <button class="logs-pod-btn" data-name="${esc(p.name)}" type="button" title="View pod logs">Logs</button>
      <button class="describe-pod-btn" data-name="${esc(p.name)}" type="button" title="View pod details">Describe</button>
    </td>
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
const applySecrets      = renderSection('secrets',      renderSecrets,      5);
const applyPods         = renderSection('pods',         renderPods,         8);
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
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      showBanner(`Could not load namespaces: ${body.error ?? `HTTP ${res.status}`}`);
      return;
    }
    const { namespaces } = body;
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
// View secret modal
// ---------------------------------------------------------------------------

async function openViewSecretModal(namespace, name) {
  viewSecretName.textContent = name;
  viewSecretBody.innerHTML = '<div style="color: #94a3b8;">Loading…</div>';
  viewSecretModal.showModal();

  try {
    const res = await fetch(`/api/secrets/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }

    const secret = await res.json();

    // Build HTML to display key/value pairs
    const kvHtml = Object.entries(secret.data ?? {})
      .map(([key, value]) => `
        <div class="secret-kv-display">
          <div class="kv-key-display">${esc(key)}</div>
          <div class="kv-value-display"><code>${esc(value)}</code></div>
        </div>
      `)
      .join('');

    const html = `
      <div class="secret-view-info">
        <p><strong>Namespace:</strong> ${esc(namespace)}</p>
        <p><strong>Type:</strong> ${esc(secret.type)}</p>
        <p><strong>Keys:</strong> ${Object.keys(secret.data ?? {}).length}</p>
      </div>
      <div class="secret-view-data">
        <h3>Data</h3>
        ${kvHtml}
      </div>
    `;

    viewSecretBody.innerHTML = html;
  } catch (err) {
    viewSecretBody.innerHTML = `<div style="color: #dc2626;">Error: ${esc(err.message)}</div>`;
  }
}

function closeViewSecretModal() {
  viewSecretModal.close();
}

// ---------------------------------------------------------------------------
// Secret creation modal
// ---------------------------------------------------------------------------

function openAddSecretModal() {
  modalMode = 'create';
  editingSecret = null;

  // Update modal header
  document.querySelector('.modal-header h2').textContent = 'Create Secret';
  document.getElementById('modal-submit').textContent = 'Create Secret';

  // Populate namespace dropdown in modal from current namespaces
  const nsOptions = Array.from(nsSelect.options).map((opt) => opt.value);
  secretNs.innerHTML = nsOptions
    .map((ns) => `<option value="${esc(ns)}"${ns === nsSelect.value ? ' selected' : ''}>${esc(ns)}</option>`)
    .join('');

  // Enable namespace and name fields
  secretNs.disabled = false;
  secretName.disabled = false;

  // Clear form
  secretName.value = '';
  kvPairs.innerHTML = '';
  kvCounter = 0;
  addKeyValuePair(); // Start with one empty pair

  addSecretModal.showModal();
}

async function openEditSecretModal(namespace, name) {
  modalMode = 'edit';
  editingSecret = { namespace, name };

  // Update modal header
  document.querySelector('.modal-header h2').textContent = 'Edit Secret';
  document.getElementById('modal-submit').textContent = 'Update Secret';

  // Disable namespace and name (can't change these)
  secretNs.disabled = true;
  secretName.disabled = true;

  // Clear form while loading
  secretNs.innerHTML = '';
  secretName.value = 'Loading…';
  kvPairs.innerHTML = '';

  try {
    // Fetch current secret data
    const res = await fetch(`/api/secrets/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }

    const secret = await res.json();

    // Populate fields
    secretNs.innerHTML = `<option value="${esc(namespace)}">${esc(namespace)}</option>`;
    secretNs.value = namespace;
    secretName.value = name;

    // Populate key/value pairs
    kvPairs.innerHTML = '';
    kvCounter = 0;
    for (const [key, value] of Object.entries(secret.data ?? {})) {
      const id = kvCounter++;
      const div = document.createElement('div');
      div.className = 'kv-pair';
      // Auto-size textarea based on content
      const rows = Math.min(Math.max(value.split('\n').length, 3), 15);
      div.innerHTML = `
        <input type="text" value="${esc(key)}" placeholder="Key" class="kv-key" data-id="${id}" />
        <textarea placeholder="Value" class="kv-value" data-id="${id}" rows="${rows}">${esc(value)}</textarea>
        <button type="button" class="kv-delete" data-id="${id}">Delete</button>
      `;
      kvPairs.appendChild(div);

      const deleteBtn = div.querySelector('.kv-delete');
      deleteBtn.addEventListener('click', (e) => {
        e.preventDefault();
        div.remove();
      });
    }

    addSecretModal.showModal();
  } catch (err) {
    showBanner(`Failed to load secret: ${err.message}`);
  }
}

function closeAddSecretModal() {
  addSecretModal.close();
}

function addKeyValuePair() {
  const id = kvCounter++;
  const div = document.createElement('div');
  div.className = 'kv-pair';
  div.innerHTML = `
    <input type="text" placeholder="Key (e.g. config.ini)" class="kv-key" data-id="${id}" />
    <textarea placeholder="Value (supports multiline, e.g. file contents)" class="kv-value" data-id="${id}" rows="3"></textarea>
    <button type="button" class="kv-delete" data-id="${id}">Delete</button>
  `;
  kvPairs.appendChild(div);

  const deleteBtn = div.querySelector('.kv-delete');
  deleteBtn.addEventListener('click', (e) => {
    e.preventDefault();
    div.remove();
  });
}

async function submitAddSecret(e) {
  e.preventDefault();

  const namespace = secretNs.value;
  const name = secretName.value.trim();

  if (!namespace || !name) {
    showBanner('Namespace and secret name are required');
    return;
  }

  // Collect key/value pairs
  const data = {};
  const pairs = kvPairs.querySelectorAll('.kv-pair');
  for (const pair of pairs) {
    const key = pair.querySelector('.kv-key').value.trim();
    const value = pair.querySelector('.kv-value').value.trim();
    if (key && value) {
      data[key] = value;
    }
  }

  if (Object.keys(data).length === 0) {
    showBanner('At least one key/value pair is required');
    return;
  }

  addSecretBtn.disabled = true;
  try {
    let res;

    if (modalMode === 'create') {
      res = await fetch('/api/secrets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ namespace, name, data }),
      });
    } else {
      // Edit mode
      res = await fetch(`/api/secrets/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data }),
      });
    }

    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }

    closeAddSecretModal();
    const action = modalMode === 'create' ? 'created' : 'updated';
    showBanner(`✓ Secret "${name}" ${action} in "${namespace}"`);
    // Refresh secrets if we're in that namespace
    if (nsSelect.value === namespace) {
      refresh();
    }
    // Suppress the banner after 3 seconds
    setTimeout(hideBanner, 3000);
  } catch (err) {
    showBanner(`Failed to ${modalMode === 'create' ? 'create' : 'update'} secret: ${err.message}`);
  } finally {
    addSecretBtn.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Pod logs modal
// ---------------------------------------------------------------------------

async function openPodLogsModal(namespace, name) {
  currentPodName = name;
  currentPodNamespace = namespace;
  logsPodsName.textContent = name;
  logsBody.textContent = 'Loading…';

  podLogsModal.showModal();

  try {
    // First fetch pod details to get containers
    const res = await fetch(`/api/pods/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }

    const details = await res.json();
    currentContainers = details.containers.map((c) => c.name);

    // Populate container dropdown
    logsContainerSelect.innerHTML = currentContainers
      .map((cname) => `<option value="${esc(cname)}">${esc(cname)}</option>`)
      .join('');

    // Fetch logs for first container
    if (currentContainers.length > 0) {
      await fetchAndDisplayLogs(namespace, name, currentContainers[0]);
    } else {
      logsBody.textContent = 'No containers in pod';
    }
  } catch (err) {
    logsBody.textContent = `Error: ${err.message}`;
  }
}

async function fetchAndDisplayLogs(namespace, name, container) {
  logsBody.textContent = 'Fetching logs…';

  try {
    const res = await fetch(
      `/api/pods/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/logs?container=${encodeURIComponent(container)}&tail=200`
    );

    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }

    const logData = await res.json();

    if (logData.error === 'container_not_ready') {
      logsBody.textContent = '(Container not ready yet - still initializing)';
    } else {
      logsBody.textContent = logData.logs;
    }
  } catch (err) {
    logsBody.textContent = `Error fetching logs: ${err.message}`;
  }
}

function closePodLogsModal() {
  podLogsModal.close();
}

// ---------------------------------------------------------------------------
// Describe pod modal
// ---------------------------------------------------------------------------

let currentPodDetails = null;

async function openDescribePodModal(namespace, name) {
  describePodName.textContent = name;
  describePodBody.innerHTML = '<div style="color: #94a3b8;">Loading…</div>';
  yamlToggle.checked = false;
  describePodModal.showModal();

  try {
    const res = await fetch(`/api/pods/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }

    currentPodDetails = await res.json();
    renderPodDetails(currentPodDetails, false);
  } catch (err) {
    describePodBody.innerHTML = `<div style="color: #dc2626;">Error: ${esc(err.message)}</div>`;
  }
}

function renderPodDetails(details, showYaml) {
  if (showYaml) {
    describePodBody.innerHTML = `<pre style="background: #f8fafc; padding: 12px; border-radius: 4px; overflow-x: auto; font-family: 'SFMono-Regular', Consolas, monospace; font-size: 11px;"><code>${esc(JSON.stringify(details.raw, null, 2))}</code></pre>`;
    return;
  }

  const containerHtml = details.containers.map((c) => `
    <div class="pod-detail-section">
      <h4>${esc(c.name)}</h4>
      <div class="pod-detail-row">
        <span class="label">Image:</span> <code>${esc(c.image)}</code>
      </div>
      <div class="pod-detail-row">
        <span class="label">Ready:</span> ${c.ready ? '✓' : '✗'}
      </div>
      <div class="pod-detail-row">
        <span class="label">Restarts:</span> ${c.restartCount}
      </div>
      ${c.resources.requests ? `
        <div class="pod-detail-row">
          <span class="label">Requests:</span> ${Object.entries(c.resources.requests).map(([k, v]) => `${k}: ${v}`).join(', ') || 'None'}
        </div>
      ` : ''}
      ${c.resources.limits ? `
        <div class="pod-detail-row">
          <span class="label">Limits:</span> ${Object.entries(c.resources.limits).map(([k, v]) => `${k}: ${v}`).join(', ') || 'None'}
        </div>
      ` : ''}
    </div>
  `).join('');

  const conditionsHtml = details.conditions.length ? details.conditions.map((cond) => `
    <div class="pod-detail-row">
      <span class="label">${esc(cond.type)}:</span>
      <span style="color: ${cond.status === 'True' ? '#16a34a' : '#dc2626'}; font-weight: 600;">${esc(cond.status)}</span>
      ${cond.reason ? `<span style="color: #64748b; font-size: 11px;">${esc(cond.reason)}</span>` : ''}
    </div>
  `).join('') : '<div style="color: #94a3b8;">No conditions</div>';

  const eventsHtml = details.events.length ? details.events.slice(0, 10).map((evt) => `
    <div class="pod-event">
      <div style="font-weight: 600; color: #334155;">${esc(evt.reason)}</div>
      <div style="color: #64748b; font-size: 11px;">${esc(evt.message)}</div>
      <div style="color: #94a3b8; font-size: 10px;">${evt.lastTimestamp || evt.firstTimestamp}</div>
    </div>
  `).join('') : '<div style="color: #94a3b8;">No recent events</div>';

  const labelsHtml = Object.entries(details.labels).length ? Object.entries(details.labels).map(([k, v]) => `
    <span class="pod-label">${esc(k)}=${esc(v)}</span>
  `).join('') : '<span style="color: #94a3b8;">No labels</span>';

  const html = `
    <div class="pod-detail-section">
      <h3>Status</h3>
      <div class="pod-detail-row">
        <span class="label">Phase:</span> <span style="font-weight: 600;">${esc(details.phase)}</span>
      </div>
      <div class="pod-detail-row">
        <span class="label">Node:</span> ${esc(details.nodeName)}
      </div>
      <div class="pod-detail-row">
        <span class="label">Service Account:</span> ${esc(details.serviceAccount)}
      </div>
    </div>

    <div class="pod-detail-section">
      <h3>Conditions</h3>
      ${conditionsHtml}
    </div>

    <div class="pod-detail-section">
      <h3>Containers (${details.containers.length})</h3>
      ${containerHtml}
    </div>

    ${details.initContainers.length ? `
      <div class="pod-detail-section">
        <h3>Init Containers (${details.initContainers.length})</h3>
        ${details.initContainers.map((c) => `<div style="color: #64748b; font-size: 12px;"><strong>${esc(c.name)}</strong>: ${esc(c.image)}</div>`).join('')}
      </div>
    ` : ''}

    <div class="pod-detail-section">
      <h3>Labels</h3>
      <div style="display: flex; flex-wrap: wrap; gap: 6px;">
        ${labelsHtml}
      </div>
    </div>

    <div class="pod-detail-section">
      <h3>Recent Events</h3>
      ${eventsHtml}
    </div>
  `;

  describePodBody.innerHTML = html;
}

function closeDescribePodModal() {
  describePodModal.close();
  currentPodDetails = null;
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

// Secret modal listeners
addSecretBtn.addEventListener('click', () => openAddSecretModal());
modalClose.addEventListener('click', () => closeAddSecretModal());
modalCancel.addEventListener('click', () => closeAddSecretModal());
addKvBtn.addEventListener('click', (e) => {
  e.preventDefault();
  addKeyValuePair();
});
addSecretForm.addEventListener('submit', submitAddSecret);

// View/Edit/Logs buttons (event delegation)
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('show-secret-btn')) {
    const secretName = e.target.dataset.name;
    const namespace = nsSelect.value;
    openViewSecretModal(namespace, secretName);
  }
  if (e.target.classList.contains('edit-secret-btn')) {
    const secretName = e.target.dataset.name;
    const namespace = nsSelect.value;
    openEditSecretModal(namespace, secretName);
  }
  if (e.target.classList.contains('logs-pod-btn')) {
    const podName = e.target.dataset.name;
    const namespace = nsSelect.value;
    openPodLogsModal(namespace, podName);
  }
  if (e.target.classList.contains('describe-pod-btn')) {
    const podName = e.target.dataset.name;
    const namespace = nsSelect.value;
    openDescribePodModal(namespace, podName);
  }
});

// Pod logs modal listeners
logsClose.addEventListener('click', () => closePodLogsModal());
logsCloseBtn.addEventListener('click', () => closePodLogsModal());
logsContainerSelect.addEventListener('change', () => {
  if (currentPodName && currentPodNamespace) {
    fetchAndDisplayLogs(currentPodNamespace, currentPodName, logsContainerSelect.value);
  }
});

// View secret modal listeners
viewClose.addEventListener('click', () => closeViewSecretModal());
viewCloseBtn.addEventListener('click', () => closeViewSecretModal());

// Describe pod modal listeners
describeClose.addEventListener('click', () => closeDescribePodModal());
describeCloseBtn.addEventListener('click', () => closeDescribePodModal());
yamlToggle.addEventListener('change', () => {
  if (currentPodDetails) {
    renderPodDetails(currentPodDetails, yamlToggle.checked);
  }
});

init().catch((err) => showBanner(`Startup error: ${err.message}`));
