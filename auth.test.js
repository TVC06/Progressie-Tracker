const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('accounts isolate trees and persist across restart', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-auth-'));
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ nodes: [{ id: 'legacy', title: 'Bestaand', length: 10 }] }));
  let child;
  const start = async () => {
    child = spawn(process.execPath, ['server.js'], { cwd: __dirname, env: { ...process.env, PORT: '31987', DATA_DIR: dir }, stdio: ['ignore', 'pipe', 'pipe'] });
    await new Promise((resolve, reject) => {
      child.stdout.once('data', resolve);
      child.once('error', reject);
      child.once('exit', code => reject(new Error(`Server exited: ${code}`)));
    });
  };
  const stop = () => new Promise(resolve => { child.once('exit', resolve); child.kill(); });
  const request = async (route, cookie, method = 'GET', body) => {
    const response = await fetch(`http://localhost:31987/api/${route}`, { method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, cookie: response.headers.get('set-cookie')?.split(';')[0], body: await response.json() };
  };
  try {
    await start();
    assert.equal((await request('tree')).status, 401);
    const a = await request('auth/register', null, 'POST', { username: 'alice', password: 'long-test-password' });
    assert.equal(a.status, 200);
    assert.equal((await request('tree', a.cookie)).body.roots[0].id, 'legacy');
    assert.ok(fs.existsSync(path.join(dir, 'before-accounts.json')));
    const b = await request('auth/register', null, 'POST', { username: 'bob', password: 'other-test-password' });
    assert.equal((await request('tree', b.cookie)).body.roots.length, 0);
    assert.equal((await request('nodes/legacy', b.cookie, 'PATCH', { title: 'Stolen' })).status, 404);
    assert.equal((await request('nodes', b.cookie, 'POST', { title: 'Child', parentId: 'legacy' })).status, 404);
    assert.equal((await request('export', b.cookie)).body.nodes.length, 0);
    assert.equal((await request('import', b.cookie, 'POST', { nodes: [] })).status, 200);
    assert.equal((await request('tree', a.cookie)).body.roots.length, 1);
    assert.equal((await request('import', b.cookie, 'POST', { nodes: [{ id: 'loop', parentId: 'loop' }] })).status, 400);
    assert.equal((await request('auth/login', null, 'POST', { username: 'alice', password: 'wrong-password' })).status, 401);
    await stop();
    await start();
    assert.equal((await request('tree', a.cookie)).body.roots[0].title, 'Bestaand');
    assert.equal((await request('auth/login', null, 'POST', { username: 'alice', password: 'long-test-password' })).status, 200);
    await request('auth/logout', a.cookie, 'POST', {});
    assert.equal((await request('tree', a.cookie)).status, 401);
    const stored = fs.readFileSync(path.join(dir, 'state.json'), 'utf8');
    assert.ok(!stored.includes('long-test-password'));
  } finally {
    if (child && child.exitCode === null) await stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
