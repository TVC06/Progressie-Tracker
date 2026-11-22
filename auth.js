const crypto = require('crypto');
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);

module.exports = (app, database, save, context) => {
  const secure = process.env.COOKIE_SECURE === 'true';
  const cookie = (res, token, seconds) => res.setHeader('Set-Cookie',
    `pb_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${seconds}${secure ? '; Secure' : ''}`);
  const digest = token => crypto.createHash('sha256').update(token).digest('hex');
  const attempts = new Map();
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'HEAD'].includes(req.method)) {
      if (req.headers['sec-fetch-site'] === 'cross-site' ||
          (req.headers.origin && req.headers.origin !== `${secure ? 'https' : req.protocol}://${req.headers.host}`)) {
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
  app.get('/api/auth/me', (req, res) => res.json({ user: req.account ? { id: req.account.id, username: req.account.username } : null }));
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
          const hash = await scrypt(password, user?.salt || 'invalid-account', 64);
          if (!user || !crypto.timingSafeEqual(hash, Buffer.from(user.hash, 'hex'))) return res.status(401).json({ error: 'Gebruikersnaam of wachtwoord klopt niet.' });
        }
        const token = crypto.randomBytes(32).toString('hex');
        database.sessions = database.sessions.filter(s => s.expires > Date.now());
        database.sessions.push({ hash: digest(token), userId: user.id, expires: Date.now() + 30 * 86400000 });
        save();
        cookie(res, token, 30 * 86400);
        res.json({ user: { id: user.id, username } });
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
};
