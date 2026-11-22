let transferNoticeTimer;

function notifyTransfer(message) {
  const notice = document.getElementById('app-notice');
  clearTimeout(transferNoticeTimer);
  notice.textContent = message;
  notice.classList.remove('hidden');
  transferNoticeTimer = setTimeout(() => notice.classList.add('hidden'), 6500);
}

function resetTransferUi() {
  for (const id of ['share-dialog', 'share-import-dialog', 'ai-prompt-dialog']) document.getElementById(id).close();
  document.getElementById('share-form').reset();
  document.getElementById('share-import-form').reset();
  document.getElementById('app-notice').classList.add('hidden');
  clearTimeout(transferNoticeTimer);
}

async function transferResponse(response) {
  if (response.status === 401) await showAccount(null);
  let body;
  try { body = await response.json(); }
  catch { throw new Error('Geen geldig antwoord van de server. Controleer de bestandsgrootte en probeer opnieuw.'); }
  if (!response.ok) throw new Error(body.error || 'De actie is mislukt.');
  return body;
}

function downloadTransfer(payload, filename) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function openShare(type, id) {
  const item = (type === 'project' ? state.data.roots : state.data.groups || []).find(item => item.id === id);
  if (!item) return;
  const form = document.getElementById('share-form');
  form.reset();
  form.dataset.type = type;
  form.dataset.itemId = id;
  form.dataset.title = item.title;
  document.getElementById('share-error').textContent = '';
  document.getElementById('share-title').textContent = `${type === 'project' ? 'Vak/project' : 'Groep'}: ${item.title}`;
  document.getElementById('share-dialog').showModal();
}

function openShareImport(groupId = '') {
  const form = document.getElementById('share-import-form');
  form.reset();
  document.getElementById('share-import-error').textContent = '';
  form.elements.targetGroupId.innerHTML = '<option value="">Groep uit bestand / anders zonder groep</option>' + (state.data.groups || []).map(group => `<option value="${escapeAttribute(group.id)}" ${group.id === groupId ? 'selected' : ''}>${escapeHtml(group.title)}</option>`).join('');
  document.getElementById('share-import-dialog').showModal();
}

async function copyCoursePrompt() {
  let copied = false;
  try {
    await navigator.clipboard.writeText(AI_COURSE_PROMPT);
    copied = true;
  } catch {
    const input = document.createElement('textarea');
    input.value = AI_COURSE_PROMPT;
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    document.body.appendChild(input);
    input.select();
    try { copied = document.execCommand('copy'); } catch { copied = false; }
    input.remove();
  }
  if (copied) {
    notifyTransfer('AI-prompt gekopieerd. Plak hem bij je AI en voeg je inhoudstafel en eindpagina toe.');
  } else {
    const input = document.getElementById('ai-prompt-text');
    input.value = AI_COURSE_PROMPT;
    document.getElementById('ai-prompt-dialog').showModal();
    input.focus();
    input.select();
  }
}

function bindTransfers() {
  document.getElementById('open-share-import-btn').addEventListener('click', () => openShareImport());
  document.getElementById('selected-share-btn').addEventListener('click', () => openShare('project', state.ui.selectedRootId));
  document.addEventListener('click', event => {
    const close = event.target.closest('[data-close-dialog]');
    if (close) document.getElementById(close.dataset.closeDialog).close();
    const share = event.target.closest('[data-share-type]');
    if (share) openShare(share.dataset.shareType, share.dataset.shareId);
    const importer = event.target.closest('[data-import-group]');
    if (importer) openShareImport(importer.dataset.importGroup);
    if (event.target.closest('[data-copy-ai]')) copyCoursePrompt();
  });
  document.getElementById('share-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.target;
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    document.getElementById('share-error').textContent = '';
    try {
      const response = await fetch(`/api/share/${form.dataset.type}/${form.dataset.itemId}?progress=${form.elements.progress.checked ? '1' : '0'}`);
      const payload = await transferResponse(response);
      const name = form.dataset.title.normalize('NFKD').replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 70) || 'gedeeld';
      downloadTransfer(payload, `progresset-${form.dataset.type}-${name}.json`);
      document.getElementById('share-dialog').close();
      notifyTransfer('JSON gedownload. Je kunt dit bestand nu delen.');
    } catch (error) { document.getElementById('share-error').textContent = error.message; }
    finally { button.disabled = false; }
  });
  document.getElementById('share-import-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.target;
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    document.getElementById('share-import-error').textContent = '';
    try {
      const file = form.elements.file.files[0];
      if (!file) throw new Error('Kies eerst een JSON-bestand.');
      if (file.size > 4 * 1024 * 1024) throw new Error('Kies een bestand kleiner dan 4 MB.');
      let payload;
      try { payload = JSON.parse((await file.text()).replace(/^\uFEFF/, '')); }
      catch { throw new Error('Dit bestand bevat geen geldige JSON. Vraag de AI om een .json-bestand zonder Markdown.'); }
      const response = await fetch('/api/share/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload, targetGroupId: form.elements.targetGroupId.value || null, keepProgress: form.elements.keepProgress.checked }),
      });
      const result = await transferResponse(response);
      document.getElementById('share-import-dialog').close();
      form.reset();
      state.ui.selectedRootId = null;
      state.ui.adminOpen = false;
      await loadData();
      notifyTransfer(`${result.projectCount} vakken/projecten toegevoegd (${result.importedCount} onderdelen). Bestaande projecten zijn behouden.`);
    } catch (error) { document.getElementById('share-import-error').textContent = error.message; }
    finally { button.disabled = false; }
  });
}
