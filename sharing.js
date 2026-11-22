const crypto = require('crypto');

module.exports = (app, state, buildForest, save) => {
  const portable = (node, progress) => ({
    title: node.title,
    length: node.length,
    unit: node.unit || 'paginas',
    ...(progress ? { completed: Boolean(node.completed), stoppedPage: node.stoppedPage ?? null } : {}),
    children: node.children.map(child => portable(child, progress)),
  });
  const envelope = (type, roots, progress) => ({
    app: 'ProgresseT', version: 1, type,
    exportedAt: new Date().toISOString(),
    roots: roots.map(root => portable(root, progress)),
  });

  app.get('/api/share/project/:id', (req, res) => {
    const root = buildForest().roots.find(root => root.id === req.params.id);
    if (!root) return res.status(404).json({ error: 'Vak of project niet gevonden.' });
    res.json(envelope('project', [root], req.query.progress === '1'));
  });

  app.get('/api/share/group/:id', (req, res) => {
    const group = state.groups.find(group => group.id === req.params.id);
    if (!group) return res.status(404).json({ error: 'Groep niet gevonden.' });
    res.json({ ...envelope('group', buildForest().roots.filter(root => root.groupId === group.id), req.query.progress === '1'), group: { title: group.title } });
  });

  app.post('/api/share/import', (req, res) => {
    try {
      const { payload, targetGroupId, keepProgress = false } = req.body || {};
      if (!payload || payload.app !== 'ProgresseT' || payload.version !== 1 || !['project', 'group'].includes(payload.type) || !Array.isArray(payload.roots)) throw new Error('Kies een gedeeld ProgresseT-vak of -groep (versie 1), geen volledige back-up.');
      if (payload.type === 'project' && payload.roots.length !== 1) throw new Error('Een vakbestand moet precies een project bevatten.');
      if (typeof keepProgress !== 'boolean') throw new Error('Ongeldige keuze voor voortgang.');
      if (targetGroupId != null && (typeof targetGroupId !== 'string' || !state.groups.some(group => group.id === targetGroupId))) throw new Error('Doelgroep niet gevonden.');
      const title = value => {
        if (typeof value !== 'string' || !value.trim() || value.trim().length > 300) throw new Error('Elk onderdeel moet een titel van 1-300 tekens hebben.');
        return value.trim();
      };
      const amount = value => {
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) throw new Error('Elke lengte en stoppositie moet een positief getal of 0 zijn.');
        return Number(value.toFixed(4));
      };
      const nodes = [];
      const timestamp = new Date().toISOString();
      let groupId = targetGroupId || null;
      let importedGroup;
      if (payload.type === 'group') {
        const groupTitle = title(payload.group?.title);
        if (!groupId) {
          let uniqueTitle = groupTitle;
          let suffix = 2;
          while (state.groups.some(group => group.title.toLowerCase() === uniqueTitle.toLowerCase())) uniqueTitle = `${groupTitle} (${suffix++})`;
          importedGroup = { id: crypto.randomUUID(), title: uniqueTitle };
          groupId = importedGroup.id;
        }
      }
      const visit = (raw, parentId, order, inheritedUnit, depth) => {
        if (depth > 60 || nodes.length >= 5000) throw new Error('Bestand is te groot: maximaal 5000 onderdelen en 60 niveaus.');
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Ongeldig onderdeel.');
        const unit = inheritedUnit || raw.unit || 'paginas';
        if (typeof unit !== 'string' || !unit.trim() || unit.length > 30 || /[<>\x00-\x1f]/.test(unit)) throw new Error('Ongeldige eenheid.');
        if (raw.unit !== undefined && raw.unit !== unit) throw new Error('Alle onderdelen van een project moeten dezelfde eenheid gebruiken.');
        if (raw.completed !== undefined && typeof raw.completed !== 'boolean') throw new Error('completed moet true of false zijn.');
        if (raw.children !== undefined && !Array.isArray(raw.children)) throw new Error('children moet een lijst zijn.');
        const stoppedPage = raw.stoppedPage == null ? null : amount(raw.stoppedPage);
        const node = {
          id: crypto.randomUUID(), parentId, title: title(raw.title), length: amount(raw.length),
          unit: unit.trim(), groupId: parentId ? null : groupId,
          completed: keepProgress && Boolean(raw.completed), stoppedPage: keepProgress ? stoppedPage : null,
          order, createdAt: timestamp, updatedAt: timestamp,
        };
        nodes.push(node);
        (raw.children || []).forEach((child, index) => visit(child, node.id, index, unit, depth + 1));
      };
      const rootOffset = state.nodes.filter(node => !node.parentId).length;
      payload.roots.forEach((root, index) => visit(root, null, rootOffset + index, null, 0));
      const previousNodes = state.nodes;
      const previousGroups = state.groups;
      state.nodes = [...previousNodes, ...nodes];
      if (importedGroup) state.groups = [...previousGroups, importedGroup];
      try { save(); }
      catch (error) { state.nodes = previousNodes; state.groups = previousGroups; throw error; }
      res.status(201).json({ importedCount: nodes.length, projectCount: payload.roots.length, groupId });
    } catch (error) {
      res.status(400).json({ error: error.message || 'Bestand kon niet worden toegevoegd.' });
    }
  });
};
