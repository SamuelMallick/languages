import { useEffect, useRef, useState } from 'react';
import { Volume2 } from 'lucide-react';
import { api, ErrorNotice } from './ui.jsx';
import { TUTOR_LEVELS } from '../shared/tutor.js';
import { matchesDictation, speechLanguage } from '../shared/listening.js';

export default function Listening({ language, tutorReady, onSettings }) {
  const synth = window.speechSynthesis;
  const locale = speechLanguage(language);
  const [voices, setVoices] = useState([]);
  const [voiceId, setVoiceId] = useState('');
  const [level, setLevel] = useState('A1');
  const [exercise, setExercise] = useState(null);
  const [answer, setAnswer] = useState('');
  const [checked, setChecked] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [showTranslation, setShowTranslation] = useState(false);
  const [instructions, setInstructions] = useState('');
  const [busy, setBusy] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState('');
  const previous = useRef([]);
  const mounted = useRef(true);
  const playback = useRef(0);
  const input = useRef();
  useEffect(() => {
    mounted.current = true;
    if (!synth) return () => { mounted.current = false; };
    const update = () => setVoices(synth.getVoices().filter(v => v.lang.toLowerCase().split(/[-_]/)[0] === locale));
    update();
    synth.addEventListener('voiceschanged', update);
    return () => { mounted.current = false; playback.current++; synth.cancel(); synth.removeEventListener('voiceschanged', update); };
  }, [synth, locale]);
  const voice = voices.find(v => v.voiceURI === voiceId) || voices[0];
  function stop() { playback.current++; synth?.cancel(); setSpeaking(false); }
  function play() {
    if (!exercise || !voice) return;
    stop(); setError('');
    const token = playback.current;
    const utterance = new SpeechSynthesisUtterance(exercise.sentence);
    utterance.voice = voice; utterance.lang = voice.lang;
    utterance.onend = () => { if (mounted.current && token === playback.current) setSpeaking(false); };
    utterance.onerror = e => {
      if (!mounted.current || token !== playback.current) return;
      setSpeaking(false);
      if (e.error !== 'canceled' && e.error !== 'interrupted') setError('Audio could not be played. Try another voice or play again.');
    };
    setSpeaking(true); synth.speak(utterance); input.current?.focus();
  }
  async function generate() {
    if (busy) return;
    if (!tutorReady) { onSettings(); return; }
    stop(); setBusy(true); setError('');
    try {
      const next = await api(`/languages/${language.id}/listening`, { method: 'POST', body: { level, previous: previous.current, instructions } });
      if (!mounted.current) return;
      previous.current = [...previous.current, next.sentence].slice(-10);
      setExercise(next); setAnswer(''); setChecked(false); setRevealed(false); setShowTranslation(false);
    } catch (e) { if (mounted.current) setError(e.message); }
    finally { if (mounted.current) setBusy(false); }
  }
  const correct = exercise && matchesDictation(answer, exercise.sentence, locale);
  return <section className="listening-practice" aria-label="Listening practice">
    <div className="listening-controls">
      <label>Language level<select value={level} disabled={busy} onChange={e => { stop(); setLevel(e.target.value); setExercise(null); setChecked(false); setRevealed(false); setShowTranslation(false); }}>{TUTOR_LEVELS.filter(Boolean).map(v => <option key={v}>{v}</option>)}</select></label>
      {synth && <label>Voice<select value={voice?.voiceURI || ''} disabled={!voices.length || speaking} onChange={e => setVoiceId(e.target.value)}>{!voices.length && <option value="">No matching voice</option>}{voices.map(v => <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang})</option>)}</select></label>}
    </div>
    {!synth ? <p role="status">Audio playback is not supported in this browser. Use a browser with speech synthesis.</p> : !voices.length ? <p role="status">No voice for {language.name} is available. Install a matching speech voice in your browser or operating system, then reload this page.</p> : <p className="small muted">Audio uses your browser’s speech service. Non-local voices may send the sentence to that service.</p>}
    <div className="listening-instructions"><label>Sentence instructions<textarea rows={3} maxLength={2000} value={instructions} disabled={busy} onChange={e => setInstructions(e.target.value)} aria-describedby="sentence-instructions-hint" placeholder="For example: everyday conversations, past tense, or shorter sentences." /></label><p id="sentence-instructions-hint" className="small muted">Instructions and feedback apply to the next sentence.</p></div>
    {!tutorReady && <div className="tutor-connect"><span>Connect a tutor to generate sentences.</span><button onClick={onSettings}>Set up</button></div>}
    <ErrorNotice error={error} onClose={() => setError('')} />
    <button className="button primary" disabled={busy || !voice} onClick={generate}>{busy ? 'Generating…' : exercise ? 'Next sentence' : 'Generate sentence'}</button>
    {exercise && <div className="listening-exercise" aria-busy={busy}>
      <button className="button secondary" disabled={busy || !voice} onClick={speaking ? stop : play}><Volume2 size={18} />{speaking ? 'Stop audio' : 'Play sentence'}</button>
      <form onSubmit={e => { e.preventDefault(); setChecked(true); }}>
        <label>Type what you hear<textarea ref={input} lang={locale} dir="auto" rows={3} maxLength={1000} value={answer} disabled={busy || revealed} autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} onChange={e => { setAnswer(e.target.value); setChecked(false); }} /></label>
        <p className="small muted">Capitalization, punctuation, and extra spaces are ignored. Accents count.</p>
        <div className="listening-actions"><button className="button secondary" disabled={busy || !answer.trim() || revealed}>Check answer</button><button type="button" className="text-button" disabled={busy || revealed} onClick={() => setRevealed(true)}>Reveal answer</button></div>
      </form>
      <div aria-live="polite">{checked && <p>{correct ? 'Correct.' : 'Not quite. Listen again and edit your answer, or reveal the sentence.'}</p>}{(revealed || (checked && correct)) && <div className="listening-answer"><div className="listening-answer-heading"><strong>Sentence</strong>{!showTranslation && <button type="button" className="button secondary small-button" disabled={busy} onClick={() => setShowTranslation(true)}>Show English translation</button>}</div><p lang={locale} dir="auto">{exercise.sentence}</p>{showTranslation && <div className="listening-translation"><strong>English translation</strong><p lang="en" dir="ltr">{exercise.translation}</p></div>}</div>}</div>
    </div>}
  </section>;
}
