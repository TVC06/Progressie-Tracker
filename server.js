const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3000);
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
    };
  } catch {
    return { nodes: [] };
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

  return Math.round(parsed);
}

function saveState() {
  ensureDir(DATA_DIR);
  const tmpFile = `${STATE_FILE}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(state, null, 2), 'utf8');
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

  const walk = (node) => {
    const children = node.children.map(walk);
    const childLengthSum = children.reduce((sum, child) => sum + child.totalLength, 0);
    const totalLength = node.length > 0 ? node.length : childLengthSum;
    const manualCompleted = Boolean(node.completed);
    const rawCompletedLength = manualCompleted
      ? totalLength
      : children.reduce((sum, child) => sum + child.completedLength, 0);
    const completedLength = totalLength > 0 ? Math.min(totalLength, rawCompletedLength) : rawCompletedLength;
    const progress = totalLength > 0 ? Math.min(100, (completedLength / totalLength) * 100) : manualCompleted ? 100 : 0;
    const autoComplete = totalLength > 0 && completedLength >= totalLength;

    return {
      ...node,
      children,
      childLengthSum,
      totalLength,
      completedLength,
      progress: Number(progress.toFixed(1)),
      isComplete: manualCompleted || autoComplete,
      lengthMismatch: node.children.length > 0 && node.length > 0 && childLengthSum > 0 && node.length !== childLengthSum,
    };
  };

  const computedRoots = roots.map(walk);
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

function createNode({ title, length, parentId }) {
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

  if (payload.title !== undefined) {
    const title = String(payload.title || '').trim();
    if (!title) {
      const error = new Error('Titel mag niet leeg zijn.');
      error.statusCode = 400;
      throw error;
    }
    node.title = title;
  }

  if (payload.length !== undefined) {
    node.length = toLength(payload.length);
  }

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

  state = { nodes: normalizedNodes };
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
app.use(express.json({ limit: '1mb' }));
app.use(express.static(PUBLIC_DIR));

let state = loadState();

app.get('/api/tree', (req, res) => {
  const { roots, summary } = buildForest();
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    roots: cloneTreeWithLockedFlags(roots),
    summary,
  });
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
    app: 'Progressie Boom',
    version: 1,
    exportedAt: now(),
    nodes: state.nodes,
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
  console.log(`Progressie Boom draait op http://localhost:${PORT}`);
});
