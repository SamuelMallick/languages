import { createContext, useContext, useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { api, Busy, ErrorNotice, ExternalLink, Modal } from './ui.jsx';

const DictionaryContext = createContext(null);
const skipped = new Set(['a', 'code', 'pre', 'button', 'script', 'style']);

// Transform text nodes only, preserving Markdown structure and existing links/code.
export function dictionaryWords() {
  return tree => {
    function visit(node) {
      if (skipped.has(node.tagName) || !node.children) return;
      node.children = node.children.flatMap(child => {
        if (child.type !== 'text') { visit(child); return [child]; }
        const parts = [];
        const pattern = /[\p{L}\p{M}]+(?:['’\-][\p{L}\p{M}]+)*/gu;
        let start = 0;
        for (const match of child.value.matchAll(pattern)) {
          if (match.index > start) parts.push({ type: 'text', value: child.value.slice(start, match.index) });
          parts.push({ type: 'element', tagName: 'button', properties: { type: 'button' }, children: [{ type: 'text', value: match[0] }] });
          start = match.index + match[0].length;
        }
        if (start < child.value.length) parts.push({ type: 'text', value: child.value.slice(start) });
        return parts;
      });
    }
    visit(tree);
  };
}

export function ChatMarkdown({ children }) {
  const lookup = useContext(DictionaryContext);
  return <ReactMarkdown rehypePlugins={lookup ? [dictionaryWords] : []} components={lookup ? {
    button: ({ children }) => <button type="button" className="dictionary-word" aria-label={`English definition of ${children}`} onClick={() => lookup(String(children))}>{children}</button>,
  } : undefined}>{children}</ReactMarkdown>;
}

function Definition({ word, onClose }) {
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setResult(null); setError('');
    api(`/dictionary/nl/${encodeURIComponent(word)}`).then(data => { if (active) setResult(data); }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [word, attempt]);
  return <Modal title={word} onClose={onClose} className="dictionary-dialog">
    <p className="small muted">Dutch → English · Only the selected word is sent to FreeDictionaryAPI.com.</p>
    {!result && !error && <Busy>Looking up definition…</Busy>}
    <ErrorNotice error={error} />
    {error && <button className="button secondary" onClick={() => setAttempt(value => value + 1)}>Retry</button>}
    {result && (result.definitions.length ? <ol className="dictionary-definitions">{result.definitions.map((sense, i) => <li key={i}>{sense.partOfSpeech && <span className="small muted">{sense.partOfSpeech}</span>}<p>{sense.definition}</p></li>)}</ol> : <p>No Dutch definition found for “{word}”. Try its base form in Wiktionary.</p>)}
    <div className="dictionary-sources small"><ExternalLink href={result?.sourceUrl || `https://en.wiktionary.org/wiki/${encodeURIComponent(word)}`}>Wiktionary</ExternalLink><ExternalLink href="https://freedictionaryapi.com/">FreeDictionaryAPI.com</ExternalLink><ExternalLink href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</ExternalLink></div>
  </Modal>;
}

export function DictionaryProvider({ enabled, children }) {
  const [word, setWord] = useState('');
  return <DictionaryContext.Provider value={enabled ? setWord : null}>{children}{enabled && word && <Definition key={word} word={word} onClose={() => setWord('')} />}</DictionaryContext.Provider>;
}
