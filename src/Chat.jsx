import { useContext, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { ArrowUp, LoaderCircle } from 'lucide-react';
import { api, ErrorNotice, ExternalLink } from './ui.jsx';
import { TutorContext } from './tutor-context.js';
import { DEFAULT_TUTOR_INSTRUCTIONS, TUTOR_LEVELS } from '../shared/tutor.js';

export default function Chat({ initial, language, grammar = false, tutorReady, onSettings, onUpdate }) {
  const { settings, refresh } = useContext(TutorContext);
  const [chat, setChat] = useState(initial); const [text, setText] = useState('');
  const [busy, setBusy] = useState(false); const [pending, setPending] = useState('');
  const [error, setError] = useState(''); const end = useRef(); const input = useRef();
  const [instructions, setInstructions] = useState(initial.tutorInstructions ?? DEFAULT_TUTOR_INSTRUCTIONS);
  const [level, setLevel] = useState(initial.tutorLevel || '');
  const [saving, setSaving] = useState(false);
  const [tutorError, setTutorError] = useState('');
  const dirty = instructions !== (chat.tutorInstructions ?? DEFAULT_TUTOR_INSTRUCTIONS) || level !== (chat.tutorLevel || '');
  async function saveTutor(e) {
    e.preventDefault(); setSaving(true); setTutorError('');
    try {
      const next = await api(`/chats/${chat.id}/tutor`, { method: 'PATCH', body: { tutorInstructions: instructions, tutorLevel: level } });
      setChat(next); setInstructions(next.tutorInstructions); setLevel(next.tutorLevel);
    } catch (e) { setTutorError(e.message); }
    finally { setSaving(false); }
  }
  const interacted = useRef(false);
  useEffect(() => { if (grammar && !interacted.current) return; end.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'nearest' }); }, [chat.messages.length, busy, grammar]);
  async function send(value = text) {
    if (busy || saving || !value.trim()) return;
    if (!grammar && dirty) { setTutorError('Save or reset your tutor settings before sending a message.'); return; }
    if (!tutorReady) { onSettings(); return; }
    interacted.current = true;
    setBusy(true); setError(''); setPending(value); setText('');
    try { const next = await api(`/chats/${chat.id}/messages`, { method: 'POST', body: { content: value } }); setChat(next); onUpdate?.(next); }
    catch (e) { setError(e.message); setText(value); await refresh().catch(() => {}); }
    finally { setBusy(false); setPending(''); input.current?.focus(); }
  }
  const starters = grammar ? [
    { label: 'Summarise', prompt: 'Summarize this section with the key rules, useful examples, and page references.' },
    { label: 'Generate practice questions', prompt: 'Give me three representative exercises for this section. Do not show the answers yet. After I attempt them, explain any corrections.' },
  ] : [
    { label: 'Introductions', prompt: `Let’s get to know each other in ${language.name}. Start a simple conversation and help me with any mistakes.` },
    { label: 'Ordering at a café', prompt: `Let’s role-play ordering at a café in ${language.name}. You are the barista. Help when I get stuck.` },
    { label: 'Describe my day', prompt: `Help me describe my day in ${language.name}. Ask me one short question at a time and gently correct my answers.` },
  ];
  return <div className={grammar ? '' : 'chat-workspace'}>{!grammar && <aside className="tutor-settings"><form onSubmit={saveTutor}>
    <h2>Tutor settings</h2>
    <p className="small muted">Saved for this conversation. Changes apply to the next reply.</p>
    <label>Language level<select value={level} disabled={busy || saving} onChange={e => setLevel(e.target.value)}>{TUTOR_LEVELS.map(value => <option key={value} value={value}>{value || 'Adapt to my responses'}</option>)}</select></label>
    <label>Instructions<textarea rows={12} maxLength={8000} value={instructions} disabled={busy || saving} onChange={e => setInstructions(e.target.value)} /></label>
    <ErrorNotice error={tutorError} onClose={() => setTutorError('')} />
    <div className="tutor-settings-actions"><button className="button primary" disabled={busy || saving || !dirty}>{saving ? 'Saving…' : 'Save'}</button><button type="button" className="text-button" disabled={busy || saving} onClick={() => { setInstructions(DEFAULT_TUTOR_INSTRUCTIONS); setLevel(''); setTutorError(''); }}>Reset to defaults</button></div>
    {dirty && <p className="small muted" role="status">Unsaved changes</p>}
  </form></aside>}<div className={`chat-panel ${grammar ? `grammar-chat ${!chat.messages.length && !busy ? 'empty-discussion' : ''}` : ''}`}><header className="chat-header"><div><strong>{grammar ? 'Section discussion' : 'Conversation'}</strong><small>{language.name}</small></div></header>
    {grammar && <div className="grammar-actions">{starters.map(({ label, prompt }) => <button className="button secondary small-button" key={label} disabled={busy} onClick={() => send(prompt)}>{label}</button>)}</div>}
    <div className="chat-messages" aria-live="polite" aria-busy={busy}>{!grammar && !chat.messages.length && !busy ? <div className="chat-welcome"><div className="chat-starters">{starters.map(({ label, prompt }) => <button key={label} onClick={() => send(prompt)}>{label}</button>)}</div></div> : <>{chat.messages.map(message => <div key={message.id} className={`message ${message.role}`}><div className="message-body"><span className="message-author">{message.role === 'assistant' ? 'Mallick Diller tutor' : 'You'}</span><ReactMarkdown>{message.content}</ReactMarkdown></div></div>)}{busy && <><div className="message user"><div className="message-body"><span className="message-author">You</span><p>{pending}</p></div></div><div className="message assistant"><div className="thinking" role="status">Thinking…</div></div></>}</>}<div ref={end} /></div>
    <div className="chat-bottom">{settings?.provider === 'chatgpt' && <div className={`chat-plan-status ${settings.chatgpt?.usageBlocked ? 'plan-paused' : ''}`}><span>{settings.chatgpt?.usageBlocked ? 'ChatGPT plan usage paused' : settings.chatgpt?.sharing ? 'Using ChatGPT plan' : 'Connect your ChatGPT plan'}</span><ExternalLink href="https://chatgpt.com/settings/usage">Manage usage</ExternalLink></div>}<ErrorNotice error={error} onClose={() => setError('')} />{(chat.contextTruncated || chat.historyTruncated) && <p className="small muted">{chat.contextTruncated ? 'This section is long; the tutor received its first 32,000 characters. Use smaller page ranges for full coverage. ' : ''}{chat.historyTruncated ? 'The tutor received recent messages; your full conversation is still saved.' : ''}</p>}{!tutorReady && <div className="tutor-connect"><span>Connect a tutor to send messages.</span><button onClick={onSettings}>Set up<ArrowUp size={13} className="diagonal" /></button></div>}<form className="composer" onSubmit={e => { e.preventDefault(); send(); }}><textarea ref={input} rows={2} maxLength={8000} disabled={busy} value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} placeholder={grammar ? 'Ask about this chapter…' : `Message in ${language.name}…`} aria-label="Message your tutor" /><button className="send-button" disabled={busy || !text.trim()} aria-label="Send message">{busy ? <LoaderCircle size={19} className="spin" /> : <ArrowUp size={20} />}</button></form><p className="composer-hint">{grammar ? 'The selected section accompanies each message.' : ''} <span>AI can make mistakes.</span></p></div>
  </div></div>;
}
