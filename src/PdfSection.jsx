import { useEffect, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { Busy, ErrorNotice } from './ui.jsx';

GlobalWorkerOptions.workerSrc = workerUrl;

export default function PdfSection({ documentId, section }) {
  const [pdf, setPdf] = useState(null);
  const [page, setPage] = useState(section.startPage);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [width, setWidth] = useState(0);
  const container = useRef(); const canvas = useRef();
  const url = `/api/documents/${documentId}/file`;
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let cancelled = false;
    const task = getDocument({ url });
    task.promise.then(result => { if (!cancelled) setPdf(result); }).catch(e => { if (!cancelled) { setError(`Could not open PDF: ${e.message}`); setBusy(false); } });
    return () => { cancelled = true; task.destroy(); };
  }, [url]);
  useEffect(() => {
    if (!pdf || !width) return;
    let cancelled = false; let render;
    setBusy(true); setError('');
    (async () => {
      const source = await pdf.getPage(page);
      if (cancelled) return;
      const viewport = source.getViewport({ scale: width / source.getViewport({ scale: 1 }).width });
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const target = canvas.current;
      target.width = Math.floor(viewport.width * ratio);
      target.height = Math.floor(viewport.height * ratio);
      target.style.height = `${viewport.height}px`;
      render = source.render({ canvasContext: target.getContext('2d'), viewport, transform: [ratio, 0, 0, ratio, 0, 0] });
      await render.promise;
      if (!cancelled) setBusy(false);
    })().catch(e => { if (!cancelled) { setError(`Could not display page: ${e.message}`); setBusy(false); } });
    return () => { cancelled = true; render?.cancel(); };
  }, [pdf, page, width]);
  return <section className="pdf-section" aria-label={`${section.title} PDF pages`}>
    <div className="pdf-toolbar"><span>Pages {section.startPage}–{section.endPage}</span><div><button className="icon-button" aria-label="Previous PDF page" disabled={page <= section.startPage} onClick={() => setPage(p => p - 1)}><ArrowLeft size={18} /></button><span aria-live="polite">Page {page}</span><button className="icon-button" aria-label="Next PDF page" disabled={page >= section.endPage} onClick={() => setPage(p => p + 1)}><ArrowRight size={18} /></button></div><a href={`${url}#page=${page}`} target="_blank" rel="noreferrer">Open PDF</a></div>
    <ErrorNotice error={error} />
    <div className="pdf-page" ref={container}>{busy && <Busy>Loading page…</Busy>}<canvas ref={canvas} hidden={busy || Boolean(error)} role="img" aria-label={`PDF page ${page}. Extracted text is available below the reader.`} /></div>
  </section>;
}
