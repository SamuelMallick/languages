import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createAccessPolicy } from '../server/access.js';
import { createApp } from '../server/app.js';
import { createStore } from '../server/store.js';
import { createServer } from 'vite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const origin = 'https://study.personal-tailnet.ts.net';
const login = 'learner@example.com';
const access = { tailscaleOrigin: origin, tailscaleLogin: login };
const remoteHeaders = { Host: new URL(origin).host, 'Tailscale-User-Login': login };

async function fixture(t, options = access) {
  const directory = mkdtempSync(path.join(tmpdir(), 'lingua-access-test-'));
  const store = createStore(directory);
  let signIns = 0;
  const chatgpt = { status: () => ({ connected: true, sharing: true, profiles: [] }), begin: () => { signIns++; return { url: 'unused' }; } };
  const app = createApp(store, { tutor: async () => 'Hallo vanaf de computer.' }, chatgpt, options);
  app.get('/test-page', (req, res) => res.send('interface'));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    store.db.close();
    assert.equal(path.dirname(directory), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith('lingua-access-test-'));
    rmSync(directory, { recursive: true, force: true });
  });
  function request(route, { headers = {}, method = 'GET', body } = {}) {
    return new Promise((resolve, reject) => {
      const req = httpRequest({ hostname: '127.0.0.1', port: server.address().port, path: route, method,
        headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers } }, res => {
        let text = '';
        res.setEncoding('utf8'); res.on('data', chunk => { text += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text,
          data: res.headers['content-type']?.includes('application/json') ? JSON.parse(text) : null }));
      });
      req.on('error', reject);
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });
  }
  return { request, signIns: () => signIns };
}

test('Tailscale configuration is explicit, HTTPS-only, and fails closed', () => {
  for (const options of [
    { tailscaleOrigin: origin }, { tailscaleLogin: login },
    { ...access, tailscaleOrigin: 'http://study.personal-tailnet.ts.net' },
    { ...access, tailscaleOrigin: 'https://example.com' },
    { ...access, tailscaleOrigin: 'https://study.personal-tailnet.ts.net.evil.com' },
    { ...access, tailscaleOrigin: `${origin}/app` },
    { ...access, tailscaleOrigin: `${origin}?q=1` },
    { ...access, tailscaleOrigin: `${origin}#app` },
    { ...access, tailscaleOrigin: 'https://user@study.personal-tailnet.ts.net' },
    { ...access, tailscaleOrigin: `${origin}:8443` },
    { ...access, tailscaleLogin: 'user\r\nheader' },
  ]) assert.throws(() => createAccessPolicy(options), /Set both TAILSCALE/);
  assert.equal(typeof createAccessPolicy(), 'function');
  assert.equal(typeof createAccessPolicy(access), 'function');
});

test('default remains localhost-only, even with spoofed proxy headers', async t => {
  const { request } = await fixture(t, {});
  assert.equal((await request('/api/bootstrap')).status, 200);
  assert.equal((await request('/api/bootstrap', { headers: remoteHeaders })).status, 403);
  assert.equal((await request('/api/bootstrap', { headers: { Host: 'evil.example', 'X-Forwarded-Host': 'localhost', 'X-Forwarded-Proto': 'http' } })).status, 403);
});

test('Serve requires exact host and approved identity for pages and APIs', async t => {
  const { request } = await fixture(t);
  for (const route of ['/api/bootstrap', '/test-page']) {
    const result = await request(route, { headers: remoteHeaders });
    assert.equal(result.status, 200);
    assert.equal(result.headers['x-frame-options'], 'DENY');
    for (const headers of [
      { Host: remoteHeaders.Host },
      { ...remoteHeaders, 'Tailscale-User-Login': 'someone-else@example.com' },
      { ...remoteHeaders, Host: 'other.personal-tailnet.ts.net' },
      { ...remoteHeaders, Host: 'localhost:3000' },
      { ...remoteHeaders, Host: '100.64.0.1:3000' },
      { Host: 'localhost:3000', 'X-Forwarded-For': '100.64.0.5' },
      { Host: 'localhost:3000', Forwarded: 'for=100.64.0.5' },
      { Host: 'localhost:3000', 'Tailscale-User-Login': '' },
    ]) assert.equal((await request(route, { headers })).status, 403);
  }
  const local = await request('/api/settings');
  assert.equal(local.data.chatgpt.signInAvailable, true);
  const remote = await request('/api/settings', { headers: remoteHeaders });
  assert.equal(remote.data.chatgpt.signInAvailable, false);
  assert.equal(remote.data.chatgpt.sharing, true);
  assert.equal(remote.headers['cache-control'], 'no-store');
});

test('Serve uses the configured HTTPS origin, not forwarded headers, for CSRF checks', async t => {
  const { request } = await fixture(t);
  assert.equal((await request('/api/bootstrap', { headers: { ...remoteHeaders, Origin: origin, 'Sec-Fetch-Site': 'same-origin' } })).status, 200);
  for (const headers of [
    { Origin: 'https://evil.example' }, { Origin: origin.replace('https:', 'http:') },
    { Origin: 'null' }, { Origin: origin, 'Sec-Fetch-Site': 'cross-site' },
    { Origin: 'https://evil.example', 'X-Forwarded-Host': 'evil.example', 'X-Forwarded-Proto': 'https' },
  ]) {
    for (const method of ['GET', 'POST']) assert.equal((await request('/api/languages', { method, headers: { ...remoteHeaders, ...headers }, ...(method === 'POST' ? { body: {} } : {}) })).status, 403);
  }
  assert.equal((await request('/api/bootstrap', { headers: { Origin: origin, 'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': remoteHeaders.Host } })).status, 403);
});

test('iPad mutations and tutor conversations share the computer database', async t => {
  const { request } = await fixture(t);
  const headers = { ...remoteHeaders, Origin: origin };
  const added = await request('/api/languages', { method: 'POST', headers, body: { name: 'French', nativeName: 'Français', code: 'FR' } });
  assert.equal(added.status, 201);
  assert.ok((await request('/api/bootstrap')).data.languages.some(item => item.id === added.data.id));
  const chat = await request('/api/chats', { method: 'POST', headers, body: { languageId: added.data.id } });
  assert.equal(chat.status, 201);
  const reply = await request(`/api/chats/${chat.data.id}/messages`, { method: 'POST', headers, body: { content: 'Bonjour' } });
  assert.equal(reply.status, 200);
  assert.ok(reply.text.includes('Hallo vanaf de computer.'));
  assert.ok((await request(`/api/chats/${chat.data.id}`)).text.includes('Bonjour'));
});

test('iPad cannot launch loopback OAuth, but local sign-in remains available', async t => {
  const { request, signIns } = await fixture(t);
  for (const [route, method] of [['/api/chatgpt/sign-in', 'POST'], ['/auth/chatgpt/start?ticket=test', 'GET'], ['/auth/callback?state=test', 'GET']]) {
    const result = await request(route, { method, headers: remoteHeaders, ...(method === 'POST' ? { body: {} } : {}) });
    assert.equal(result.status, 403);
    assert.match(result.data.error, /computer running the app/);
  }
  assert.equal(signIns(), 0);
  assert.equal((await request('/api/chatgpt/sign-in', { method: 'POST', body: {} })).status, 200);
  assert.equal(signIns(), 1);
});

test('iPad Settings explain local sign-in and disable only sign-in actions', async t => {
  const vite = await createServer({ server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom' });
  t.after(() => vite.close());
  const { default: Settings } = await vite.ssrLoadModule('/src/Settings.jsx');
  for (const connected of [false, true]) {
    const initial = { provider: 'chatgpt', ollamaUrl: 'http://127.0.0.1:11434', ollamaModel: 'test',
      chatgpt: { connected, sharing: false, signInAvailable: false, activeId: 'account', profiles: [{ id: 'account', label: 'My account' }] } };
    const render = value => renderToStaticMarkup(createElement(Settings, { initial: value, onClose() {}, onSaved() {} }));
    const remote = render(initial);
    assert.match(remote, /computer running this app using its localhost address/);
    const buttons = remote.match(/<button\b[^>]*>.*?<\/button>/g);
    const signInButtons = buttons.filter(button => /Continue with ChatGPT|Enable ChatGPT plan usage|Sign in again|Use another ChatGPT account/.test(button));
    assert.ok(signInButtons.length > 0);
    assert.ok(signInButtons.every(button => button.includes('disabled=""')));
    assert.ok(!buttons.find(button => button.includes('Save settings')).includes('disabled=""'));
    if (connected) assert.ok(!buttons.find(button => button.includes('Sign out')).includes('disabled=""'));
    const local = render({ ...initial, chatgpt: { ...initial.chatgpt, signInAvailable: true } });
    assert.ok(!local.includes('computer running this app using its localhost address'));
    assert.ok(!local.includes('disabled=""'));
  }
});

test('proxy identity is never trusted from a non-loopback socket', () => {
  const policy = createAccessPolicy(access);
  for (const headers of [remoteHeaders, { host: '127.0.0.1:3000' }]) {
    let status;
    policy({ headers: Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])), socket: { remoteAddress: '100.64.0.5' } },
      { status(code) { status = code; return this; }, json() {} }, () => assert.fail('Must not allow direct remote requests'));
    assert.equal(status, 403);
  }
});
