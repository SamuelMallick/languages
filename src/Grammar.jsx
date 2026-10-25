import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Check, CheckCircle2, ChevronRight, Edit3, ExternalLink, FileText, Plus, Trash2, Upload, X } from 'lucide-react';
import { api, Busy, EmptyState, ErrorNotice, Modal } from './ui.jsx';
import Chat from './Chat.jsx';
import PdfSection from './PdfSection.jsx';

export default function Grammar({ language, onChange, tutorReady, onSettings }) {
  const [documents, setDocuments] = useState(null); const [document, setDocument] = useState(null);
  const [error, setError] = useState(''); const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(false); const [dragging, setDragging] = useState(false);
  const fileInput = useRef();
  async function load() { const docs = await api(`/languages/${language.id}/documents`); setDocuments(docs); }
  useEffect(() => { load().catch(e => setError(e.message)); }, []);
  async function upload(file) {
    if (!file || uploading) return;
    if (file.size > 30 * 1024 * 1024) { setError('Please choose a PDF smaller than 30 MB.'); return; }
    if (!file.name.toLowerCase().endsWith('.pdf')) { setError('Please choose a PDF file.'); return; }
    setUploading(true); setError('');
    try { const body = new FormData(); body.append('file', file); await api(`/languages/${language.id}/documents`, { method: 'POST', body }); await load(); await onChange(); }
    catch (e) { setError(e.message); }
    finally { setUploading(false); if (fileInput.current) fileInput.current.value = ''; }
  }
  async function open(doc) { setLoading(true); setError(''); try { setDocument(await api(`/documents/${doc.id}`)); } catch (e) { setError(e.message); } finally { setLoading(false); } }
  async function remove(doc) { if (!window.confirm(`Remove “${doc.title}” and its section conversations from this workspace?`)) return; setError(''); try { await api(`/documents/${doc.id}`, { method: 'DELETE' }); await load(); await onChange(); } catch (e) { setError(e.message); } }
  if (document) return <Reader document={document} language={language} onBack={() => { setDocument(null); load(); }} onChange={async () => { await load(); await onChange(); }} tutorReady={tutorReady} onSettings={onSettings} />;
  return <div className="page-content"><div className="page-heading compact"><div><h1>Grammar</h1></div></div><input className="sr-only" ref={fileInput} type="file" accept="application/pdf,.pdf" aria-label="Upload a grammar PDF" onChange={e => upload(e.target.files[0])} />
    <ErrorNotice error={error} onClose={() => setError('')} /><button className={`upload-zone ${dragging ? 'dragging' : ''}`} disabled={uploading} onClick={() => fileInput.current.click()} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); upload(e.dataTransfer.files[0]); }}><span className="upload-icon"><Upload size={25} strokeWidth={1.5} /></span><span><strong>{uploading ? 'Uploading PDF…' : 'Upload PDF'}</strong><span>{uploading ? 'Large books may take a little longer.' : 'Drop a PDF here, or click to browse. Up to 30 MB and 600 pages.'}</span></span>{uploading ? <span className="upload-progress" /> : <span className="file-pill">PDF</span>}</button>
    <div className="section-heading"><h2>References</h2></div>
    {loading ? <Busy>Opening your reference…</Busy> : !documents ? <Busy /> : !documents.length ? <EmptyState icon={BookOpen} title="No references">Upload a PDF to study its sections.</EmptyState> : <div className="reference-grid">{documents.map(doc => { const done = doc.sections.filter(s => s.completed).length; return <article className="reference-card" key={doc.id}><div className="reference-card-content"><div className="card-top"><span className="muted small">{doc.pageCount} pages</span><button className="icon-button" aria-label={`Remove ${doc.title}`} onClick={() => remove(doc)}><Trash2 size={15} /></button></div><h3>{doc.title}</h3><p>{doc.sections.length} sections · {done} completed</p><div className="progress-track"><span style={{ width: `${done / doc.sections.length * 100}%` }} /></div>{!doc.hasText && <p className="small warning-text">Scanned PDF: OCR is needed for tutor discussions.</p>}<button className="text-button full" onClick={() => open(doc)}>Open reference<ArrowRight size={17} /></button></div></article>; })}</div>}
    <details className="library-note"><summary>About PDF outlines</summary><p>PDF bookmarks define the outline. Without bookmarks, pages are grouped into editable sections. Scanned pages need OCR for tutor discussions.</p></details>
  </div>;
}

function Reader({ document: initial, language, onBack, onChange, tutorReady, onSettings }) {
  const [doc, setDoc] = useState(initial); const [sectionId, setSectionId] = useState(initial.sections[0]?.id);
  const [chat, setChat] = useState(null); const [error, setError] = useState(''); const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const section = doc.sections.find(s => s.id === sectionId);
  useEffect(() => {
    let cancelled = false; setChat(null); setError('');
    if (sectionId) api('/chats', { method: 'POST', body: { languageId: language.id, documentId: doc.id, sectionId } }).then(result => { if (!cancelled) setChat(result); }).catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [sectionId, doc.id, doc.sections]);
  const pages = doc.pages.filter(p => p.page >= section?.startPage && p.page <= section?.endPage);
  async function complete() { setSaving(true); setError(''); try { const updated = await api(`/documents/${doc.id}`, { method: 'PATCH', body: { title: doc.title, sections: doc.sections.map(s => s.id === section.id ? { ...s, completed: !s.completed } : s) } }); setDoc({ ...doc, ...updated }); await onChange(); } catch (e) { setError(e.message); } finally { setSaving(false); } }
  return <div className="page-content reader-page"><button className="back-link" onClick={onBack}><ArrowLeft size={16} />Grammar library</button><div className="reader-heading"><div><h1>{doc.title}</h1><p>{doc.pageCount} pages · {doc.sections.length} sections · {doc.outlineSource}</p></div><button className="button secondary" onClick={() => setEditing(true)}><Edit3 size={16} />Edit outline</button></div><ErrorNotice error={error} onClose={() => setError('')} />
    <div className="reader-layout"><aside className="outline"><h2>Contents</h2><nav aria-label="Reference sections">{doc.sections.map((s, index) => <button className={`outline-item ${sectionId === s.id ? 'selected' : ''}`} style={{ paddingLeft: `${14 + s.depth * 14}px` }} key={s.id} onClick={() => setSectionId(s.id)}><span className="outline-number">{s.completed ? <CheckCircle2 size={15} /> : String(index + 1).padStart(2, '0')}</span><span>{s.title}<small>pp. {s.startPage}–{s.endPage}</small></span><ChevronRight size={14} /></button>)}</nav></aside><div className="section-workspace">{section && <><div className="section-title"><div><h2>{section.title}</h2></div><button className={`button secondary small-button ${section.completed ? 'is-completed' : ''}`} disabled={saving} onClick={complete}><Check size={15} />{section.completed ? 'Completed' : 'Mark complete'}</button></div><PdfSection key={`${doc.id}-${section.id}-${section.startPage}-${section.endPage}`} documentId={doc.id} section={section} /><details className="source-preview"><summary><FileText size={17} />Reference text <span>pp. {section.startPage}–{section.endPage}</span><ChevronRight size={15} /></summary><div className="source-text">{pages.map(p => <section key={p.page}><strong>Page {p.page}</strong><p>{p.text || 'No text could be extracted from this page. A text-enabled PDF is needed for the tutor.'}</p></section>)}</div><a className="source-link" href={`/api/documents/${doc.id}/file#page=${section.startPage}`} target="_blank" rel="noreferrer">Open original PDF<ExternalLink size={14} /></a></details>{chat ? <Chat key={`${chat.id}-${sectionId}`} initial={chat} language={language} grammar tutorReady={tutorReady} onSettings={onSettings} onUpdate={onChange} /> : error ? <div className="notice">Select a section again to retry opening its discussion.</div> : <Busy>Preparing your section…</Busy>}</>}</div></div>
    {editing && <OutlineEditor doc={doc} onClose={() => setEditing(false)} onSaved={async updated => { setDoc({ ...doc, ...updated }); if (!updated.sections.some(s => s.id === sectionId)) setSectionId(updated.sections[0].id); setEditing(false); await onChange(); }} />}
  </div>;
}

function OutlineEditor({ doc, onClose, onSaved }) {
  const [title, setTitle] = useState(doc.title); const [sections, setSections] = useState(doc.sections.map(s => ({ ...s })));
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  function update(index, key, value) { setSections(sections.map((s, i) => i === index ? { ...s, [key]: value } : s)); }
  async function submit(e) { e.preventDefault(); setBusy(true); setError(''); try { const result = await api(`/documents/${doc.id}`, { method: 'PATCH', body: { title, sections } }); await onSaved(result); } catch (e) { setError(e.message); } finally { setBusy(false); } }
  return <Modal title="Edit outline" wide onClose={onClose}><p className="muted">Name each chapter or section and choose its PDF page range (1–{doc.pageCount}). Use a higher depth to nest a section inside a chapter.</p><p className="small warning-text">Changing a section’s page range resets its tutor conversation. Removing a section also removes its conversation.</p><form onSubmit={submit}><label>Reference title<input value={title} onChange={e => setTitle(e.target.value)} required maxLength={160} /></label><div className="outline-editor"><div className="outline-editor-labels"><span>Section title</span><span>From</span><span>To</span><span>Depth</span><span /></div>{sections.map((s, i) => <div className="outline-editor-row" key={s.id}><input aria-label={`Section ${i + 1} title`} required maxLength={160} value={s.title} onChange={e => update(i, 'title', e.target.value)} /><input aria-label={`Section ${i + 1} first page`} required type="number" min={1} max={doc.pageCount} value={s.startPage} onChange={e => update(i, 'startPage', Number(e.target.value))} /><input aria-label={`Section ${i + 1} last page`} required type="number" min={s.startPage} max={doc.pageCount} value={s.endPage} onChange={e => update(i, 'endPage', Number(e.target.value))} /><input aria-label={`Section ${i + 1} depth`} required type="number" min={0} max={6} value={s.depth} onChange={e => update(i, 'depth', Number(e.target.value))} /><button type="button" className="icon-button" aria-label={`Remove section ${i + 1}`} disabled={sections.length === 1} onClick={() => setSections(sections.filter((_, j) => j !== i))}><X size={17} /></button></div>)}</div><button className="button secondary" type="button" onClick={() => setSections([...sections, { id: crypto.randomUUID(), title: '', startPage: 1, endPage: 1, depth: 0, completed: false }])}><Plus size={16} />Add section</button><ErrorNotice error={error} /><button className="button primary full" disabled={busy}>{busy ? 'Saving outline…' : 'Save outline'}<Check size={17} /></button></form></Modal>;
}
