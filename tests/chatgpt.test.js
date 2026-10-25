import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, SignJWT, createLocalJWKSet, exportJWK } from 'jose';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createChatGPT, readCompletedResponse } from '../server/chatgpt.js';
import { createCredentialVault } from '../server/credential-vault.js';
import { createApp } from '../server/app.js';
import { createStore } from '../server/store.js';

const PERMISSION = 'openid email profile offline_access resource.invoke chatgpt.tokens.use.direct';
const keys = await generateKeyPair('RS256');
const jwk = await exportJWK(keys.publicKey);
const jwks = createLocalJWKSet({ keys: [{ ...jwk, kid: 'test', alg: 'RS256' }] });
function json(data, status = 200) { return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } }); }
function stream(events, chunkSize = 17) {
  const bytes = new TextEncoder().encode(events.map(e => `data: ${JSON.stringify(e)}\r\n\r\n`).join(''));
  let index = 0;
  return new Response(new ReadableStream({ pull(controller) { if (index >= bytes.length) controller.close(); else { controller.enqueue(bytes.slice(index, index + chunkSize)); index += chunkSize; } } }), { headers: { 'Content-Type': 'text/event-stream', 'x-request-id': 'req-test' } });
}
const answer = () => stream([{ type: 'response.output_text.delta', delta: 'Merhaba 👋' }, { type: 'response.completed', response: { status: 'completed' } }]);

async function setup(t) {
  let saved = null;
  const vault = { read: async () => structuredClone(saved), write: async value => { saved = structuredClone(value); } };
  const controls = { scope: PERMISSION, subject: 'person-1', badNonce: false, badAudience: false, tokenFailure: null, refreshFailure: null, revokeFailure: false, requestCount: 0, refreshCount: 0, nonce: null, expiresIn: 3600, response: answer };
  let time = Date.now();
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, ...options });
    if (url.endsWith('/oauth/token')) {
      const params = new URLSearchParams(options.body);
      const refresh = params.get('grant_type') === 'refresh_token';
      if (refresh) { controls.refreshCount++; if (controls.refreshFailure) return json({ error: controls.refreshFailure }, 400); }
      if (!refresh && controls.tokenFailure) return json({ error: controls.tokenFailure }, 400);
      const idToken = await new SignJWT({ email: 'test@example.invalid', nonce: controls.badNonce ? 'wrong' : controls.nonce }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).setIssuer('https://auth.openai.com').setAudience(controls.badAudience ? 'wrong-client' : params.get('client_id')).setSubject(controls.subject).setIssuedAt(Math.floor(time / 1000)).setExpirationTime(Math.floor(time / 1000) + 3600).sign(keys.privateKey);
      return json({ access_token: refresh ? `rotated-access-${controls.refreshCount}` : 'private-access-token', refresh_token: refresh ? `rotated-refresh-${controls.refreshCount}` : 'private-refresh-token', id_token: idToken, token_type: 'Bearer', expires_in: controls.expiresIn, scope: controls.scope });
    }
    if (url.endsWith('/models')) return json({ models: [{ slug: 'visible-model', display_name: 'Visible model', visibility: 'list' }, { slug: 'hidden-model', visibility: 'hide' }] });
    if (url.endsWith('/responses')) { controls.requestCount++; return controls.response(); }
    if (url.endsWith('/openid-configuration')) return json({ issuer: 'https://auth.openai.com', revocation_endpoint: 'https://auth.openai.com/revoke' });
    if (url.endsWith('/revoke')) return new Response(null, { status: controls.revokeFailure ? 503 : 200 });
    throw new Error(`Unexpected test URL ${url}`);
  };
  const options = { vault, fetcher, jwks, now: () => time };
  const service = await createChatGPT('unused', options);
  t.after(() => service.close());
  function start(overrides = {}) {
    const { url } = service.begin({ port: 3000, ...overrides });
    const launch = service.launch(new URL(url).searchParams.get('ticket'));
    const auth = new URL(launch.url);
    controls.nonce = auth.searchParams.get('nonce');
    return { launch, auth, query: { state: auth.searchParams.get('state'), code: 'one-time-code', client_id: auth.searchParams.get('client_id') === 'dynamic_agent_client' ? `oaiapp_test_${service.status().profiles.length + 1}` : auth.searchParams.get('client_id') } };
  }
  async function signIn(overrides = {}) { const attempt = start(overrides); await service.callback(attempt.query, attempt.launch.cookie); return attempt; }
  return { service, controls, calls, start, signIn, vault, options, saved: () => saved, advance: ms => { time += ms; } };
}

test('OAuth validates PKCE, state/cookie, JWT identity, single-use callbacks, and token privacy', async t => {
  const f = await setup(t); const attempt = f.start();
  assert.equal(attempt.auth.origin, 'https://auth.openai.com');
  assert.equal(attempt.auth.searchParams.get('client_id'), 'dynamic_agent_client');
  assert.equal(attempt.auth.searchParams.get('agent_name_hint'), 'Mallick Diller');
  assert.equal(attempt.auth.searchParams.get('redirect_uri'), 'http://127.0.0.1:3000/auth/callback');
  assert.equal(attempt.auth.searchParams.get('code_challenge_method'), 'S256');
  await assert.rejects(() => f.service.callback({ ...attempt.query, state: 'wrong' }, attempt.launch.cookie), /could not be verified/);
  await assert.rejects(() => f.service.callback(attempt.query, 'wrong-cookie'), /could not be verified/);
  assert.equal(f.calls.length, 0);
  const status = await f.service.callback(attempt.query, attempt.launch.cookie);
  assert.equal(status.sharing, true); assert.equal(status.needsWelcome, true);
  assert.ok(!JSON.stringify(status).includes('private-access-token'));
  assert.ok(!JSON.stringify(status).includes('private-refresh-token'));
  const exchange = new URLSearchParams(f.calls[0].body);
  assert.equal(exchange.get('client_id'), attempt.query.client_id);
  assert.equal(exchange.get('redirect_uri'), attempt.auth.searchParams.get('redirect_uri'));
  assert.equal(createHash('sha256').update(exchange.get('code_verifier')).digest('base64url'), attempt.auth.searchParams.get('code_challenge'));
  await assert.rejects(() => f.service.callback(attempt.query, attempt.launch.cookie), /could not be verified/);
  const again = f.start();
  assert.equal(again.auth.searchParams.get('client_id'), attempt.query.client_id);
  assert.equal(again.auth.searchParams.get('agent_name_hint'), null);
  assert.ok(again.auth.searchParams.get('id_token_hint'));
  assert.equal(again.auth.searchParams.get('ext_agent_host_id'), attempt.auth.searchParams.get('ext_agent_host_id'));
  await f.service.acknowledgeWelcome();
  const restored = await createChatGPT('unused', f.options); t.after(() => restored.close());
  assert.equal(restored.status().needsWelcome, false); assert.equal(restored.status().email, 'test@example.invalid');
});

test('invalid nonce, audience, mismatched returning identity, and declined permission are rejected', async t => {
  const f = await setup(t);
  f.controls.badNonce = true;
  await assert.rejects(() => f.signIn(), /identity verification failed/);
  assert.equal(f.service.status().connected, false);
  const registered = f.saved().profiles[0].client_id;
  assert.notEqual(registered, 'dynamic_agent_client');
  f.controls.badNonce = false; f.controls.badAudience = true;
  await assert.rejects(() => f.signIn(), /identity verification failed/);
  f.controls.badAudience = false;
  await f.signIn();
  f.controls.subject = 'different-person';
  await assert.rejects(() => f.signIn(), /identity verification failed/);
  assert.equal(f.saved().profiles[0].subject, 'person-1');
  const attempt = f.start(); const calls = f.calls.length;
  await assert.rejects(() => f.service.callback({ ...attempt.query, error: 'access_denied' }, attempt.launch.cookie), /cancelled/);
  assert.equal(f.calls.length, calls);
  const mismatch = f.start();
  await assert.rejects(() => f.service.callback({ ...mismatch.query, client_id: 'oaiapp_wrong' }, mismatch.launch.cookie), /changed unexpectedly/);
  assert.equal(f.calls.length, calls);
});

test('identity-only grants cannot use inference; consent reauthorization is explicit', async t => {
  const f = await setup(t); f.controls.scope = 'openid profile email';
  await f.signIn();
  assert.equal(f.service.status().connected, true); assert.equal(f.service.status().sharing, false);
  await assert.rejects(() => f.service.respond({ messages: [], instructions: '' }), /not enabled/);
  assert.equal(f.controls.requestCount, 0);
  assert.equal(f.start().auth.searchParams.get('prompt'), null);
  assert.equal(f.start({ enablePlan: true }).auth.searchParams.get('prompt'), 'consent');
});

test('account model discovery and streamed plan requests never use API-key fields or partial answers', async t => {
  const f = await setup(t); await f.signIn();
  assert.deepEqual(await f.service.listModels(), [{ slug: 'visible-model', displayName: 'Visible model' }]);
  assert.equal(await f.service.respond({ instructions: 'Tutor', messages: [{ role: 'user', content: 'Hello' }] }), 'Merhaba 👋');
  const call = f.calls.find(c => c.url.endsWith('/responses')); const body = JSON.parse(call.body);
  assert.equal(call.headers.Authorization, 'Bearer private-access-token');
  assert.deepEqual(body, { model: 'visible-model', instructions: 'Tutor', input: [{ role: 'user', content: 'Hello' }], store: false, stream: true });
  await assert.rejects(() => f.service.respond({ model: 'hidden-model', messages: [], instructions: '' }), /Choose a model/);
  f.controls.response = () => stream([{ type: 'response.output_text.delta', delta: 'Do not save this' }, { type: 'response.failed', response: { error: { code: 'subscription_sharing_usage_limit_exceeded' } } }]);
  await assert.rejects(() => f.service.respond({ messages: [], instructions: '' }), error => error.status === 429 && error.code === 'subscription_sharing_usage_limit_exceeded');
  assert.equal(f.service.status().usageBlocked, true); const count = f.controls.requestCount;
  await assert.rejects(() => f.service.respond({ messages: [], instructions: '' }), /paused/);
  assert.equal(f.controls.requestCount, count);
  f.service.resume(); f.controls.response = answer;
  assert.equal(await f.service.respond({ messages: [], instructions: '' }), 'Merhaba 👋');
});

test('refresh rotation is serialized and terminal revocation retains the registration', async t => {
  const f = await setup(t); await f.signIn(); f.advance(3550000);
  await Promise.all([f.service.listModels(), f.service.listModels()]);
  assert.equal(f.controls.refreshCount, 1);
  assert.equal(f.saved().profiles[0].refresh_token, 'rotated-refresh-1');
  const params = new URLSearchParams(f.calls.find(c => c.url.endsWith('/oauth/token') && c.body.includes('refresh_token')).body);
  assert.equal(params.get('scope'), null);
  assert.equal(params.get('client_id'), 'oaiapp_test_1');
  f.advance(3550000); f.controls.refreshFailure = 'invalid_grant';
  await assert.rejects(() => f.service.listModels(), /session ended/);
  assert.equal(f.service.status().connected, false);
  assert.equal(f.saved().profiles[0].refresh_token, undefined);
  assert.equal(f.saved().profiles[0].client_id, 'oaiapp_test_1');
});

test('account switching stays separate and sign-out clears tokens even when revocation fails', async t => {
  const f = await setup(t); const first = await f.signIn(); const firstId = f.service.status().activeId;
  f.controls.subject = 'person-2'; await f.signIn({ newProfile: true });
  assert.equal(f.service.status().profiles.length, 2);
  assert.equal(f.service.status().email, 'test@example.invalid'); // Same email does not merge registrations.
  await f.service.select(firstId); assert.equal(f.service.status().activeId, firstId);
  f.controls.revokeFailure = true;
  const result = await f.service.signOut();
  assert.match(result.warning, /Remote revocation/);
  assert.equal(result.connected, false);
  const returning = f.start();
  assert.equal(returning.auth.searchParams.get('client_id'), first.query.client_id);
  assert.equal(returning.auth.searchParams.get('id_token_hint'), null);
  assert.equal(f.saved().profiles[1].access_token, 'private-access-token');
});

test('SSE parsing handles fragmented Unicode, incomplete output, and interrupted streams', async () => {
  assert.equal(await readCompletedResponse(answer()), 'Merhaba 👋');
  await assert.rejects(() => readCompletedResponse(stream([{ type: 'response.output_text.delta', delta: 'partial' }])), /before the answer completed/);
  await assert.rejects(() => readCompletedResponse(stream([{ type: 'response.incomplete' }])), /did not finish/);
  await assert.rejects(() => readCompletedResponse(stream([{ type: 'response.completed', response: { status: 'completed' } }])), /no text/);
  await assert.rejects(() => readCompletedResponse(stream([{ type: 'error', code: 'subscription_sharing_usage_unavailable' }])), error => error.status === 503);
});

test('Windows credential storage protects saved tokens and restores them', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'lingua-auth-test-'));
  t.after(async () => { assert.equal(path.dirname(directory), path.resolve(tmpdir())); assert.ok(path.basename(directory).startsWith('lingua-auth-test-')); await rm(directory, { recursive: true, force: true }); });
  const vault = await createCredentialVault(directory);
  const fixture = { hostId: 'test-host', access_token: 'test-only-private-token' };
  await vault.write(fixture); assert.deepEqual(await vault.read(), fixture);
  if (process.platform === 'win32') {
    const contents = await readFile(path.join(directory, 'chatgpt', 'connections.dpapi'), 'utf8');
    assert.ok(!contents.includes(fixture.access_token));
  }
});

test('HTTP sign-in redirects use a loopback callback, accept OAuth navigation, and never expose tokens', async t => {
  const f = await setup(t);
  const directory = await mkdtemp(path.join(tmpdir(), 'lingua-auth-test-'));
  const store = createStore(directory); const server = createApp(store, undefined, f.service).listen(0, '127.0.0.1');
  await once(server, 'listening'); const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); store.db.close(); assert.equal(path.dirname(directory), path.resolve(tmpdir())); assert.ok(path.basename(directory).startsWith('lingua-auth-test-')); await rm(directory, { recursive: true, force: true }); });
  const begin = await fetch(`${base}/api/chatgpt/sign-in`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  const { url } = await begin.json(); assert.ok(url.startsWith(`${base}/auth/chatgpt/start?ticket=`));
  assert.ok(!url.includes('id_token'));
  const launch = await fetch(url, { redirect: 'manual' }); assert.equal(launch.status, 302);
  const auth = new URL(launch.headers.get('location'));
  const cookie = launch.headers.get('set-cookie').split(';')[0]; assert.match(launch.headers.get('set-cookie'), /HttpOnly/i); assert.match(launch.headers.get('set-cookie'), /SameSite=Lax/i);
  f.controls.nonce = auth.searchParams.get('nonce');
  const callback = new URL(auth.searchParams.get('redirect_uri')); callback.search = new URLSearchParams({ code: 'code', client_id: 'oaiapp_http', state: auth.searchParams.get('state') });
  const result = await fetch(callback, { redirect: 'manual', headers: { Cookie: cookie, 'Sec-Fetch-Site': 'cross-site' } });
  assert.equal(result.status, 303); assert.equal(result.headers.get('location'), '/?settings=1');
  const bootstrap = await (await fetch(`${base}/api/bootstrap`)).json();
  assert.equal(bootstrap.settings.chatgpt.sharing, true);
  assert.ok(!JSON.stringify(bootstrap).includes('private-access-token'));
  assert.equal((await fetch(`${base}/api/chatgpt/models`, { headers: { Origin: 'https://untrusted.example' } })).status, 403);
});
