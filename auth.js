const crypto = require('crypto');
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);

module.exports = (app, database, save, context) => {
  const secure = process.env.COOKIE_SECURE === 'true';
  const publicOrigin = process.env.PUBLIC_ORIGIN?.trim().replace(/\/+$/, '') || null;
  const cookie = (res, token, seconds) => res.setHeader('Set-Cookie',
    `pb_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${seconds}${secure ? '; Secure' : ''}`);
  const digest = token => crypto.createHash('sha256').update(token).digest('hex');
  const isAdmin = user => user?.username === 'thomas';
  const publicUser = user => ({ id: user.id, username: user.username, isAdmin: isAdmin(user) });
  const attempts = new Map();
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'HEAD'].includes(req.method)) {
      const expectedOrigin = publicOrigin || `${secure ? 'https' : req.protocol}://${req.headers.host}`;
      if (req.headers['sec-fetch-site'] === 'cross-site' ||
          (req.headers.origin && req.headers.origin !== expectedOrigin)) {
        return res.status(403).json({ error: 'Ongeldige herkomst.' });
      }
      if (!req.is('application/json')) return res.status(415).json({ error: 'JSON vereist.' });
    }
    const token = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('pb_session='))?.slice(11);
    const session = token && database.sessions.find(s => s.hash === digest(token) && s.expires > Date.now());
    req.account = session && database.users.find(u => u.id === session.userId);
    req.sessionHash = session?.hash;
    next();
  });
  app.get('/api/auth/me', (req, res) => res.json({ user: req.account ? publicUser(req.account) : null }));
  for (const mode of ['register', 'login']) {
    app.post(`/api/auth/${mode}`, async (req, res) => {
      try {
        const key = req.socket.remoteAddress;
        const entry = attempts.get(key);
        const count = entry && entry.until > Date.now() ? entry : { count: 0, until: Date.now() + 900000 };
        if (++count.count > 30) return res.status(429).json({ error: 'Te veel pogingen. Probeer over 15 minuten opnieuw.' });
        attempts.set(key, count);
        for (const [ip, item] of attempts) if (item.until < Date.now()) attempts.delete(ip);
        const username = String(req.body.username || '').trim().toLowerCase();
        const password = req.body.password;
        if (!/^[a-z0-9_.-]{3,40}$/.test(username) || typeof password !== 'string' || password.length < 10 || password.length > 256) {
          return res.status(400).json({ error: 'Gebruik een gebruikersnaam van 3-40 letters/cijfers en een wachtwoord van 10-256 tekens.' });
        }
        let user = database.users.find(u => u.username === username);
        if (mode === 'register') {
          if (user) return res.status(409).json({ error: 'Deze gebruikersnaam bestaat al.' });
          const salt = crypto.randomBytes(16).toString('hex');
          const hash = (await scrypt(password, salt, 64)).toString('hex');
          if (database.users.some(u => u.username === username)) return res.status(409).json({ error: 'Deze gebruikersnaam bestaat al.' });
          if (!database.users.length && database.nodes.length) {
            const fs = require('fs');
            const path = require('path');
            const dir = process.env.DATA_DIR || path.join(__dirname, 'data');
            fs.copyFileSync(path.join(dir, 'state.json'), path.join(dir, 'before-accounts.json'));
          }
          user = { id: crypto.randomUUID(), username, salt, hash, nodes: database.users.length ? [] : database.nodes };
          database.users.push(user);
          database.nodes = [];
        } else {
          const storedHash = user?.hash;
          const hash = await scrypt(password, user?.salt || 'invalid-account', 64);
          if (!user || !database.users.includes(user) || user.hash !== storedHash || !crypto.timingSafeEqual(hash, Buffer.from(user.hash, 'hex'))) return res.status(401).json({ error: 'Gebruikersnaam of wachtwoord klopt niet.' });
        }
        const token = crypto.randomBytes(32).toString('hex');
        database.sessions = database.sessions.filter(s => s.expires > Date.now());
        database.sessions.push({ hash: digest(token), userId: user.id, expires: Date.now() + 30 * 86400000 });
        save();
        cookie(res, token, 30 * 86400);
        res.json({ user: publicUser(user) });
      } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Account kon niet worden opgeslagen.' });
      }
    });
  }
  app.post('/api/auth/logout', (req, res) => {
    database.sessions = database.sessions.filter(s => s.hash !== req.sessionHash);
    save();
    cookie(res, '', 0);
    res.json({ ok: true });
  });
  app.use('/api', (req, res, next) => {
    if (!req.account) return res.status(401).json({ error: 'Log eerst in.' });
    context.run(req.account, next);
  });

  app.use('/api/admin', (req, res, next) => {
    if (!isAdmin(req.account)) return res.status(403).json({ error: 'Alleen Thomas heeft toegang tot accountbeheer.' });
    next();
  });

  app.get('/api/admin/backup', (req, res) => {
    res.attachment('progresset-alle-accounts.json').json({
      app: 'ProgresseT',
      version: 1,
      type: 'all-trees',
      exportedAt: new Date().toISOString(),
      accounts: database.users.map(({ username, nodes, groups }) => ({
        username, nodes: nodes || [], groups: groups || [],
      })),
    });
  });

  app.get('/api/admin/users', (req, res) => {
    res.json({ users: database.users.map(user => ({
      ...publicUser(user),
      projectCount: (user.nodes || []).filter(node => !node.parentId).length,
    })).sort((a, b) => a.username.localeCompare(b.username)) });
  });

  app.delete('/api/admin/users/:id', (req, res) => {
    const target = database.users.find(user => user.id === req.params.id);
    if (!target) return res.status(404).json({ error: 'Account niet gevonden.' });
    if (target.id === req.account.id) return res.status(400).json({ error: 'Je kunt je eigen beheerdersaccount niet verwijderen.' });
    const previousUsers = database.users;
    const previousSessions = database.sessions;
    database.users = database.users.filter(user => user.id !== target.id);
    database.sessions = database.sessions.filter(session => session.userId !== target.id);
    try {
      save();
      res.json({ ok: true });
    } catch (error) {
      database.users = previousUsers;
      database.sessions = previousSessions;
      console.error(error);
      res.status(500).json({ error: 'Account kon niet worden verwijderd.' });
    }
  });

  app.post('/api/admin/users/:id/password', async (req, res) => {
    const target = database.users.find(user => user.id === req.params.id);
    if (!target) return res.status(404).json({ error: 'Account niet gevonden.' });
    const password = req.body.password;
    if (typeof password !== 'string' || password.length < 10 || password.length > 256) return res.status(400).json({ error: 'Gebruik een wachtwoord van 10-256 tekens.' });
    try {
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = (await scrypt(password, salt, 64)).toString('hex');
      if (!database.users.includes(target)) return res.status(404).json({ error: 'Account niet gevonden.' });
      const previous = { salt: target.salt, hash: target.hash, sessions: database.sessions };
      target.salt = salt;
      target.hash = hash;
      database.sessions = database.sessions.filter(session => session.userId !== target.id);
      try { save(); }
      catch (error) {
        target.salt = previous.salt;
        target.hash = previous.hash;
        database.sessions = previous.sessions;
        throw error;
      }
      res.json({ ok: true, signedOut: target.id === req.account.id });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Wachtwoord kon niet worden gewijzigd.' });
    }
  });
};
