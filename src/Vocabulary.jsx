import { useEffect, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import { formatVocabularyHtml } from './anki-layout.js';
import { addAudioControls, replayAudio } from './anki-media.js';
import { ArrowRight, Check, CheckCircle2, Layers3, Link2, Plus, RefreshCw, Unlink, Wifi, WifiOff } from 'lucide-react';
import { api, Busy, EmptyState, ErrorNotice, Modal, ExternalLink } from './ui.jsx';

export default function Vocabulary({ language, onChange }) {
  const [decks, setDecks] = useState(null); const [available, setAvailable] = useState([]);
  const [connectionError, setConnectionError] = useState(''); const [error, setError] = useState('');
  const [connecting, setConnecting] = useState(false); const [linking, setLinking] = useState(false);
  const [busyDeck, setBusyDeck] = useState(''); const [review, setReview] = useState(null);
  const [checked, setChecked] = useState(false);
  async function load() { setDecks(await api(`/languages/${language.id}/decks`)); }
  async function connect() {
    setConnecting(true); setConnectionError('');
    try { setAvailable(await api('/anki/decks')); } catch (e) { setAvailable([]); setConnectionError(e.message); }
    finally { setConnecting(false); setChecked(true); }
  }
  useEffect(() => { load().catch(e => setError(e.message)); connect(); }, []);
  async function link(name) { setBusyDeck(name); setError(''); try { await api(`/languages/${language.id}/decks`, { method: 'POST', body: { name } }); await load(); await onChange(); } catch (e) { setError(e.message); } finally { setBusyDeck(''); } }
  async function unlink(deck) { setBusyDeck(deck.name); setError(''); try { await api(`/decks/${deck.id}`, { method: 'DELETE' }); await load(); await onChange(); } catch (e) { setError(e.message); } finally { setBusyDeck(''); } }
  async function start(deck) { setBusyDeck(deck.name); setError(''); try { const result = await api('/anki/review/start', { method: 'POST', body: { languageId: language.id, name: deck.name } }); setReview({ ...result, name: deck.name }); } catch (e) { setError(e.message); } finally { setBusyDeck(''); } }
  const connected = checked && !connectionError;
  return <div className="page-content"><div className="page-heading compact"><div><h1>Vocabulary</h1></div><button className="button primary" onClick={() => setLinking(true)}><Plus size={17} />Link Anki deck</button></div>
    <div className={`connection-strip ${connected ? 'connected' : ''}`}><span className="path-icon pale">{connected ? <Wifi size={20} /> : <WifiOff size={20} />}</span><div><strong>{connecting ? 'Looking for Anki…' : connected ? 'Anki is connected' : 'Anki not connected'}</strong><p>{connected ? 'Your reviews use Anki’s scheduler and sync back to your collection.' : 'Open Anki with the AnkiConnect add-on to review your cards here.'}</p></div><button className="button secondary" onClick={connect} disabled={connecting}><RefreshCw size={15} className={connecting ? 'spin' : ''} />{connected ? 'Refresh' : 'Connect'}</button></div>
    {connectionError && <div className="setup-help"><p>{connectionError}</p><span>In Anki: Tools → Add-ons → Get Add-ons → <code>2055492159</code>, then restart Anki. <ExternalLink href="https://ankiweb.net/shared/info/2055492159">AnkiConnect setup</ExternalLink></span></div>}
    <ErrorNotice error={error} onClose={() => setError('')} /><div className="section-heading"><h2>Linked decks <span className="count-badge">{decks?.length || 0}</span></h2></div>
    {!decks ? <Busy /> : !decks.length ? <EmptyState icon={Layers3} title="No linked decks">Link an Anki deck to review cards.</EmptyState> : <div className="deck-grid">{decks.map(deck => { const live = available.find(d => d.name === deck.name); const due = live ? (live.new_count || 0) + (live.learn_count || 0) + (live.review_count || 0) : null; return <article className="deck-card" key={deck.id}><div className="card-top"><button className="icon-button" aria-label={`Unlink ${deck.name}`} title="Unlink deck (keeps cards in Anki)" disabled={Boolean(busyDeck)} onClick={() => unlink(deck)}><Unlink size={16} /></button></div><h3>{deck.name}</h3><p>{live ? `${live.total_in_deck ?? '—'} cards in Anki` : connected ? 'Not in the current Anki profile' : 'Open Anki to see your review queue'}</p><div className="deck-counts"><span><strong>{live?.new_count ?? '—'}</strong>New</span><span><strong>{live?.learn_count ?? '—'}</strong>Learning</span><span><strong>{live?.review_count ?? '—'}</strong>Review</span></div><button className="button primary full" disabled={Boolean(busyDeck) || !live} onClick={() => start(deck)}>{busyDeck === deck.name ? 'Opening…' : due === 0 ? 'Check review queue' : `Review${due !== null ? ` ${due} cards` : ''}`}<ArrowRight size={16} /></button></article>; })}</div>}
    {linking && <Modal title="Link an Anki deck" onClose={() => setLinking(false)}><p className="muted">Select a deck. Cards and scheduling remain in Anki.</p>{connecting ? <Busy>Finding your decks…</Busy> : connectionError ? <><ErrorNotice error={connectionError} /><button className="button secondary full" onClick={connect}><RefreshCw size={16} />Try connecting again</button></> : !available.length ? <p className="muted">No decks found. Create or import a deck in Anki, then refresh.</p> : <div className="deck-picker">{available.map(deck => { const linked = decks?.some(d => d.name === deck.name); return <button key={deck.name} onClick={() => link(deck.name)} disabled={linked || Boolean(busyDeck)}><Layers3 size={20} /><span>{deck.name}<small>{deck.total_in_deck ?? '—'} cards</small></span>{linked ? <Check size={18} /> : <Plus size={18} />}</button>; })}</div>}<ErrorNotice error={error} /><button className="button secondary full" onClick={() => setLinking(false)}>Done</button></Modal>}
    {review && <Review initial={review} onChange={onChange} onClose={() => { setReview(null); connect(); onChange(); }} />}
  </div>;
}

function CardContent({ html, audioFiles }) {
  const [audioError, setAudioError] = useState('');
  const playing = useRef(null);
  useEffect(() => () => { playing.current?.pause(); }, []);
  const document = new DOMParser().parseFromString(html || '', 'text/html');
  document.querySelectorAll('a').forEach(link => {
    const reference = link.getAttribute('href')?.match(/^(?:playsound:|anki:play:|play:)([qa]):(\d+)$/)
      || link.getAttribute('onclick')?.match(/\bplay:([qa]):(\d+)/);
    if (reference) link.replaceWith(document.createTextNode(`[anki:play:${reference[1]}:${reference[2]}]`));
  });
  document.querySelectorAll('img, audio, source').forEach(node => {
    const src = node.getAttribute('src');
    if (src && !/^(?:https?:|data:|\/)/i.test(src)) {
      let filename = src;
      try { filename = decodeURIComponent(src); } catch { /* Literal percent signs are valid filenames. */ }
      node.setAttribute('src', `/api/anki/media?filename=${encodeURIComponent(filename)}`);
    }
    else if (!src?.startsWith('/api/anki/media?')) node.removeAttribute('src');
    node.removeAttribute('srcset');
  });
  const clean = DOMPurify.sanitize(document.body.innerHTML, { FORBID_TAGS: ['style', 'iframe', 'form', 'input', 'button', 'svg', 'math'], FORBID_ATTR: ['style', 'srcset', 'autoplay'], ALLOW_DATA_ATTR: false });
  const formatted = formatVocabularyHtml(clean, new DOMParser());
  const content = addAudioControls(formatted || clean, audioFiles, new DOMParser());
  async function play(event) {
    const button = event.target.closest?.('.audio-play');
    if (!button) return;
    const audio = button.parentElement.querySelector('audio');
    if (!audio) return;
    try {
      setAudioError('');
      playing.current?.pause();
      playing.current = audio;
      await replayAudio(audio);
    } catch { setAudioError('Could not play audio. Check that Anki is open and the media file is available.'); }
  }
  return <><div className="anki-content" onClick={play} onErrorCapture={event => { if (event.target.tagName === 'AUDIO') setAudioError('Could not load this audio file from Anki.'); }} dangerouslySetInnerHTML={{ __html: content }} /><ErrorNotice error={audioError} onClose={() => setAudioError('')} /></>;
}

function Review({ initial, onClose, onChange }) {
  const [card, setCard] = useState(initial.card); const [revealed, setRevealed] = useState(false);
  const [counts, setCounts] = useState(initial.counts);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [count, setCount] = useState(0);
  async function reveal() { if (busy || revealed || !card) return; setBusy(true); setError(''); try { const result = await api('/anki/review/reveal', { method: 'POST', body: { token: initial.token, cardId: card.cardId } }); setCard(result.card); setCounts(result.counts); setRevealed(true); } catch (e) { setError(e.message); } finally { setBusy(false); } }
  async function rate(ease) { if (busy || !revealed || !card) return; setBusy(true); setError(''); try { const result = await api('/anki/review/rate', { method: 'POST', body: { token: initial.token, cardId: card.cardId, ease } }); setCard(result.card); setCounts(result.counts); setRevealed(false); setCount(n => n + 1); onChange(); } catch (e) { setError(e.message); } finally { setBusy(false); } }
  useEffect(() => {
    function key(e) { if (/INPUT|TEXTAREA|BUTTON/.test(e.target.tagName)) return; if (e.code === 'Space' && !revealed) { e.preventDefault(); reveal(); } else if (revealed && card?.buttons?.includes(Number(e.key))) { e.preventDefault(); rate(Number(e.key)); } }
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  });
  const labels = card?.buttons?.length === 2 ? ['Again', 'Good'] : card?.buttons?.length === 3 ? ['Again', 'Good', 'Easy'] : ['Again', 'Hard', 'Good', 'Easy'];
  return <Modal title={initial.name} wide className="review-modal" onClose={onClose}><div className="review-top"><div className="review-counts" aria-label="Remaining cards" aria-live="polite">{[['new', 'New'], ['learning', 'Learning'], ['review', 'Review']].map(([category, label]) => <span key={category} className={`queue-${category}`} aria-current={card?.category === category ? 'true' : undefined}><strong>{counts?.[category] ?? '—'}</strong> <span className="queue-label">{label}</span></span>)}</div><span>{count} reviewed</span></div><ErrorNotice error={error} />{card ? <><div className="flashcard"><CardContent key={`${card.cardId}-${revealed}`} html={revealed ? card.answer : card.question} audioFiles={card.audioFiles} /></div>{revealed ? <div className="rating-grid">{card.buttons?.map((ease, i) => <button disabled={busy} className={`rating rating-${labels[i]?.toLowerCase()}`} key={ease} onClick={() => rate(ease)}><span>{labels[i]}</span><small>{card.nextReviews?.[i] || `Key ${ease}`}</small></button>)}</div> : <button className="button primary full" disabled={busy} onClick={reveal}>{busy ? 'Loading…' : 'Reveal answer'}<span className="key-hint">space</span></button>}</> : <EmptyState icon={CheckCircle2} title="No cards due" action={<button className="button primary" onClick={onClose}>Back to vocabulary<Check size={17} /></button>}>{count ? `${count} cards reviewed.` : 'Anki has no cards ready in this deck.'}</EmptyState>}</Modal>;
}
