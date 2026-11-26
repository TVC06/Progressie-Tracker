const STORAGE_KEY = 'progresset-ui-v1';

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
    bookmarkNodeId: null,
    adminOpen: false,
  },
};

const els = {};

async function bootstrap() {
  cacheElements();
  loadUiState();
  bindEvents();
  bindAuth();
  bindAdmin();
  bindTransfers();
  try {
    const response = await fetch('/api/auth/me');
    const { user } = await response.json();
    await showAccount(user);
  } catch {
    document.getElementById('auth-error').textContent = 'Kan de server niet bereiken. Probeer opnieuw.';
  }
}

async function showAccount(user) {
  resetTransferUi();
  document.getElementById('project-selection').innerHTML = '';
  els.rootList.innerHTML = '';
  closeSettings();
  document.getElementById('admin-import-dialog').close();
  document.getElementById('password-dialog').close();
  document.getElementById('admin-users').innerHTML = '';
  document.getElementById('admin-status').textContent = '';
  document.getElementById('admin-btn').classList.toggle('hidden', !user?.isAdmin);
  document.getElementById('backup-dropdown').open = false;
  document.getElementById('projects-dropdown').open = false;
  document.getElementById('intro-panel').open = false;
  state.user = user;
  state.data = { roots: [], summary: {} };
  state.ui.selectedRootId = null;
  state.ui.collapsedIds = [];
  state.ui.editingNodeId = null;
  state.ui.addingChildNodeId = null;
  state.ui.createPanelOpen = false;
  state.ui.bookmarkNodeId = null;
  state.ui.adminOpen = false;
  els.rootForm.reset();
  syncCustomUnitField(els.rootForm);
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

function bindAdmin() {
  const importDialog = document.getElementById('admin-import-dialog');
  const importForm = document.getElementById('admin-import-form');
  const importError = document.getElementById('admin-import-error');
  document.getElementById('admin-import-btn').addEventListener('click', () => {
    importForm.reset();
    importError.textContent = '';
    importDialog.showModal();
  });
  importForm.addEventListener('submit', async event => {
    event.preventDefault();
    const mode = importForm.elements.mode.value;
    if (mode === 'replace' && !confirm('Alle huidige bomen en groepen vervangen door deze back-up?')) return;
    const submit = importForm.querySelector('[type="submit"]');
    submit.disabled = true;
    importError.textContent = '';
    try {
      const backup = JSON.parse(await importForm.elements.backup.files[0].text());
      const result = await transferResponse(await fetch('/api/admin/backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, backup }),
      }));
      importDialog.close();
      await loadData();
      await loadAdminUsers();
      const skipped = result.missingAccounts.length ? ` Overgeslagen accounts: ${result.missingAccounts.join(', ')}.` : '';
      document.getElementById('admin-status').textContent = `${result.projectCount} vakken ${mode === 'replace' ? 'hersteld' : 'toegevoegd'}.${skipped}`;
    } catch (error) { importError.textContent = error.message; }
    finally { submit.disabled = false; }
  });
  document.getElementById('admin-users').addEventListener('toggle', async event => {
    const details = event.target;
    if (!details.matches('[data-admin-tree]') || !details.open || details.dataset.loaded) return;
    details.dataset.loaded = 'true';
    const content = details.querySelector('div');
    try {
      const { roots, groups } = await transferResponse(await fetch(`/api/admin/users/${details.dataset.adminTree}/tree`));
      content.innerHTML = groups.map(group => `<details><summary>${escapeHtml(group.title)}</summary>
        ${roots.filter(root => root.groupId === group.id).map(renderAdminTree).join('') || '<p>Geen vakken.</p>'}</details>`).join('') +
        roots.filter(root => !groups.some(group => group.id === root.groupId)).map(renderAdminTree).join('');
      if (!content.innerHTML) content.textContent = 'Geen vakken.';
    } catch (error) {
      delete details.dataset.loaded;
      content.textContent = error.message;
    }
  }, true);
  document.getElementById('admin-btn').addEventListener('click', async () => {
    state.ui.adminOpen = true;
    render();
    await loadAdminUsers();
  });
  document.getElementById('admin-refresh-btn').addEventListener('click', loadAdminUsers);
  const dialog = document.getElementById('password-dialog');
  const form = document.getElementById('admin-password-form');
  document.getElementById('password-close-btn').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    form.reset();
    form.elements.password.type = 'password';
    delete form.dataset.userId;
    document.getElementById('password-account').textContent = '';
    document.getElementById('password-error').textContent = '';
  });
  document.getElementById('password-visible').addEventListener('change', event => {
    form.elements.password.type = event.target.checked ? 'text' : 'password';
  });
  document.getElementById('admin-users').addEventListener('click', async event => {
    const button = event.target.closest('[data-admin-action]');
    if (!button) return;
    const { adminAction, userId, username } = button.dataset;
    if (adminAction === 'password') {
      form.dataset.userId = userId;
      document.getElementById('password-account').textContent = `Account: ${username}`;
      dialog.showModal();
      return;
    }
    if (!confirm(`Account "${username}" en al zijn projecten, groepen en voortgang definitief verwijderen?`)) return;
    button.disabled = true;
    try {
      const response = await fetch(`/api/admin/users/${userId}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      await handleResponse(response);
      await loadAdminUsers();
      document.getElementById('admin-status').textContent = `Account ${username} is verwijderd.`;
    } catch (error) { document.getElementById('admin-status').textContent = error.message; }
    finally { button.disabled = false; }
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    document.getElementById('password-error').textContent = '';
    try {
      const response = await fetch(`/api/admin/users/${form.dataset.userId}/password`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: form.elements.password.value }),
      });
      await handleResponse(response);
      const result = await response.json();
      dialog.close();
      if (result.signedOut) {
        await showAccount(null);
        document.getElementById('auth-error').textContent = 'Wachtwoord gewijzigd. Log opnieuw in met je nieuwe wachtwoord.';
      } else {
        document.getElementById('admin-status').textContent = 'Nieuw wachtwoord opgeslagen. Alle sessies van dit account zijn ingetrokken.';
      }
    } catch (error) { document.getElementById('password-error').textContent = error.message; }
    finally { submit.disabled = false; }
  });
}

function renderAdminTree(node) {
  const label = `${escapeHtml(node.title)} <span class="helper-text">${node.progress}%</span>`;
  if (!node.children.length) return `<div class="admin-tree-leaf">${label}</div>`;
  return `<details><summary>${label}</summary><div>${node.children.map(renderAdminTree).join('')}</div></details>`;
}

async function loadAdminUsers() {
  if (!state.user?.isAdmin) return;
  const accountId = state.user.id;
  const status = document.getElementById('admin-status');
  status.textContent = 'Accounts laden...';
  try {
    const response = await fetch('/api/admin/users', { cache: 'no-store' });
    await handleResponse(response);
    const { users } = await response.json();
    if (state.user?.id !== accountId) return;
    document.getElementById('admin-users').innerHTML = users.map(user => `<article class="admin-account">
      <details class="admin-account-tree" data-admin-tree="${escapeAttribute(user.id)}">
        <summary><strong>${escapeHtml(user.username)}</strong> <span class="helper-text">${user.projectCount} projecten${user.isAdmin ? ' · Beheerder' : ''}</span></summary>
        <div>Laden...</div>
      </details>
      <div class="admin-account-actions">
        <button type="button" class="tiny-btn" data-admin-action="password" data-user-id="${escapeAttribute(user.id)}" data-username="${escapeAttribute(user.username)}">Wachtwoord instellen</button>
        ${user.id !== accountId ? `<button type="button" class="tiny-btn danger" data-admin-action="delete" data-user-id="${escapeAttribute(user.id)}" data-username="${escapeAttribute(user.username)}">Account verwijderen</button>` : '<span class="helper-text">Je eigen account</span>'}
      </div>
    </article>`).join('');
    status.textContent = `${users.length} accounts`;
  } catch (error) { if (state.user?.id === accountId) status.textContent = error.message; }
}

function loadUiState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    state.ui.selectedRootId = null;
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
  document.getElementById('home-btn').addEventListener('click', () => {
    state.ui.adminOpen = false;
    state.ui.selectedRootId = null;
    render();
  });
  document.addEventListener('change', event => {
    if (event.target.matches('[data-group-picker]')) syncNewGroupField(event.target.form);
    if (event.target.matches('[data-unit-picker]')) syncCustomUnitField(event.target.form);
  });
  document.getElementById('selected-settings-btn').addEventListener('click', () => openSettings(state.ui.selectedRootId));
  document.getElementById('settings-close-btn').addEventListener('click', closeSettings);
  document.getElementById('settings-form').addEventListener('submit', saveSettings);
  document.getElementById('settings-delete-group-btn').addEventListener('click', async () => {
    const id = document.getElementById('settings-form').elements.groupId.value;
    if (!id || id === '__new__' || !confirm('Groep verwijderen? Alle projecten in deze groep blijven bewaard zonder groep.')) return;
    try {
      const response = await fetch(`/api/groups/${id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      await handleResponse(response);
      closeSettings();
      await loadData();
    } catch (error) { document.getElementById('settings-error').textContent = error.message; }
  });
  document.addEventListener('submit', async event => {
    const form = event.target.closest('[data-bookmark]');
    if (!form) return;
    event.preventDefault();
    try {
      await updateNode(form.dataset.bookmark, { stoppedPage: new FormData(form).get('stoppedPage') });
      state.ui.bookmarkNodeId = null;
      render();
    }
    catch (error) { console.error(error); }
  });
  els.rootForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = els.rootForm.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      const formData = new FormData(els.rootForm);
      const groupId = await resolveGroup(formData);
      await createNode({
        title: formData.get('title'), length: formData.get('length'),
        parentId: null, groupId, unit: selectedUnit(formData),
      });
      els.rootForm.reset();
      syncNewGroupField(els.rootForm);
      syncCustomUnitField(els.rootForm);
    } catch (error) { console.error(error); }
    finally { submit.disabled = false; }
  });

  els.createToggleBtn.addEventListener('click', () => toggleCreatePanel());
  els.createCloseBtn.addEventListener('click', () => toggleCreatePanel(false));

  els.exportJsonBtn.addEventListener('click', exportJson);
  els.importJsonBtn.addEventListener('click', importJsonFromFile);

  document.addEventListener('click', async (event) => {
    const rootButton = event.target.closest('[data-root-id]');
    if (rootButton) {
      state.ui.adminOpen = false;
      state.ui.selectedRootId = rootButton.dataset.rootId;
      state.ui.activeTreeId = null;
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
    if (action === 'switch-tree') {
      state.ui.activeTreeId = id;
      render();
      return;
    }
    if (action === 'toggle-tree-layout') {
      state.ui.showAllTrees = !state.ui.showAllTrees;
      render();
      return;
    }
    if (action === 'add-tree') {
      const title = window.prompt('Naam van de nieuwe boom')?.trim();
      if (!title) return;
      actionButton.disabled = true;
      try {
        const created = await createNode({ title, parentId: id, separateTree: true });
        state.ui.activeTreeId = created.id;
        render();
      } catch (error) { console.error(error); }
      finally { actionButton.disabled = false; }
      return;
    }
    if (['add-note', 'edit-note', 'delete-note'].includes(action)) {
      await changeNote(action, id, Number(actionButton.dataset.index));
      return;
    }
    if (action === 'bookmark') {
      state.ui.bookmarkNodeId = state.ui.bookmarkNodeId === id ? null : id;
      render();
      document.getElementById(`bookmark-${id}`)?.querySelector('input')?.focus();
      return;
    }
    if (action === 'project-settings') {
      openSettings(id);
      return;
    }

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
    render();
  });
}

async function loadData() {
  const response = await fetch('/api/tree', { cache: 'no-store' });
  await handleResponse(response);
  state.data = await response.json();

  if (!state.ui.selectedRootId || !state.data.roots.some((root) => root.id === state.ui.selectedRootId)) {
    state.ui.selectedRootId = null;
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
  renderSelection(roots);
}

function renderGlobalSummary(summary) {
  els.heroProgressValue.textContent = `${summary.progress || 0}%`;
  els.heroNodeCount.textContent = String(summary.nodeCount || 0);
  els.heroRootCount.textContent = String(summary.rootCount || 0);
}

function renderSidebar(roots) {
  els.rootList.innerHTML = groupedProjects(roots, els.rootList, true);
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
  els.selectedMeta.textContent = `${formatPages(selected.totalLength)} ${unitOf(selected)} totaal`;
  els.selectedSummary.innerHTML = `
    <div class="summary-grid">
      <div class="summary-kpi">
        <strong>${selected.progress}%</strong>
        <span>voortgang</span>
      </div>
      <div class="summary-kpi">
        <strong>${formatPages(selected.completedLength)} ${escapeHtml(unitOf(selected))}</strong>
        <span>afgerond</span>
      </div>
      <div class="summary-kpi">
        <strong>${formatPages(selected.totalLength)} ${escapeHtml(unitOf(selected))}</strong>
        <span>totale lengte</span>
      </div>
      <div class="summary-kpi">
        <strong>${countTree(selected)}</strong>
        <span>onderdelen</span>
      </div>
    </div>
    <div class="progress" style="margin-top:14px"><span style="width:${selected.progress}%"></span></div>
  `;
  const separate = selected.children.filter(child => child.separateTree);
  const general = { ...selected, children: selected.children.filter(child => !child.separateTree) };
  const trees = separate.length ? [general, ...separate] : [general];
  const active = trees.find(tree => tree.id === state.ui.activeTreeId) || trees[0];
  const showAll = Boolean(state.ui.showAllTrees);
  document.getElementById('tree-navigation').innerHTML = `
    <button class="tiny-btn" type="button" data-action="add-tree" data-id="${selected.id}">+ Boom</button>
    ${separate.length ? `<button class="tiny-btn" type="button" data-action="toggle-tree-layout" aria-pressed="${showAll}">Alle bomen onder elkaar</button>
    ${showAll ? '' : trees.map(tree => `<button class="tiny-btn" type="button" data-action="switch-tree" data-id="${tree.id}" aria-pressed="${tree.id === active.id}">${tree.id === selected.id ? 'Algemeen' : escapeHtml(tree.title)}</button>`).join('')}` : ''}
  `;
  els.treeRoot.innerHTML = (showAll ? trees : [active]).map(tree =>
    renderNode(tree, 0, tree.id !== selected.id && selected.completed),
  ).join('');
}

function groupOptions(selected = '') {
  return `<option value="">Zonder groep</option>` + (state.data.groups || []).map(g => `<option value="${escapeAttribute(g.id)}" ${selected === g.id ? 'selected' : ''}>${escapeHtml(g.title)}</option>`).join('') + `<option value="__new__" ${selected === '__new__' ? 'selected' : ''}>+ Nieuwe groep maken...</option>`;
}

function renderSelection(roots) {
  const selection = document.getElementById('project-selection');
  const adminOpen = state.ui.adminOpen && state.user?.isAdmin;
  document.getElementById('admin-panel').classList.toggle('hidden', !adminOpen);
  document.getElementById('selection-panel').classList.toggle('hidden', adminOpen || Boolean(state.ui.selectedRootId));
  document.getElementById('tree-panel').classList.toggle('hidden', adminOpen || !state.ui.selectedRootId);
  const select = document.getElementById('new-root-group');
  const current = select.value;
  select.innerHTML = groupOptions(current);
  syncNewGroupField(els.rootForm);
  selection.innerHTML = groupedProjects(roots, selection);
}

function unitOf(root) { return root.unit || 'paginas'; }

function selectedUnit(data) {
  return data.get('unit') === '__custom__' ? data.get('customUnit') : data.get('unit');
}

function syncCustomUnitField(form) {
  const custom = form.elements.unit.value === '__custom__';
  form.querySelector('[data-custom-unit-field]').classList.toggle('hidden', !custom);
  form.elements.customUnit.disabled = !custom;
  form.elements.customUnit.required = custom;
}

function syncNewGroupField(form) {
  const isNew = form.elements.groupId.value === '__new__';
  form.querySelector('[data-new-group-field]').classList.toggle('hidden', !isNew);
  form.elements.newGroupTitle.disabled = !isNew;
  form.elements.newGroupTitle.required = isNew;
  if (form.id === 'settings-form') {
    document.getElementById('settings-delete-group-btn').classList.toggle('hidden', !form.elements.groupId.value || isNew);
  }
}

async function resolveGroup(formData) {
  const selected = formData.get('groupId');
  if (selected !== '__new__') return selected || null;
  const response = await fetch('/api/groups', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: formData.get('newGroupTitle') }),
  });
  await handleResponse(response);
  const group = await response.json();
  state.data.groups = [...(state.data.groups || []), group];
  const form = document.getElementById('project-settings').open ? document.getElementById('settings-form') : els.rootForm;
  form.elements.groupId.innerHTML = groupOptions(group.id);
  syncNewGroupField(form);
  return group.id;
}

function openSettings(id) {
  const root = state.data.roots.find(root => root.id === id);
  if (!root) return;
  const form = document.getElementById('settings-form');
  form.reset();
  form.dataset.projectId = id;
  form.elements.title.value = root.title;
  const unit = unitOf(root);
  form.elements.unit.value = ['paginas', 'Tpoints', 'uur', 'taken'].includes(unit) ? unit : '__custom__';
  form.elements.customUnit.value = unit;
  syncCustomUnitField(form);
  form.elements.groupId.innerHTML = groupOptions(root.groupId);
  document.getElementById('settings-error').textContent = '';
  syncNewGroupField(form);
  document.getElementById('project-settings').showModal();
}

function closeSettings() {
  document.getElementById('project-settings').close();
}

async function saveSettings(event) {
  event.preventDefault();
  const form = event.target;
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  document.getElementById('settings-error').textContent = '';
  try {
    const data = new FormData(form);
    const groupId = await resolveGroup(data);
    await updateNode(form.dataset.projectId, { title: data.get('title'), unit: selectedUnit(data), groupId });
    closeSettings();
  } catch (error) {
    document.getElementById('settings-error').textContent = error.message;
  } finally { submit.disabled = false; }
}

function positionText(node) {
  return unitOf(node) === 'paginas' ? `Gestopt op pagina ${formatPages(node.stoppedPage)}` : `Gestopt bij ${formatPages(node.stoppedPage)} ${unitOf(node)}`;
}

function groupedProjects(roots, container, compact = false) {
  const openGroups = new Set([...container.querySelectorAll('details[open]')].map(el => el.dataset.group));
  const card = root => `<article class="selection-card ${compact ? 'compact-project' : ''}">
    <button type="button" class="root-item ${state.ui.selectedRootId === root.id ? 'active' : ''}" data-root-id="${escapeAttribute(root.id)}">
      <div class="root-title">${escapeHtml(root.title)}</div>
      <div class="root-stats"><span>${root.progress}% afgerond</span><span>${formatPages(root.totalLength)} ${escapeHtml(unitOf(root))}</span>${root.stoppedPage != null && !root.isComplete ? `<span>${escapeHtml(positionText(root))}</span>` : ''}</div>
      <div class="progress"><span style="width:${root.progress}%"></span></div>
    </button>
    <div class="project-card-actions">
      <button class="tiny-btn" data-action="project-settings" data-id="${escapeAttribute(root.id)}" type="button" aria-label="Instellingen voor ${escapeAttribute(root.title)}">Instellingen</button>
      <button class="tiny-btn" data-share-type="project" data-share-id="${escapeAttribute(root.id)}" type="button" aria-label="Deel ${escapeAttribute(root.title)}">Delen</button>
    </div>
  </article>`;
  return (state.data.groups || []).map(group => {
    const projects = roots.filter(r => r.groupId === group.id);
    return `<details class="project-group" data-group="${escapeAttribute(group.id)}" ${openGroups.has(group.id) ? 'open' : ''}>
      <summary>${escapeHtml(group.title)} <span class="helper-text">(${projects.length})</span></summary>
      <div class="transfer-actions">
        <button class="tiny-btn" data-share-type="group" data-share-id="${escapeAttribute(group.id)}" type="button">Groep delen</button>
        <button class="tiny-btn" data-import-group="${escapeAttribute(group.id)}" type="button">Vak importeren in groep</button>
      </div>
      <div class="project-cards">${projects.map(card).join('') || '<p class="helper-text">Nog geen projecten. Kies deze groep via de projectinstellingen.</p>'}</div>
    </details>`;
  }).join('') + `<div class="project-cards ungrouped-projects">${roots.filter(r => !r.groupId).map(card).join('')}</div>` + (!roots.length ? '<p class="empty-state">Maak links je eerste vak of project aan.</p>' : '');
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
    ? `<span class="chip">omvang verschilt van onderliggende som (${formatPages(node.childLengthSum)} ${escapeHtml(unitOf(node))})</span>`
    : '';

  return `
    <div class="tree-section" data-depth="${depth}">
      <article class="node-card ${completeClass}" style="margin-left:${depth === 0 ? 0 : 0}px">
        <div class="node-header">
          ${hasChildren ? `<button class="node-toggle" data-action="toggle-collapse" data-id="${node.id}" type="button">${collapsed ? '+' : '-'}</button>` : `<span class="node-toggle" aria-hidden="true">•</span>`}
          <button class="node-toggle ${node.isComplete ? 'complete' : ''}" data-action="toggle-complete" data-id="${node.id}" ${canInteract ? '' : 'disabled'} type="button" aria-pressed="${node.isComplete}" title="${node.completed ? 'Markeer als niet gedaan' : 'Markeer als gedaan'}">${toggleIcon}</button>
          <div class="node-main">
            <div class="node-title ${titleClass}">${escapeHtml(node.title)}</div>
            <div class="node-meta">
              <span>${formatPages(node.completedLength)} / ${formatPages(node.totalLength)} ${escapeHtml(unitOf(node))}</span>
              <span>${node.progress}%</span>
              ${node.completed ? '<span>handmatig afgerond</span>' : node.isComplete ? '<span>afgerond via subdelen</span>' : '<span>in progress</span>'}
              ${mismatchBadge}
              ${node.stoppedPage != null && !node.isComplete ? `<span class="saved-position">${escapeHtml(positionText(node))}</span>` : ''}
            </div>
            <div class="progress node-progress"><span style="width:${node.progress}%"></span></div>
          </div>
          <div class="node-actions">
            <button class="tiny-btn" data-action="start-child" data-id="${node.id}" ${actionsDisabled} type="button">+ deel</button>
            <button class="tiny-btn" data-action="add-note" data-id="${node.id}" type="button">+ opmerking</button>
            ${!node.completed && !locked ? `<button class="tiny-btn" data-action="bookmark" data-id="${node.id}" type="button" aria-expanded="${state.ui.bookmarkNodeId === node.id}" aria-controls="bookmark-${node.id}">Gestopt op</button>` : ''}
            <button class="tiny-btn" data-action="start-edit" data-id="${node.id}" ${node.separateTree ? '' : actionsDisabled} type="button">${node.separateTree ? 'Boom wijzigen' : 'wijzig'}</button>
            <button class="tiny-btn danger" data-action="delete-node" data-id="${node.id}" ${node.separateTree ? '' : actionsDisabled} type="button">${node.separateTree ? 'Boom verwijderen' : 'verwijder'}</button>
          </div>
        </div>

        ${renderNotes(node)}
        ${state.ui.editingNodeId === node.id ? renderEditForm(node) : ''}
        ${state.ui.bookmarkNodeId === node.id && !node.completed && !locked ? `<form class="bookmark-form" id="bookmark-${node.id}" data-bookmark="${escapeAttribute(node.id)}">
          <label>${unitOf(node) === 'paginas' ? 'Gestopt op pagina' : `Gestopt bij (${escapeHtml(unitOf(node))})`} <input aria-label="Stoppositie voor ${escapeAttribute(node.title)}" name="stoppedPage" type="number" min="0" step="any" value="${node.stoppedPage ?? ''}" placeholder="Nog niet ingesteld" /></label>
          <button class="tiny-btn" type="submit">Bewaren</button>
          <button class="tiny-btn" type="button" data-action="bookmark" data-id="${node.id}">Sluiten</button>
          <span class="helper-text">${node.stoppedPage != null ? escapeHtml(positionText(node)) : 'Leeg bewaren om te wissen'}</span>
          <span class="helper-text">Tel vanaf het begin van dit onderdeel. Bijvoorbeeld: 25 van 100 = 25%. Leeg bewaren wist deze voortgang.</span>
        </form>` : ''}
        ${state.ui.addingChildNodeId === node.id ? renderChildForm(node) : ''}

        ${hasChildren && !collapsed ? `<div class="child-stack">${node.children.map((child) => renderNode(child, depth + 1, childLocked)).join('')}</div>` : ''}
        ${locked ? '<div class="child-toggle-row">Dit deel is afgerond via een bovenliggend onderdeel.</div>' : ''}
      </article>
    </div>
  `;
}

function renderNotes(node) {
  return (node.notes || []).map((note, index) => `<div class="node-note">
    <p>${escapeHtml(note)}</p>
    <div class="node-note-actions">
      <button class="tiny-btn" type="button" data-action="edit-note" data-id="${node.id}" data-index="${index}">Bewerk</button>
      <button class="tiny-btn danger" type="button" data-action="delete-note" data-id="${node.id}" data-index="${index}">Verwijder</button>
    </div>
  </div>`).join('');
}

async function changeNote(action, id, index) {
  const queue = [...state.data.roots];
  while (queue.length) {
    const node = queue.pop();
    if (node.id !== id) {
      for (const child of node.children) queue.push(child);
      continue;
    }
    const notes = [...(node.notes || [])];
    if (action === 'delete-note') {
      if (!window.confirm('Deze opmerking verwijderen?')) return;
      notes.splice(index, 1);
    } else {
      const note = window.prompt(action === 'add-note' ? 'Opmerking toevoegen' : 'Opmerking bewerken', notes[index] || '')?.trim();
      if (!note) return;
      if (action === 'add-note') notes.push(note);
      else notes[index] = note;
    }
    try { await updateNode(id, { notes }); }
    catch (error) { console.error(error); }
    return;
  }
}

function renderEditForm(node) {
  return `
    <form class="inline-form" data-node-form="${node.id}" data-mode="edit">
      <div class="form-grid">
        <input name="title" type="text" value="${escapeAttribute(node.title)}" required />
        <input aria-label="Omvang in ${escapeAttribute(unitOf(node))}" name="length" type="number" min="0" step="any" value="${node.length || ''}" placeholder="Omvang (${escapeAttribute(unitOf(node))})" />
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
        <input aria-label="Omvang in ${escapeAttribute(unitOf(node))}" name="length" type="number" min="0" step="any" placeholder="Omvang (${escapeAttribute(unitOf(node))})" />
      </div>
      <div class="form-actions">
        <button class="primary" type="submit">Subdeel toevoegen</button>
        <button class="ghost" type="button" data-action="start-child" data-id="${node.id}">Annuleren</button>
      </div>
    </form>
  `;
}

async function createNode({ title, length, parentId, groupId, unit, separateTree }) {
  const response = await fetch('/api/nodes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, length, parentId, groupId, unit, separateTree }),
  });
  await handleResponse(response);
  const created = await response.json();
  await loadData();
  return created;
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
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
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
    app: 'ProgresseT',
    version: 1,
    exportedAt: new Date().toISOString(),
    nodes: flattenRootsForExport(state.data.roots),
    groups: state.data.groups || [],
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `progresset-export-${new Date().toISOString().slice(0, 19).replaceAll(':', '-')}.json`;
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
      separateTree: node.separateTree === true,
      length: node.length,
      unit: node.parentId ? undefined : unitOf(node),
      groupId: node.groupId || null,
      stoppedPage: node.stoppedPage ?? null,
      notes: node.notes || [],
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
  return new Intl.NumberFormat('nl-BE', { maximumFractionDigits: 4 }).format(Number(value || 0));
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
