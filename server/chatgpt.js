import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { AppError } from './integrations.js';
import { createCredentialVault } from './credential-vault.js';

const ISSUER = 'https://auth.openai.com';
const AUTHORIZE = `${ISSUER}/api/accounts/authorize`;
const TOKEN = `${ISSUER}/api/accounts/oauth/token`;
const RESOURCE = 'https://api.openai.com/v1';
const PERMISSION = 'chatgpt.tokens.use.direct';
const SCOPE = `openid profile email offline_access resource.invoke ${PERMISSION}`;
const REVOKED = new Set(['invalid_grant', 'invalid_refresh_token', 'token_expired', 'refresh_token_expired', 'refresh_token_invalidated', 'refresh_token_reused']);
export const USAGE_URL = 'https://chatgpt.com/settings/usage';
const random = () => randomBytes(32).toString('base64url');
function equal(a, b) { return typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b)); }
function failure(status, message, code, requestId) { const error = new AppError(status, message); error.code = code; error.requestId = requestId; return error; }
function clearTokens(profile) { for (const key of ['access_token', 'refresh_token', 'id_token', 'expires_at']) delete profile[key]; profile.scopes = []; }

const errorMessages = {
  subscription_sharing_usage_limit_exceeded: 'ChatGPT plan usage is paused because a usage limit was reached. Review your plan and Mallick Diller’s limits in Manage usage before resuming.',
  subscription_sharing_usage_unavailable: 'ChatGPT could not check usage availability. Try again later; no other billing method will be used.',
  subscription_sharing_user_not_eligible: 'ChatGPT plan usage is unavailable for this account or workspace. Check your account’s eligibility and permissions.',
  subscription_sharing_unsupported_capability: 'The selected model or request feature is not supported by ChatGPT plan usage. Try another available model.',
  subscription_sharing_route_not_supported: 'ChatGPT did not accept this plan-usage route. No API-key fallback was attempted.',
  subscription_sharing_invalid_user: 'ChatGPT could not validate this connection. Sign in again in Settings.',
  chatpass_v2_scope_not_authorized: 'This ChatGPT connection is not authorized to use the plan. Enable plan usage in Settings.',
  chatpass_v2_invalid_authorization_context: 'ChatGPT did not accept this connection’s permissions. Sign in again in Settings.',
  subscription_sharing_user_unavailable: 'Your ChatGPT account or workspace is temporarily unavailable. Please try again later.',
};

export function providerError(status, data, requestId) {
  const code = typeof data?.error === 'string' ? data.error : data?.error?.code || data?.code;
  const diagnostic = typeof data?.detail === 'string' ? data.detail : data?.error?.message;
  const message = errorMessages[code] || (status === 401 ? 'Your ChatGPT connection was not accepted. Sign in again in Settings.' : status === 403 ? 'ChatGPT plan usage was denied by an account, workspace, or regional policy.' : status === 429 ? 'ChatGPT reached a usage limit. Check Manage usage before trying again.' : status === 503 ? 'ChatGPT plan usage is temporarily unavailable. Try again later.' : `ChatGPT request failed (${status}).${diagnostic ? ` ${diagnostic.slice(0, 400)}` : ' Please try again or check your connection.'}`);
  return failure(status, message, code || 'chatgpt_request_failed', requestId);
}

// No partial answer is committed: late limit/errors are authoritative even
// after text deltas. Only response.completed makes the request successful.
export async function readCompletedResponse(response) {
  if (!response.body) throw failure(502, 'ChatGPT returned an empty response stream.', 'stream_interrupted');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = ''; let text = ''; let completed = false;
  const requestId = response.headers.get('x-request-id') || response.headers.get('openai-request-id');
  function event(block) {
    const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!data || data === '[DONE]') return;
    let value;
    try { value = JSON.parse(data); } catch { throw failure(502, 'ChatGPT returned an invalid response event.', 'stream_invalid'); }
    if (value.type === 'response.output_text.delta') text += value.delta || '';
    if (value.type === 'response.failed' || value.type === 'error') {
      const detail = value.response?.error || value.error || value;
      const code = detail.code;
      const status = code === 'subscription_sharing_usage_limit_exceeded' ? 429 : code === 'subscription_sharing_usage_unavailable' ? 503 : 502;
      throw providerError(status, { error: detail }, requestId);
    }
    if (value.type === 'response.incomplete') throw failure(502, 'ChatGPT did not finish its answer. Try a shorter question.', 'response_incomplete', requestId);
    if (value.type === 'response.completed') {
      if (value.response?.status && value.response.status !== 'completed') throw failure(502, 'ChatGPT did not complete this request.', 'response_incomplete', requestId);
      const finalText = value.response?.output?.filter(item => item.type === 'message').flatMap(item => item.content || []).filter(item => item.type === 'output_text').map(item => item.text).join('\n');
      if (finalText) text = finalText;
      completed = true;
    }
  }
  try {
    while (!completed) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      // Normalize CRLF after concatenation, including CR/LF split across chunks.
      buffer = buffer.replace(/\r\n/g, '\n');
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) { event(buffer.slice(0, boundary)); buffer = buffer.slice(boundary + 2); if (completed) break; }
      if (buffer.length > 4_000_000 || text.length > 1_000_000) throw failure(502, 'ChatGPT’s response was too large.', 'response_too_large');
      if (done) { if (buffer.trim() && !completed) event(buffer); break; }
    }
    if (!completed) throw failure(502, 'The ChatGPT stream ended before the answer completed. Your message has not been saved; please retry.', 'stream_interrupted', requestId);
    if (!text.trim()) throw failure(502, 'ChatGPT returned no text. Try another question or model.', 'response_empty', requestId);
    return text;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export async function createChatGPT(directory, options = {}) {
  const fetcher = options.fetcher || fetch;
  const now = options.now || Date.now;
  const vault = options.vault || await createCredentialVault(directory);
  let state = await vault.read() || { hostId: `urn:uuid:${randomUUID()}`, activeId: null, profiles: [], welcomed: false };
  await vault.write(state);
  const jwks = options.jwks || createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks.json`));
  const transactions = new Map(); const tickets = new Map(); const models = new Map(); const blocked = new Set(); const running = new Set();
  let queue = Promise.resolve(); let epoch = 0;
  const serial = fn => { const result = queue.then(fn, fn); queue = result.catch(() => {}); return result; };
  const persist = () => vault.write(state);
  const active = () => state.profiles.find(p => p.id === state.activeId);
  function abortRunning() { epoch++; for (const controller of running) controller.abort(); running.clear(); }
  function profileView(p) { return { id: p.id, label: p.label, email: p.email || '', name: p.name || '', connected: Boolean(p.access_token), sharing: Boolean(p.access_token && p.scopes?.includes(PERMISSION)), usageBlocked: blocked.has(p.id) }; }
  function status() { const profile = active(); return { ...(profile ? profileView(profile) : { connected: false, sharing: false, usageBlocked: false }), activeId: state.activeId, profiles: state.profiles.map(profileView), needsWelcome: !state.welcomed && Boolean(profile?.access_token && profile.scopes?.includes(PERMISSION)), usageUrl: USAGE_URL }; }
  async function request(url, init = {}) {
    try { return await fetcher(url, { ...init, redirect: 'error', signal: init.signal || AbortSignal.timeout(20000) }); }
    catch { throw failure(503, 'Could not reach ChatGPT. Check your connection and try again.', 'chatgpt_unreachable'); }
  }
  async function tokenRequest(params) {
    const response = await request(TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params).toString() });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw providerError(response.status, data, response.headers.get('x-request-id'));
    if (data.token_type?.toLowerCase() !== 'bearer' || !data.access_token || !Number.isFinite(data.expires_in) || data.expires_in <= 0) throw failure(502, 'ChatGPT returned an incomplete token response. Please sign in again.', 'invalid_token_response');
    return data;
  }
  async function verifyIdentity(token, clientId, nonce, expectedSubject) {
    try {
      const { payload } = await jwtVerify(token, jwks, { issuer: ISSUER, audience: clientId, requiredClaims: ['sub', 'exp', 'iat'], clockTolerance: 5, currentDate: new Date(now()) });
      if ((nonce && !equal(payload.nonce, nonce)) || typeof payload.sub !== 'string' || !payload.sub || (expectedSubject && payload.sub !== expectedSubject)) throw new Error('Invalid identity');
      return payload;
    } catch { throw failure(400, 'ChatGPT identity verification failed. Sign in again with the original account.', 'invalid_identity'); }
  }
  function updateTokens(profile, tokens, previousScopes = []) {
    const scopes = typeof tokens.scope === 'string' ? tokens.scope.split(/\s+/).filter(Boolean) : previousScopes;
    Object.assign(profile, { access_token: tokens.access_token, refresh_token: tokens.refresh_token || profile.refresh_token, id_token: tokens.id_token || profile.id_token, scopes, expires_at: now() + tokens.expires_in * 1000 });
  }
  async function credentials() {
    return serial(async () => {
      const profile = active();
      if (!profile?.access_token) throw failure(401, 'Connect your ChatGPT account in Settings to use your plan.', 'sign_in_required');
      if (profile.expires_at <= now() + 60000) {
        if (!profile.refresh_token) throw failure(401, 'Your ChatGPT connection expired. Sign in again in Settings.', 'sign_in_required');
        try {
          const tokens = await tokenRequest({ grant_type: 'refresh_token', client_id: profile.client_id, refresh_token: profile.refresh_token, resource: RESOURCE });
          if (tokens.id_token) await verifyIdentity(tokens.id_token, profile.client_id, null, profile.subject);
          updateTokens(profile, tokens, profile.scopes); await persist();
        } catch (error) {
          if (REVOKED.has(error.code)) { clearTokens(profile); models.delete(profile.id); await persist(); throw failure(401, 'Your ChatGPT session ended. Sign in again in Settings.', 'sign_in_required'); }
          throw error;
        }
      }
      if (!profile.scopes.includes(PERMISSION)) throw failure(403, 'You are signed in, but ChatGPT plan usage is not enabled. Enable it in Settings.', 'plan_permission_required');
      return { id: profile.id, token: profile.access_token, epoch };
    });
  }

  function begin({ profileId, newProfile = false, enablePlan = false, port }) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw failure(400, 'Invalid local callback port.');
    for (const [key, value] of tickets) if (value.expires < now()) tickets.delete(key);
    for (const [key, value] of transactions) if (value.expires < now()) transactions.delete(key);
    if (tickets.size + transactions.size >= 10) throw failure(429, 'Too many sign-in attempts. Wait a few minutes and try again.');
    const profile = newProfile ? undefined : state.profiles.find(p => p.id === (profileId || state.activeId)) || (!state.activeId && !profileId ? state.profiles.at(-1) : undefined);
    if (profileId && !profile) throw failure(404, 'ChatGPT connection not found.');
    const ticket = random();
    tickets.set(ticket, { profileId: profile?.id, enablePlan, port, expires: now() + 60000 });
    return { url: `http://127.0.0.1:${port}/auth/chatgpt/start?ticket=${ticket}` };
  }
  function launch(ticket) {
    const intent = tickets.get(ticket); tickets.delete(ticket);
    if (!intent || intent.expires < now()) throw failure(400, 'This sign-in link expired. Return to Settings and try again.');
    const profile = state.profiles.find(p => p.id === intent.profileId);
    const oauthState = random(); const verifier = random(); const nonce = random(); const cookie = random();
    const redirectUri = `http://127.0.0.1:${intent.port}/auth/callback`;
    transactions.set(oauthState, { cookie, verifier, nonce, redirectUri, profileId: profile?.id, clientId: profile?.client_id, expires: now() + 10 * 60000 });
    const params = new URLSearchParams({ client_id: profile?.client_id || 'dynamic_agent_client', ext_agent_host_id: state.hostId, response_type: 'code', redirect_uri: redirectUri, scope: SCOPE, resource: RESOURCE, state: oauthState, nonce, code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url') });
    if (!profile) params.set('agent_name_hint', 'Mallick Diller');
    else {
      if (profile.id_token) params.set('id_token_hint', profile.id_token);
      if (profile.email) params.set('login_hint', profile.email);
    }
    if (intent.enablePlan) params.set('prompt', 'consent');
    return { url: `${AUTHORIZE}?${params}`, cookie, cookieName: `lingua_oauth_${oauthState}`, maxAge: 600 };
  }
  async function callback(query, cookie) {
    const tx = transactions.get(query.state);
    if (!tx || tx.expires < now() || !equal(cookie, tx.cookie)) throw failure(400, 'This sign-in could not be verified or has expired. Return to Settings and try again.', 'invalid_oauth_state');
    transactions.delete(query.state);
    return serial(async () => {
      if (query.error) throw failure(400, query.error === 'access_denied' ? 'ChatGPT sign-in was cancelled. You can try again from Settings.' : 'ChatGPT sign-in did not finish. Please try again.', 'oauth_declined');
      const clientId = query.client_id || tx.clientId;
      if (!query.code || !clientId || clientId === 'dynamic_agent_client' || (tx.clientId && clientId !== tx.clientId) || clientId.length > 200) throw failure(400, 'ChatGPT registration was incomplete or changed unexpectedly. Please sign in again.', 'invalid_registration');
      let profile = state.profiles.find(p => p.id === tx.profileId);
      if (!profile) {
        profile = { id: randomUUID(), label: `Connection ${state.profiles.length + 1}`, client_id: clientId, scopes: [] };
        state.profiles.push(profile); await persist(); // Retain issued registration even if code exchange fails.
      }
      const tokens = await tokenRequest({ grant_type: 'authorization_code', client_id: clientId, code: query.code, code_verifier: tx.verifier, redirect_uri: tx.redirectUri, resource: RESOURCE });
      const identity = await verifyIdentity(tokens.id_token, clientId, tx.nonce, profile.subject);
      const candidate = { ...profile, issuer: identity.iss, subject: identity.sub, email: identity.email, name: identity.name };
      updateTokens(candidate, tokens);
      state.profiles = state.profiles.map(p => p.id === profile.id ? candidate : p);
      state.activeId = candidate.id; abortRunning(); models.delete(candidate.id); blocked.delete(candidate.id);
      await persist(); return status();
    });
  }
  async function listModels() {
    const connection = await credentials();
    const response = await request(`${RESOURCE}/models`, { headers: { Authorization: `Bearer ${connection.token}` } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw providerError(response.status, data, response.headers.get('x-request-id'));
    if (connection.epoch !== epoch) throw failure(409, 'Your ChatGPT account changed. Refresh the model list.');
    const catalog = (data.models || []).filter(m => m.visibility === 'list' && typeof m.slug === 'string').map(m => ({ slug: m.slug, displayName: m.display_name || m.slug }));
    if (!catalog.length) throw failure(403, 'No models are currently available for this ChatGPT connection.', 'models_unavailable');
    models.set(connection.id, catalog); return catalog;
  }
  async function respond({ model, instructions, messages }) {
    const connection = await credentials();
    if (blocked.has(connection.id)) throw providerError(429, { error: { code: 'subscription_sharing_usage_limit_exceeded' } });
    const catalog = models.get(connection.id) || await listModels();
    if (connection.epoch !== epoch) throw failure(409, 'Your ChatGPT account changed. Please send your message again.');
    const chosen = model || catalog[0].slug;
    if (!catalog.some(m => m.slug === chosen)) throw failure(400, 'Choose a model available to your ChatGPT account in Settings.', 'model_unavailable');
    const controller = new AbortController(); running.add(controller);
    try {
      const response = await request(`${RESOURCE}/responses`, { method: 'POST', headers: { Authorization: `Bearer ${connection.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: chosen, instructions, input: messages, store: false, stream: true }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(180000)]) });
      if (!response.ok) throw providerError(response.status, await response.json().catch(() => ({})), response.headers.get('x-request-id'));
      const text = await readCompletedResponse(response);
      if (connection.epoch !== epoch) throw failure(409, 'The ChatGPT account changed before this answer finished. Please retry.');
      return text;
    } catch (error) {
      if (error.status === 429 || error.code === 'subscription_sharing_usage_limit_exceeded') blocked.add(connection.id);
      if (error.name === 'AbortError' || error.name === 'TimeoutError') throw failure(503, 'The ChatGPT request was cancelled or timed out. Please retry.', 'request_interrupted');
      throw error;
    } finally { running.delete(controller); }
  }
  async function select(profileId) { return serial(async () => { if (!state.profiles.some(p => p.id === profileId)) throw failure(404, 'ChatGPT connection not found.'); abortRunning(); state.activeId = profileId; models.clear(); await persist(); return status(); }); }
  async function signOut(profileId = state.activeId) {
    return serial(async () => {
      const profile = state.profiles.find(p => p.id === profileId);
      if (!profile) throw failure(404, 'ChatGPT connection not found.');
      abortRunning(); let revoked = !profile.refresh_token;
      try {
        if (profile.refresh_token) {
          const discovery = await request(`${ISSUER}/.well-known/openid-configuration`);
          if (!discovery.ok) throw new Error('Discovery failed');
          const config = await discovery.json(); const endpoint = new URL(config.revocation_endpoint);
          if (endpoint.origin !== ISSUER || config.issuer !== ISSUER) throw new Error('Invalid revocation endpoint');
          const response = await request(endpoint.href, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: profile.refresh_token, token_type_hint: 'refresh_token', client_id: profile.client_id }).toString() });
          revoked = response.status === 200;
        }
      } catch { /* Clear locally even if remote revocation cannot be confirmed. */ }
      clearTokens(profile); models.delete(profile.id); blocked.delete(profile.id); await persist();
      return { ...status(), warning: revoked ? null : 'Signed out locally. Remote revocation could not be confirmed; disconnect Mallick Diller in ChatGPT settings.' };
    });
  }
  return {
    status, begin, launch, callback, listModels, respond, select, signOut,
    async acknowledgeWelcome() { return serial(async () => { state.welcomed = true; await persist(); return status(); }); },
    resume() { if (state.activeId) blocked.delete(state.activeId); return status(); },
    close() { abortRunning(); transactions.clear(); tickets.clear(); },
  };
}
