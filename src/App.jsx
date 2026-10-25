import { useEffect, useState } from 'react';
import { ArrowRight, BookOpen, Check, ChevronDown, CircleHelp, House, Layers3, MessageCircle, Plus, Settings2 } from 'lucide-react';
import { api, Busy, ErrorNotice, Modal } from './ui.jsx';
import Vocabulary from './Vocabulary.jsx';
import Grammar from './Grammar.jsx';
import Practice from './Practice.jsx';
import Settings from './Settings.jsx';
import { TutorContext } from './tutor-context.js';

const navItems = [{ id: 'overview', label: 'Overview', icon: House }, { id: 'vocabulary', label: 'Vocabulary', icon: Layers3 }, { id: 'grammar', label: 'Grammar', icon: BookOpen }, { id: 'practice', label: 'Practice', icon: MessageCircle }];

export default function App() {
  const [data, setData] = useState(null);
  const [languageId, setLanguageId] = useState(() => localStorage.getItem('lingua-language') || '');
  const [page, setPage] = useState('overview');
  const [error, setError] = useState('');
  const [modal, setModal] = useState(() => new URLSearchParams(location.search).has('settings') ? 'settings' : '');
  const [switcher, setSwitcher] = useState(false);
  async function refresh() { const next = await api('/bootstrap'); setData(next); return next; }
  useEffect(() => { refresh().catch(e => setError(e.message)); }, []);
  useEffect(() => { const url = new URL(location.href); if (url.searchParams.has('settings')) { url.searchParams.delete('settings'); history.replaceState(null, '', url); } }, []);
  const language = data?.languages.find(l => l.id === languageId);
  function chooseLanguage(value) { setLanguageId(value); localStorage.setItem('lingua-language', value); setPage('overview'); setSwitcher(false); }
  function go(value) { setPage(value); setError(''); }
  const tutorReady = data?.settings.provider === 'ollama' || Boolean(data?.settings.chatgpt?.sharing && !data?.settings.chatgpt?.usageBlocked);

  return <TutorContext.Provider value={{ settings: data?.settings, refresh }}><div className="app-shell">
    <aside className="sidebar">
      <button className="brand" onClick={() => chooseLanguage('')} aria-label="Mallick Diller home">Mallick Diller</button>
      <div className="language-switcher">
        <button className="language-current" onClick={() => setSwitcher(!switcher)} aria-expanded={switcher}>
          <span>{language?.name || 'Languages'}</span><ChevronDown size={15} />
        </button>
        {switcher && <div className="switcher-menu"><button onClick={() => chooseLanguage('')}>All languages</button>{data?.languages.map(l => <button key={l.id} onClick={() => chooseLanguage(l.id)}>{l.name}{languageId === l.id && <Check size={15} />}</button>)}<button onClick={() => { setModal('language'); setSwitcher(false); }}><Plus size={16} />Add a language</button></div>}
      </div>
      <nav aria-label="Workspace navigation">
        {navItems.map(({ id, label, icon: Icon }) => <button key={id} className={`nav-item ${page === id ? 'active' : ''}`} aria-current={page === id ? 'page' : undefined} disabled={!language && id !== 'overview'} onClick={() => go(id)}><Icon size={20} strokeWidth={1.7} />{label}</button>)}
      </nav>
      <div className="sidebar-bottom"><button className="nav-item" onClick={() => setModal('settings')}><Settings2 size={19} />Settings</button><button className="nav-item" onClick={() => setModal('help')}><CircleHelp size={19} />Help</button></div>
    </aside>
    <div className="main-shell">
      <main><ErrorNotice error={error} onClose={() => setError('')} />{!data ? <Busy /> : !language ? <LanguageHome languages={data.languages} onSelect={chooseLanguage} onAdd={() => setModal('language')} /> : <>
        {page === 'overview' && <Overview language={language} onNavigate={go} onSettings={() => setModal('settings')} tutorReady={tutorReady} />}
        {page === 'vocabulary' && <Vocabulary key={language.id} language={language} onChange={refresh} />}
        {page === 'grammar' && <Grammar key={language.id} language={language} onChange={refresh} tutorReady={tutorReady} onSettings={() => setModal('settings')} />}
        {page === 'practice' && <Practice key={language.id} language={language} onChange={refresh} tutorReady={tutorReady} onSettings={() => setModal('settings')} />}
      </>}</main>
    </div>
    {modal === 'language' && <AddLanguage onClose={() => setModal('')} onAdded={async l => { await refresh(); chooseLanguage(l.id); setModal(''); }} />}
    {modal === 'settings' && data && <Settings initial={data.settings} onClose={() => setModal('')} onSaved={refresh} />}
    {modal === 'help' && <Modal title="Getting started" onClose={() => setModal('')}><div className="help-steps"><div><span>01</span><section><h3>Choose a language</h3><p>Dutch and Turkish are ready to go. Add other languages as needed.</p></section></div><div><span>02</span><section><h3>Bring your materials</h3><p>Link decks from the Anki desktop app with AnkiConnect. Upload grammar PDFs, then review their outlines and page ranges.</p></section></div><div><span>03</span><section><h3>Connect your tutor</h3><p>Open Settings and choose Continue with ChatGPT to use your existing plan, or connect a local Ollama model. Then discuss a grammar section or start a conversation.</p></section></div></div><p className="muted small">Your library and conversations are stored in the project’s data folder. With ChatGPT selected, chat messages and the selected section text are sent to OpenAI when you ask the tutor. With Ollama, they stay local.</p><button className="button primary full" onClick={() => setModal('settings')}>Tutor settings<ArrowRight size={16} /></button></Modal>}
  </div></TutorContext.Provider>;
}

function LanguageHome({ languages, onSelect, onAdd }) {
  return <div className="page-content"><div className="page-heading"><h1>Languages</h1><button className="button primary" onClick={onAdd}><Plus size={17} />Add language</button></div>
    <div className="language-list">{languages.map(l => <button className="language-row" key={l.id} onClick={() => onSelect(l.id)}><span><strong>{l.name}</strong><small>{l.nativeName}</small></span><ArrowRight size={18} /></button>)}</div>
    {!languages.length && <p className="muted">No languages added.</p>}
  </div>;
}

function Overview({ language, onNavigate, tutorReady, onSettings }) {
  return <div className="page-content"><div className="page-heading"><h1>{language.name}</h1></div>
    <div className="language-list">{[{ page: 'vocabulary', label: 'Vocabulary', count: `${language.decks} decks` }, { page: 'grammar', label: 'Grammar', count: `${language.references} references` }, { page: 'practice', label: 'Practice', count: `${language.conversations} conversations` }].map(({ page, label, count }) => <button className="language-row" key={page} onClick={() => onNavigate(page)}><span><strong>{label}</strong><small>{count}</small></span><ArrowRight size={18} /></button>)}</div>
    <dl className="study-totals"><div><dt>Cards reviewed</dt><dd>{language.reviews}</dd></div><div><dt>Sections completed</dt><dd>{language.completed}</dd></div></dl>
    {!tutorReady && <button className="text-button" onClick={onSettings}>Connect tutor</button>}
  </div>;
}

function AddLanguage({ onClose, onAdded }) {
  const [form, setForm] = useState({ name: '', nativeName: '', code: '' });
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const suggestions = [{ name: 'French', nativeName: 'Français', code: 'FR' }, { name: 'Spanish', nativeName: 'Español', code: 'ES' }, { name: 'Italian', nativeName: 'Italiano', code: 'IT' }, { name: 'German', nativeName: 'Deutsch', code: 'DE' }, { name: 'Japanese', nativeName: '日本語', code: 'JP' }];
  async function submit(e) { e.preventDefault(); setBusy(true); setError(''); try { await onAdded(await api('/languages', { method: 'POST', body: form })); } catch (e) { setError(e.message); } finally { setBusy(false); } }
  return <Modal title="Add language" onClose={onClose}><div className="suggestion-chips">{suggestions.map(s => <button key={s.code} onClick={() => setForm({ ...s })}>{s.name}</button>)}</div><form onSubmit={submit}><div className="form-grid"><label>Language name<input required maxLength={160} placeholder="e.g. Portuguese" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label><label>Native name<input required maxLength={160} placeholder="e.g. Português" value={form.nativeName} onChange={e => setForm({ ...form, nativeName: e.target.value })} /></label><label>Country or language code<input required minLength={2} maxLength={3} placeholder="e.g. PT" value={form.code} onChange={e => setForm({ ...form, code: e.target.value.toUpperCase() })} /></label></div><ErrorNotice error={error} /><button className="button primary full" disabled={busy}>{busy ? 'Adding language…' : 'Add language'}<Plus size={17} /></button></form></Modal>;
}

