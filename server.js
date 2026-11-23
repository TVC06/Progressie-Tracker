const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');
const userContext = new AsyncLocalStorage();

const PORT = Number(process.env.PORT || 3002);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

function now() {
  return new Date().toISOString();
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function loadState() {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    const nodes = Array.isArray(parsed.nodes) ? parsed.nodes : [];
    return {
      nodes: nodes.map(normalizeNode).filter(Boolean),
      users: parsed.users || [],
      sessions: parsed.sessions || [],
    };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return { nodes: [], users: [], sessions: [] };
  }
}

function flattenTreeNodes(nodes, parentId = null, bucket = []) {
  for (const node of Array.isArray(nodes) ? nodes : []) {
    const normalized = normalizeNode({
      ...node,
      parentId,
    });
    if (!normalized) {
      continue;
    }

    bucket.push(normalized);
    flattenTreeNodes(node.children, normalized.id, bucket);
  }

  return bucket;
}

function normalizeNode(node) {
  if (!node || typeof node !== 'object') {
    return null;
  }

  const id = typeof node.id === 'string' && node.id ? node.id : crypto.randomUUID();
  const title = typeof node.title === 'string' ? node.title.trim() : '';
  const length = toLength(node.length);
  const parentId = node.parentId == null || node.parentId === '' ? null : String(node.parentId);
  const order = Number.isFinite(Number(node.order)) ? Number(node.order) : 0;

  return {
    id,
    parentId,
    title: title || 'Naamloos',
    length,
    unit: validateUnit(node.unit),
    groupId: typeof node.groupId === 'string' ? node.groupId : null,
    stoppedPage: node.stoppedPage == null ? null : validatePage(node.stoppedPage),
    completed: Boolean(node.completed),
    order,
    createdAt: typeof node.createdAt === 'string' ? node.createdAt : now(),
    updatedAt: typeof node.updatedAt === 'string' ? node.updatedAt : now(),
  };
}

function toLength(value) {
  if (value === undefined || value === null || value === '') {
    return 0;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error('Lengte moet een positief getal zijn.');
  }

  if (parsed > Number.MAX_SAFE_INTEGER) throw new Error('Lengte is te groot.');
  return Number(parsed.toFixed(4));
}

function validateUnit(value) {
  if (value === undefined) return 'paginas';
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 30 || /[<>\x00-\x1f]/.test(value)) throw new Error('Geef een eenheid van 1-30 tekens op.');
  return value.trim();
}

function validatePage(value) {
  if (value === '' || value === null) return null;
  const page = Number(value);
  if (!Number.isFinite(page) || page < 0 || page > Number.MAX_SAFE_INTEGER) throw new Error('Geef een geldige positie vanaf 0 op.');
  return Number(page.toFixed(4));
}

function validateGroup(groupId) {
  if (!groupId) return null;
  if (!state.groups.some(group => group.id === groupId)) throw new Error('Maak deze groep eerst aan.');
  return groupId;
}

function saveState() {
  ensureDir(DATA_DIR);
  const tmpFile = `${STATE_FILE}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(database, null, 2), { encoding: 'utf8', flush: true });
  fs.renameSync(tmpFile, STATE_FILE);
}

function findNode(id) {
  return state.nodes.find((node) => node.id === id);
}

function getDescendantIds(rootId) {
  const ids = new Set([rootId]);
  const queue = [rootId];

  while (queue.length > 0) {
    const current = queue.shift();
    const children = state.nodes.filter((node) => node.parentId === current);
    for (const child of children) {
      if (!ids.has(child.id)) {
        ids.add(child.id);
        queue.push(child.id);
      }
    }
  }

  return ids;
}

function sortChildren(nodes) {
  nodes.sort((a, b) => {
    if (a.order !== b.order) {
      return a.order - b.order;
    }
    return a.title.localeCompare(b.title, 'nl');
  });
  nodes.forEach((node) => sortChildren(node.children));
}

function buildForest() {
  const nodeMap = new Map();
  const roots = [];

  for (const node of state.nodes) {
    nodeMap.set(node.id, { ...node, children: [] });
  }

  for (const node of nodeMap.values()) {
    if (node.parentId && nodeMap.has(node.parentId)) {
      nodeMap.get(node.parentId).children.push(node);
    } else {
      roots.push(node);
    }
  }

  sortChildren(roots);

  const walk = (node, inheritedUnit, inheritedCompleted = false) => {
    const unit = inheritedUnit || node.unit || 'paginas';
    const manualCompleted = Boolean(node.completed) || inheritedCompleted;
    const children = node.children.map(child => walk(child, unit, manualCompleted));
    const childLengthSum = Number(children.reduce((sum, child) => sum + child.totalLength, 0).toFixed(4));
    const totalLength = node.length > 0 ? node.length : childLengthSum;
    // A parent's stop position overlaps its children's progress; never add both.
    const childCompletedLength = Number(children.reduce((sum, child) => sum + child.completedLength, 0).toFixed(4));
    const stoppedLength = node.stoppedPage == null ? 0 : node.stoppedPage;
    const rawCompletedLength = manualCompleted
      ? totalLength
      : Math.max(stoppedLength, childCompletedLength);
    const completedLength = Math.min(totalLength, rawCompletedLength);
    const progress = totalLength > 0 ? Math.min(100, (completedLength / totalLength) * 100) : manualCompleted ? 100 : 0;
    const autoComplete = totalLength > 0 && completedLength >= totalLength;

    return {
      ...node,
      unit,
      children,
      childLengthSum,
      totalLength,
      completedLength,
      progress: Number(progress.toFixed(1)),
      isComplete: manualCompleted || autoComplete,
      lengthMismatch: node.children.length > 0 && node.length > 0 && childLengthSum > 0 && node.length !== childLengthSum,
    };
  };

  const computedRoots = roots.map(root => walk(root));
  const summary = computedRoots.reduce(
    (acc, node) => {
      acc.totalLength += node.totalLength;
      acc.completedLength += node.completedLength;
      acc.nodeCount += 1 + countDescendants(node);
      acc.rootCount += 1;
      return acc;
    },
    { totalLength: 0, completedLength: 0, nodeCount: 0, rootCount: 0 }
  );

  summary.progress = summary.totalLength > 0 ? Number(((summary.completedLength / summary.totalLength) * 100).toFixed(1)) : 0;
  return { roots: computedRoots, summary };
}

function countDescendants(node) {
  return node.children.reduce((count, child) => count + 1 + countDescendants(child), 0);
}

function createNode({ title, length, parentId, groupId, unit }) {
  const normalizedTitle = String(title || '').trim();
  if (!normalizedTitle) {
    const error = new Error('Geef een titel op.');
    error.statusCode = 400;
    throw error;
  }

  if (parentId && !findNode(parentId)) {
    const error = new Error('Bovenliggend onderdeel bestaat niet.');
    error.statusCode = 404;
    throw error;
  }

  const siblings = state.nodes.filter((node) => node.parentId === (parentId || null));
  const node = {
    id: crypto.randomUUID(),
    groupId: parentId ? null : validateGroup(groupId),
    stoppedPage: null,
    unit: parentId ? undefined : validateUnit(unit),
    parentId: parentId || null,
    title: normalizedTitle,
    length: toLength(length),
    completed: false,
    order: siblings.length,
    createdAt: now(),
    updatedAt: now(),
  };

  state.nodes.push(node);
  saveState();
  return node;
}

function updateNode(id, payload) {
  const node = findNode(id);
  if (!node) {
    const error = new Error('Onderdeel niet gevonden.');
    error.statusCode = 404;
    throw error;
  }

  const groupId = payload.groupId !== undefined ? validateGroup(payload.groupId) : node.groupId;
  const stoppedPage = payload.stoppedPage !== undefined ? validatePage(payload.stoppedPage) : node.stoppedPage;
  const unit = payload.unit !== undefined ? validateUnit(payload.unit) : node.unit;
  if (node.parentId && payload.unit !== undefined) throw new Error('De eenheid stel je in bij het project.');
  const length = payload.length !== undefined ? toLength(payload.length) : node.length;
  if (node.parentId && payload.groupId) throw new Error('Alleen vakken/projecten kunnen in een groep.');
  if (payload.title !== undefined) {
    const title = String(payload.title || '').trim();
    if (!title) {
      const error = new Error('Titel mag niet leeg zijn.');
      error.statusCode = 400;
      throw error;
    }
    node.title = title;
  }

  node.length = length;
  node.unit = unit;

  node.groupId = groupId;
  node.stoppedPage = stoppedPage;
  node.updatedAt = now();
  saveState();
  return node;
}

function setSubtreeCompletion(id, completed) {
  const target = findNode(id);
  if (!target) {
    const error = new Error('Onderdeel niet gevonden.');
    error.statusCode = 404;
    throw error;
  }

  const ids = getDescendantIds(id);
  for (const node of state.nodes) {
    if (ids.has(node.id)) {
      node.completed = completed;
      node.updatedAt = now();
    }
  }

  saveState();
}

function deleteNode(id) {
  const target = findNode(id);
  if (!target) {
    const error = new Error('Onderdeel niet gevonden.');
    error.statusCode = 404;
    throw error;
  }

  const ids = getDescendantIds(id);
  state.nodes = state.nodes.filter((node) => !ids.has(node.id));
  saveState();
}

function importStateFromPayload(payload) {
  const rawNodes = Array.isArray(payload?.nodes)
    ? payload.nodes
    : Array.isArray(payload?.roots)
      ? flattenTreeNodes(payload.roots)
      : null;

  if (!rawNodes) {
    const error = new Error('Importbestand mist een nodes- of roots-array.');
    error.statusCode = 400;
    throw error;
  }

  const normalizedNodes = rawNodes
    .map((node) => normalizeNode(node))
    .filter(Boolean);

  const ids = new Set(normalizedNodes.map(node => node.id));
  if (ids.size !== normalizedNodes.length) throw new Error('Dubbele onderdeel-ID in import.');
  for (const node of normalizedNodes) {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(node.id)) throw new Error('Ongeldig onderdeel-ID.');
    const visited = new Set([node.id]);
    let parent = node.parentId;
    while (parent) {
      if (!ids.has(parent) || visited.has(parent)) throw new Error('Ongeldige boomstructuur.');
      visited.add(parent);
      parent = normalizedNodes.find(item => item.id === parent).parentId;
    }
  }
  const groups = payload.groups === undefined ? state.groups : payload.groups;
  if (!Array.isArray(groups) || groups.some(g => !g || typeof g.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(g.id) || typeof g.title !== 'string' || !g.title.trim()) || new Set(groups.map(g => g.id)).size !== groups.length) throw new Error('Ongeldige groepen.');
  if (normalizedNodes.some(n => n.groupId && (n.parentId || !groups.some(g => g.id === n.groupId)))) throw new Error('Ongeldige groepsindeling.');
  state.groups = groups.map(g => ({ id: g.id, title: g.title.trim() }));
  state.nodes = normalizedNodes;
  saveState();

  return normalizedNodes.length;
}

function cloneTreeWithLockedFlags(nodes, ancestorLocked = false) {
  return nodes.map((node) => {
    const locked = ancestorLocked || node.completed;
    return {
      ...node,
      locked,
      children: cloneTreeWithLockedFlags(node.children, locked),
    };
  });
}

const app = express();
if (process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', 1);
}
app.use(express.json({ limit: '5mb' }));
app.use(express.static(PUBLIC_DIR));

const database = loadState();
// All existing tree operations use only the authenticated user's storage.
const state = {
  get nodes() { return userContext.getStore().nodes; },
  set nodes(nodes) { userContext.getStore().nodes = nodes; },
  get groups() { return userContext.getStore().groups || []; },
  set groups(groups) { userContext.getStore().groups = groups; },
};
require('./auth')(app, database, saveState, userContext);
require('./sharing')(app, state, buildForest, saveState);

app.get('/api/tree', (req, res) => {
  const { roots, summary } = buildForest();
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    roots: cloneTreeWithLockedFlags(roots),
    summary,
    groups: state.groups,
  });
});

app.post('/api/groups', (req, res) => {
  const title = typeof req.body.title === 'string' ? req.body.title.trim() : '';
  if (!title || title.length > 80) return res.status(400).json({ error: 'Geef een groepsnaam van 1-80 tekens op.' });
  if (state.groups.some(g => g.title.toLowerCase() === title.toLowerCase())) return res.status(409).json({ error: 'Deze groep bestaat al.' });
  const group = { id: crypto.randomUUID(), title };
  state.groups = [...state.groups, group];
  saveState();
  res.status(201).json(group);
});

app.delete('/api/groups/:id', (req, res) => {
  if (!state.groups.some(g => g.id === req.params.id)) return res.status(404).json({ error: 'Groep niet gevonden.' });
  state.groups = state.groups.filter(g => g.id !== req.params.id);
  state.nodes.forEach(n => { if (n.groupId === req.params.id) n.groupId = null; });
  saveState();
  res.json({ ok: true });
});

app.post('/api/nodes', (req, res) => {
  try {
    const created = createNode(req.body || {});
    res.status(201).json(created);
  } catch (error) {
    res.status(error.statusCode || 400).json({ error: error.message || 'Kon onderdeel niet aanmaken.' });
  }
});

app.patch('/api/nodes/:id', (req, res) => {
  try {
    const updated = updateNode(req.params.id, req.body || {});
    res.json(updated);
  } catch (error) {
    res.status(error.statusCode || 400).json({ error: error.message || 'Kon onderdeel niet bijwerken.' });
  }
});

app.post('/api/nodes/:id/toggle', (req, res) => {
  try {
    const node = findNode(req.params.id);
    if (!node) {
      return res.status(404).json({ error: 'Onderdeel niet gevonden.' });
    }

    const completed = typeof req.body?.completed === 'boolean' ? req.body.completed : !node.completed;
    setSubtreeCompletion(req.params.id, completed);
    res.json({ ok: true });
  } catch (error) {
    res.status(error.statusCode || 400).json({ error: error.message || 'Kon status niet aanpassen.' });
  }
});

app.delete('/api/nodes/:id', (req, res) => {
  try {
    deleteNode(req.params.id);
    res.json({ ok: true });
  } catch (error) {
    res.status(error.statusCode || 400).json({ error: error.message || 'Kon onderdeel niet verwijderen.' });
  }
});

app.get('/api/export', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    app: 'ProgresseT',
    version: 1,
    exportedAt: now(),
    nodes: state.nodes,
    groups: state.groups,
  });
});

app.post('/api/import', (req, res) => {
  try {
    const importedCount = importStateFromPayload(req.body || {});
    res.json({ ok: true, importedCount });
  } catch (error) {
    res.status(error.statusCode || 400).json({ error: error.message || 'Kon import niet uitvoeren.' });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.listen(PORT, () => {
  ensureDir(DATA_DIR);
  if (!fs.existsSync(STATE_FILE)) {
    saveState();
  }
  console.log(`ProgresseT draait op http://localhost:${PORT}`);
});
