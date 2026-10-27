import { useEffect, useState } from 'react';
import { MessageCircle, Plus, Trash2 } from 'lucide-react';
import { api, Busy, ErrorNotice } from './ui.jsx';
import Chat from './Chat.jsx';
import Listening from './Listening.jsx';

export default function Practice({ language, onChange, tutorReady, onSettings }) {
  const [mode, setMode] = useState('chat');
  const [chats, setChats] = useState(null); const [selected, setSelected] = useState(null);
  const [error, setError] = useState(''); const [loading, setLoading] = useState(false);
  async function load() { const list = await api(`/languages/${language.id}/chats`); setChats(list); return list; }
  async function choose(id) { setLoading(true); setError(''); try { setSelected(await api(`/chats/${id}`)); } catch (e) { setError(e.message); } finally { setLoading(false); } }
  async function create() { setLoading(true); setError(''); try { const empty = chats?.find(c => c.title === 'New conversation'); const chat = empty ? await api(`/chats/${empty.id}`) : await api('/chats', { method: 'POST', body: { languageId: language.id } }); setSelected(chat); await load(); await onChange(); } catch (e) { setError(e.message); } finally { setLoading(false); } }
  useEffect(() => { load().then(list => { if (list.length) choose(list[0].id); }).catch(e => setError(e.message)); }, []);
  async function remove(chat) { if (!window.confirm('Delete this conversation and its messages?')) return; try { await api(`/chats/${chat.id}`, { method: 'DELETE' }); if (selected?.id === chat.id) setSelected(null); await load(); await onChange(); } catch (e) { setError(e.message); } }
  return <div className="page-content"><div className="page-heading compact"><div><h1>Practice</h1></div>{mode === 'chat' && <button className="button primary" disabled={loading} onClick={create}><Plus size={17} />New conversation</button>}</div>
    <nav className="practice-modes" aria-label="Practice type"><button aria-pressed={mode === 'chat'} onClick={() => setMode('chat')}>Text chat</button><button aria-pressed={mode === 'listening'} onClick={() => setMode('listening')}>Listening</button></nav>
    {mode === 'listening' && <Listening language={language} tutorReady={tutorReady} onSettings={onSettings} />}
    <div hidden={mode !== 'chat'}><ErrorNotice error={error} />
    <div className="practice-layout"><aside className="conversation-list"><div className="conversation-list-title">Conversations <span>{chats?.length || 0}</span></div>{!chats ? <Busy /> : chats.length === 0 ? <div className="no-conversations"><p>No conversations.</p></div> : chats.map(chat => <div className={`conversation-item ${selected?.id === chat.id ? 'selected' : ''}`} key={chat.id}><button disabled={loading} onClick={() => choose(chat.id)}><MessageCircle size={16} /><span>{chat.title}<small>{new Date(chat.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</small></span></button><button className="icon-button" aria-label={`Delete ${chat.title}`} onClick={() => remove(chat)}><Trash2 size={14} /></button></div>)}</aside><div className="practice-chat">{loading ? <Busy>Opening your conversation…</Busy> : selected ? <Chat key={selected.id} initial={selected} language={language} tutorReady={tutorReady} onSettings={onSettings} onUpdate={() => { load(); onChange(); }} /> : <div className="chat-panel chat-start"><p>Select a conversation or create a new one.</p></div>}</div></div>
  </div></div>;
}
