const STORAGE_KEY = 'progressie-boom-ui-v1';

const state = {
  data: {
    roots: [],
    summary: { totalLength: 0, completedLength: 0, progress: 0, nodeCount: 0, rootCount: 0 },
  },
  ui: {
    selectedRootId: null,
    collapsedIds: [],
    editingNodeId: null,
    addingChildNodeId: null,
    createPanelOpen: false,
  },
};

const els = {};

async function bootstrap() {
  cacheElements();
  loadUiState();
  bindEvents();
  bindAuth();
  try {
    const response = await fetch('/api/auth/me');
    const { user } = await response.json();
    await showAccount(user);
  } catch {
    document.getElementById('auth-error').textContent = 'Kan de server niet bereiken. Probeer opnieuw.';
  }
}

async function showAccount(user) {
  state.user = user;
  state.data = { roots: [], summary: {} };
  state.ui.selectedRootId = null;
  state.ui.collapsedIds = [];
  state.ui.editingNodeId = null;
  state.ui.addingChildNodeId = null;
  state.ui.createPanelOpen = false;
  els.rootForm.reset();
  els.importJsonInput.value = '';
  render();
  document.getElementById('auth-panel').classList.toggle('hidden', Boolean(user));
  document.getElementById('authenticated-app').classList.toggle('hidden', !user);
  document.getElementById('account-name').textContent = user ? `Ingelogd als ${user.username}` : '';
  if (user) await loadData();
}

function bindAuth() {
  const form = document.getElementById('auth-form');
  const authenticate = async mode => {
    if (!form.reportValidity()) return;
    const buttons = form.querySelectorAll('button');
    buttons.forEach(button => { button.disabled = true; });
    const error = document.getElementById('auth-error');
    error.textContent = '';
    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(new FormData(form))),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      form.reset();
      await showAccount(body.user);
    } catch (failure) { error.textContent = failure.message; }
    finally { buttons.forEach(button => { button.disabled = false; }); }
  };
  form.addEventListener('submit', event => { event.preventDefault(); authenticate('login'); });
  document.getElementById('register-btn').addEventListener('click', () => authenticate('register'));
  document.getElementById('logout-btn').addEventListener('click', async () => {
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (!response.ok) throw new Error('Uitloggen is mislukt.');
      await showAccount(null);
    } catch (error) { alert(error.message); }
  });
}

function cacheElements() {
  els.rootList = document.getElementById('root-list');
  els.globalSummary = document.getElementById('global-summary');
  els.heroProgressValue = document.getElementById('hero-progress-value');
  els.heroNodeCount = document.getElementById('hero-node-count');
  els.heroRootCount = document.getElementById('hero-root-count');
  els.selectedTitle = document.getElementById('selected-title');
  els.selectedMeta = document.getElementById('selected-meta');
  els.selectedSummary = document.getElementById('selected-summary');
  els.treeRoot = document.getElementById('tree-root');
  els.rootForm = document.getElementById('root-form');
  els.createPanel = document.getElementById('create-panel');
  els.createToggleBtn = document.getElementById('create-toggle-btn');
  els.createCloseBtn = document.getElementById('create-close-btn');
  els.exportJsonBtn = document.getElementById('export-json-btn');
  els.importJsonInput = document.getElementById('import-json-input');
  els.importJsonBtn = document.getElementById('import-json-btn');
}

function loadUiState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    state.ui.selectedRootId = saved.selectedRootId || null;
    state.ui.collapsedIds = Array.isArray(saved.collapsedIds) ? saved.collapsedIds : [];
    state.ui.createPanelOpen = Boolean(saved.createPanelOpen);
  } catch {
    state.ui.selectedRootId = null;
    state.ui.collapsedIds = [];
    state.ui.createPanelOpen = false;
  }
}

function saveUiState() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      selectedRootId: state.ui.selectedRootId,
      collapsedIds: state.ui.collapsedIds,
      createPanelOpen: state.ui.createPanelOpen,
    })
  );
}

function bindEvents() {
  els.rootForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(els.rootForm);
    await createNode({
      title: formData.get('title'),
      length: formData.get('length'),
      parentId: null,
    });
    els.rootForm.reset();
  });

  els.createToggleBtn.addEventListener('click', () => toggleCreatePanel(true));
  els.createCloseBtn.addEventListener('click', () => toggleCreatePanel(false));

  els.exportJsonBtn.addEventListener('click', exportJson);
  els.importJsonBtn.addEventListener('click', importJsonFromFile);

  document.addEventListener('click', async (event) => {
    const rootButton = event.target.closest('[data-root-id]');
    if (rootButton) {
      state.ui.selectedRootId = rootButton.dataset.rootId;
      state.ui.editingNodeId = null;
      state.ui.addingChildNodeId = null;
      saveUiState();
      render();
      return;
    }

    const actionButton = event.target.closest('[data-action]');
    if (!actionButton) {
      return;
    }

    const { action, id } = actionButton.dataset;

    if (action === 'toggle-collapse') {
      toggleCollapsed(id);
      return;
    }

    if (action === 'toggle-complete') {
      await toggleNode(id);
      return;
    }

    if (action === 'start-child') {
      state.ui.addingChildNodeId = state.ui.addingChildNodeId === id ? null : id;
      state.ui.editingNodeId = null;
      render();
      return;
    }

    if (action === 'start-edit') {
      state.ui.editingNodeId = state.ui.editingNodeId === id ? null : id;
      state.ui.addingChildNodeId = null;
      render();
      return;
    }

    if (action === 'delete-node') {
      await deleteNode(id);
    }
  });

  document.addEventListener('submit', async (event) => {
    const form = event.target.closest('[data-node-form]');
    if (!form) {
      return;
    }

    event.preventDefault();
    const id = form.dataset.nodeForm;
    const formData = new FormData(form);

    if (form.dataset.mode === 'edit') {
      await updateNode(id, {
        title: formData.get('title'),
        length: formData.get('length'),
      });
    } else {
      await createNode({
        title: formData.get('title'),
        length: formData.get('length'),
        parentId: id,
      });
    }

    state.ui.editingNodeId = null;
    state.ui.addingChildNodeId = null;
  });
}

async function loadData() {
  const response = await fetch('/api/tree', { cache: 'no-store' });
  await handleResponse(response);
  state.data = await response.json();

  if (!state.ui.selectedRootId || !state.data.roots.some((root) => root.id === state.ui.selectedRootId)) {
    state.ui.selectedRootId = state.data.roots[0]?.id || null;
    saveUiState();
  }

  render();
}

function toggleCreatePanel(forceOpen) {
  state.ui.createPanelOpen = typeof forceOpen === 'boolean' ? forceOpen : !state.ui.createPanelOpen;
  saveUiState();
  render();

  if (state.ui.createPanelOpen) {
    window.setTimeout(() => {
      els.rootForm?.querySelector('input[name="title"]')?.focus();
    }, 0);
  }
}

function render() {
  const { roots, summary } = state.data;
  renderGlobalSummary(summary);
  renderSidebar(roots);
  renderSelectedRoot(roots);
  renderCreatePanel();
}

function renderGlobalSummary(summary) {
  els.heroProgressValue.textContent = `${summary.progress || 0}%`;
  els.heroNodeCount.textContent = String(summary.nodeCount || 0);
  els.heroRootCount.textContent = String(summary.rootCount || 0);
  els.globalSummary.innerHTML = `
    <div class="summary-card">
      <div class="summary-top">
        <div>
          <div class="summary-value">${formatPages(summary.completedLength)} / ${formatPages(summary.totalLength)} p</div>
          <div class="summary-label">totaal afgerond</div>
        </div>
        <div class="summary-value">${summary.progress || 0}%</div>
      </div>
      <div class="progress"><span style="width:${summary.progress || 0}%"></span></div>
    </div>
  `;
}

function renderSidebar(roots) {
  if (!roots.length) {
    els.rootList.innerHTML = `
      <div class="empty-state">
        <strong>Nog geen projecten of vakken.</strong><br />
        Voeg bovenaan je eerste item toe en bouw daarna zo diep verder als je wilt.
      </div>
    `;
    return;
  }

  els.rootList.innerHTML = roots
    .map((root) => {
      const active = root.id === state.ui.selectedRootId ? 'active' : '';
      return `
        <button class="root-item ${active}" data-root-id="${root.id}" type="button">
          <div class="root-title">${escapeHtml(root.title)}</div>
          <div class="root-stats">
            <span>${formatPages(root.completedLength)} p / ${formatPages(root.totalLength)} p</span>
            <span>${root.progress}%</span>
            <span>${countTree(root)} delen</span>
          </div>
          <div class="progress"><span style="width:${root.progress}%"></span></div>
        </button>
      `;
    })
    .join('');
}

function renderCreatePanel() {
  if (!els.createPanel) {
    return;
  }

  els.createPanel.classList.toggle('hidden', !state.ui.createPanelOpen);
  els.createToggleBtn.setAttribute('aria-expanded', String(state.ui.createPanelOpen));
  els.createToggleBtn.textContent = state.ui.createPanelOpen ? 'Sluit nieuw project' : 'Nieuw project / vak';
}

function renderSelectedRoot(roots) {
  const selected = roots.find((root) => root.id === state.ui.selectedRootId) || null;
  if (!selected) {
    els.selectedTitle.textContent = 'Geen project gekozen';
    els.selectedMeta.textContent = '';
    els.selectedSummary.innerHTML = `
      <div class="empty-state">
        Kies links een project of voeg er een nieuw toe.
      </div>
    `;
    els.treeRoot.innerHTML = '';
    return;
  }

  els.selectedTitle.textContent = selected.title;
  els.selectedMeta.textContent = `${formatPages(selected.totalLength)} p totaal`;
  els.selectedSummary.innerHTML = `
    <div class="summary-grid">
      <div class="summary-kpi">
        <strong>${selected.progress}%</strong>
        <span>voortgang</span>
      </div>
      <div class="summary-kpi">
        <strong>${formatPages(selected.completedLength)} p</strong>
        <span>afgerond</span>
      </div>
      <div class="summary-kpi">
        <strong>${formatPages(selected.totalLength)} p</strong>
        <span>totale lengte</span>
      </div>
      <div class="summary-kpi">
        <strong>${countTree(selected)}</strong>
        <span>onderdelen</span>
      </div>
    </div>
    <div class="progress" style="margin-top:14px"><span style="width:${selected.progress}%"></span></div>
  `;
  els.treeRoot.innerHTML = renderNode(selected, 0, false);
}

function renderNode(node, depth, locked) {
  const hasChildren = node.children.length > 0;
  const collapsed = state.ui.collapsedIds.includes(node.id);
  const completeClass = node.completed ? 'manual-complete' : node.isComplete ? 'derived-complete' : '';
  const titleClass = node.isComplete ? 'complete' : '';
  const canInteract = !locked;
  const toggleIcon = node.completed ? '✓' : node.isComplete ? '●' : '○';
  const actionsDisabled = locked ? 'disabled' : '';
  const childLocked = locked || node.completed;
  const mismatchBadge = node.lengthMismatch
    ? `<span class="chip">lengte verschilt van onderliggende som (${formatPages(node.childLengthSum)} p)</span>`
    : '';

  return `
    <div class="tree-section" data-depth="${depth}">
      <article class="node-card ${completeClass}" style="margin-left:${depth === 0 ? 0 : 0}px">
        <div class="node-header">
          ${hasChildren ? `<button class="node-toggle" data-action="toggle-collapse" data-id="${node.id}" type="button">${collapsed ? '+' : '-'}</button>` : `<span class="node-toggle" aria-hidden="true">•</span>`}
          <button class="node-toggle ${node.isComplete ? 'complete' : ''}" data-action="toggle-complete" data-id="${node.id}" ${canInteract ? '' : 'disabled'} type="button" title="Markeer als gedaan">${toggleIcon}</button>
          <div class="node-main">
            <div class="node-title ${titleClass}">${escapeHtml(node.title)}</div>
            <div class="node-meta">
              <span>${formatPages(node.completedLength)} p / ${formatPages(node.totalLength)} p</span>
              <span>${node.progress}%</span>
              ${node.completed ? '<span>handmatig afgerond</span>' : node.isComplete ? '<span>afgerond via subdelen</span>' : '<span>in progress</span>'}
              ${mismatchBadge}
            </div>
            <div class="progress node-progress"><span style="width:${node.progress}%"></span></div>
          </div>
          <div class="node-actions">
            <button class="tiny-btn" data-action="start-child" data-id="${node.id}" ${actionsDisabled} type="button">+ deel</button>
            <button class="tiny-btn" data-action="start-edit" data-id="${node.id}" ${actionsDisabled} type="button">wijzig</button>
            <button class="tiny-btn danger" data-action="delete-node" data-id="${node.id}" ${actionsDisabled} type="button">verwijder</button>
          </div>
        </div>

        ${state.ui.editingNodeId === node.id ? renderEditForm(node) : ''}
        ${state.ui.addingChildNodeId === node.id ? renderChildForm(node) : ''}

        ${hasChildren && !collapsed ? `<div class="child-stack">${node.children.map((child) => renderNode(child, depth + 1, childLocked)).join('')}</div>` : ''}
        ${locked ? '<div class="child-toggle-row">Dit deel is afgerond via een bovenliggend onderdeel.</div>' : ''}
      </article>
    </div>
  `;
}

function renderEditForm(node) {
  return `
    <form class="inline-form" data-node-form="${node.id}" data-mode="edit">
      <div class="form-grid">
        <input name="title" type="text" value="${escapeAttribute(node.title)}" required />
        <input name="length" type="number" min="0" step="1" value="${node.length || ''}" placeholder="Lengte" />
      </div>
      <div class="form-actions">
        <button class="primary" type="submit">Opslaan</button>
        <button class="ghost" type="button" data-action="start-edit" data-id="${node.id}">Annuleren</button>
      </div>
    </form>
  `;
}

function renderChildForm(node) {
  return `
    <form class="inline-form" data-node-form="${node.id}" data-mode="child">
      <div class="form-grid">
        <input name="title" type="text" placeholder="Naam van subdeel" required />
        <input name="length" type="number" min="0" step="1" placeholder="Lengte" />
      </div>
      <div class="form-actions">
        <button class="primary" type="submit">Subdeel toevoegen</button>
        <button class="ghost" type="button" data-action="start-child" data-id="${node.id}">Annuleren</button>
      </div>
    </form>
  `;
}

async function createNode({ title, length, parentId }) {
  const response = await fetch('/api/nodes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, length, parentId }),
  });
  await handleResponse(response);
  await loadData();
}

async function updateNode(id, payload) {
  const response = await fetch(`/api/nodes/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  await handleResponse(response);
  await loadData();
}

async function toggleNode(id) {
  const response = await fetch(`/api/nodes/${id}/toggle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  await handleResponse(response);
  await loadData();
}

async function deleteNode(id) {
  if (!window.confirm('Dit onderdeel en alle onderliggende delen verwijderen?')) {
    return;
  }

  const response = await fetch(`/api/nodes/${id}`, {
    method: 'DELETE',
  });
  await handleResponse(response);
  if (state.ui.editingNodeId === id) {
    state.ui.editingNodeId = null;
  }
  if (state.ui.addingChildNodeId === id) {
    state.ui.addingChildNodeId = null;
  }
  await loadData();
}

function toggleCollapsed(id) {
  const index = state.ui.collapsedIds.indexOf(id);
  if (index >= 0) {
    state.ui.collapsedIds.splice(index, 1);
  } else {
    state.ui.collapsedIds.push(id);
  }
  saveUiState();
  render();
}

function exportJson() {
  const payload = {
    app: 'Progressie Boom',
    version: 1,
    exportedAt: new Date().toISOString(),
    nodes: flattenRootsForExport(state.data.roots),
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `progressie-boom-export-${new Date().toISOString().slice(0, 19).replaceAll(':', '-')}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

async function importJsonFromFile() {
  const file = els.importJsonInput.files?.[0];
  if (!file) {
    alert('Kies eerst een JSON-bestand om te importeren.');
    return;
  }

  if (!window.confirm('Deze import vervangt alle huidige data. Doorgaan?')) {
    return;
  }

  let payload;
  try {
    payload = JSON.parse(await file.text());
  } catch {
    alert('Dit bestand is geen geldige JSON.');
    return;
  }

  const response = await fetch('/api/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  await handleResponse(response);
  els.importJsonInput.value = '';
  await loadData();
}

async function handleResponse(response) {
  if (response.ok) {
    return;
  }
  if (response.status === 401) await showAccount(null);

  let message = 'Er ging iets mis.';
  try {
    const body = await response.json();
    if (body?.error) {
      message = body.error;
    }
  } catch {
    message = response.statusText || message;
  }
  alert(message);
  throw new Error(message);
}

function countTree(node) {
  return 1 + node.children.reduce((total, child) => total + countTree(child), 0);
}

function flattenRootsForExport(roots) {
  const nodes = [];
  const visit = (node, parentId = null) => {
    nodes.push({
      id: node.id,
      parentId,
      title: node.title,
      length: node.length,
      completed: node.completed,
      order: node.order,
      createdAt: node.createdAt,
      updatedAt: node.updatedAt,
    });
    node.children.forEach((child) => visit(child, node.id));
  };

  roots.forEach((root) => visit(root, null));
  return nodes;
}

function formatPages(value) {
  return `${Number(value || 0)}`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll('\n', ' ');
}

bootstrap();
