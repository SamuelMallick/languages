import { useEffect, useState } from 'react';
import { Check, LogOut, RefreshCw } from 'lucide-react';
import { api, ErrorNotice, ExternalLink, Modal } from './ui.jsx';

const USAGE_URL = 'https://chatgpt.com/settings/usage';

export default function Settings({ initial, onClose, onSaved }) {
  const [form, setForm] = useState({ ...initial, ankiKey: '' });
  const [models, setModels] = useState([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelError, setModelError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const connection = form.chatgpt || { profiles: [] };
  const set = (key, value) => { setForm(previous => ({ ...previous, [key]: value })); setSaved(false); };

  async function loadModels(isCurrent = () => true) {
    setModelsLoading(true); setModelError('');
    try {
      const catalog = await api('/chatgpt/models');
      if (isCurrent()) { setModels(catalog); }
    } catch (e) { if (isCurrent()) setModelError(e.message); }
    finally { if (isCurrent()) setModelsLoading(false); }
  }
  useEffect(() => {
    let current = true; setModels([]); setModelError('');
    if (form.provider === 'chatgpt' && connection.sharing) loadModels(() => current);
    return () => { current = false; };
  }, [form.provider, connection.activeId, connection.sharing]);

  async function updateConnection(route, body = {}) {
    setBusy(true); setError(''); setNotice('');
    try {
      const next = await api(`/chatgpt/${route}`, { method: 'POST', body });
      setForm(previous => ({ ...previous, ...next, ankiKey: previous.ankiKey }));
      if (next.warning) setNotice(next.warning);
      await onSaved();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  async function signIn(options = {}) {
    setBusy(true); setError('');
    try {
      const { url } = await api('/chatgpt/sign-in', { method: 'POST', body: options });
      // The server returns only a one-time local launch URL, never OAuth tokens
      // or an authorization URL containing retained identity-token hints.
      window.location.assign(url);
    } catch (e) { setError(e.message); setBusy(false); }
  }
  async function submit(e) {
    e.preventDefault(); setBusy(true); setError(''); setSaved(false);
    try {
      const next = await api('/settings', { method: 'PUT', body: {
        provider: form.provider, chatgptModel: form.chatgptModel || '',
        ollamaModel: form.ollamaModel, ollamaUrl: form.ollamaUrl,
        ankiKey: form.ankiKey, clearAnkiKey: Boolean(form.clearAnkiKey),
      } });
      setForm({ ...next, ankiKey: '' }); await onSaved(); setSaved(true);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  return <Modal title="Settings" onClose={onClose}>
    <form onSubmit={submit}>
      <div className="settings-heading"><h3>Tutor</h3></div>
      <label>Provider
        <select value={form.provider} onChange={e => set('provider', e.target.value)} disabled={busy}>
          <option value="chatgpt">ChatGPT · use your existing plan</option>
          <option value="ollama">Ollama · local model</option>
        </select>
      </label>

      {form.provider === 'chatgpt' ? <>
        <div className="chatgpt-connection">
          <div className="chatgpt-connection-title"><div><strong>ChatGPT account</strong></div></div>
          {connection.profiles.length > 0 && <label>Saved connection
            <select value={connection.activeId || ''} disabled={busy} onChange={e => updateConnection('select', { profileId: e.target.value })}>
              {!connection.activeId && <option value="" disabled>Choose a saved connection</option>}
              {connection.profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.label}{profile.email ? ` · ${profile.email}` : ' · sign-in needed'}</option>)}
            </select>
          </label>}
          {connection.connected ? <>
            <p className="connection-identity">{connection.email || connection.name || connection.label}</p>
            <div className={`notice ${connection.sharing ? 'success' : ''}`}><Check size={17} /><span>{connection.sharing ? 'ChatGPT plan usage is enabled.' : 'Signed in. Permission to use your ChatGPT plan is not enabled yet.'}</span></div>
            {!connection.sharing && <button className="button chatgpt-button full" type="button" disabled={busy} onClick={() => signIn({ profileId: connection.activeId, enablePlan: true })}>Enable ChatGPT plan usage</button>}
            <div className="connection-actions">
              <button className="text-button" type="button" disabled={busy} onClick={() => signIn({ profileId: connection.activeId })}>Sign in again</button>
              <button className="text-button" type="button" disabled={busy} onClick={() => updateConnection('sign-out', { profileId: connection.activeId })}><LogOut size={14} />Sign out</button>
            </div>
          </> : <button className="button chatgpt-button full" type="button" disabled={busy} onClick={() => signIn(connection.activeId ? { profileId: connection.activeId } : {})}>{busy ? 'Opening ChatGPT…' : 'Continue with ChatGPT'}</button>}
          {connection.profiles.length > 0 && <button className="text-button add-account" type="button" disabled={busy} onClick={() => signIn({ newProfile: true })}>Use another ChatGPT account or workspace</button>}
        </div>

        {connection.needsWelcome && <div className="chatgpt-welcome" role="status">
          <h3>You’re using your ChatGPT plan</h3>
          <p>Eligible tutor requests use your ChatGPT plan. Review Mallick Diller’s usage and credit permissions in ChatGPT settings.</p>
          <div><ExternalLink href={USAGE_URL}>Manage usage</ExternalLink><button type="button" className="button secondary small-button" disabled={busy} onClick={() => updateConnection('welcome')}>Got it</button></div>
        </div>}
        {connection.usageBlocked && <div className="notice"><span><strong>ChatGPT usage is paused.</strong><br />Review the applicable limit before trying again.<div className="usage-limit-actions"><ExternalLink href={USAGE_URL}>Manage usage</ExternalLink><button type="button" className="text-button" disabled={busy} onClick={() => updateConnection('resume')}>I’ve checked my limits — allow retry</button></div></span></div>}
        {connection.sharing && <>
          <label>ChatGPT model
            <select value={form.chatgptModel || ''} disabled={busy || modelsLoading} onChange={e => set('chatgptModel', e.target.value)}>
              <option value="">{models[0] ? `Account default · ${models[0].displayName}` : 'Account default'}</option>
              {form.chatgptModel && !models.some(m => m.slug === form.chatgptModel) && <option value={form.chatgptModel}>{form.chatgptModel} · refresh availability</option>}
              {models.map(model => <option value={model.slug} key={model.slug}>{model.displayName}</option>)}
            </select>
          </label>
          {modelsLoading && <p className="small muted" role="status">Loading the models available to your account…</p>}
          <ErrorNotice error={modelError} />
          <button className="text-button" type="button" disabled={modelsLoading || busy} onClick={() => loadModels()}><RefreshCw size={13} />Refresh available models</button>
        </>}
        <p className="small muted provider-note">Mallick Diller uses your ChatGPT plan and never falls back to API-key billing. ChatGPT manages plan limits and any credit permissions; review Mallick Diller’s access there if you want to use only your subscription. <ExternalLink href={USAGE_URL}>Manage usage</ExternalLink></p>
        <p className="small muted">Chat messages and the selected reference text are sent to OpenAI. Your ChatGPT connection stays on this computer and is protected with Windows encryption on Windows.</p>
      </> : <>
        <label>Ollama address<input required value={form.ollamaUrl} onChange={e => set('ollamaUrl', e.target.value)} /></label>
        <label>Installed model<input required value={form.ollamaModel} onChange={e => set('ollamaModel', e.target.value)} placeholder="llama3.2" /></label>
        <p className="small muted">Start Ollama and pull the model before chatting. Tutor requests stay on this computer. <ExternalLink href="https://ollama.com">Get Ollama</ExternalLink></p>
      </>}

      <div className="settings-heading divided"><h3>AnkiConnect</h3></div>
      <p className="small muted">Connects to Anki at 127.0.0.1:8765. Keep the desktop app open.</p>
      <label>AnkiConnect API key (optional)<input type="password" autoComplete="new-password" value={form.ankiKey} onChange={e => set('ankiKey', e.target.value)} placeholder={form.hasAnkiKey ? 'Key saved · leave blank to keep it' : 'Only if enabled in AnkiConnect'} /></label>
      {form.hasAnkiKey && <label className="checkbox-label"><input type="checkbox" checked={Boolean(form.clearAnkiKey)} onChange={e => set('clearAnkiKey', e.target.checked)} />Remove saved AnkiConnect key</label>}
      <p className="small muted">The optional AnkiConnect key is unrelated to AI billing. It is stored in the local database without encryption; you can instead configure ANKI_CONNECT_KEY in .env.</p>
      <ErrorNotice error={error} />
      {notice && <div className="notice" role="status">{notice}</div>}
      {saved && <p className="small muted" role="status">Settings saved.</p>}
      <button className="button primary full" disabled={busy}>{busy ? 'Please wait…' : 'Save settings'}<Check size={17} /></button>
    </form>
  </Modal>;
}
