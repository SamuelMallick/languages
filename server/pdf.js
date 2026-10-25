import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { id } from './store.js';

// Keep the outline editable: PDF bookmarks are useful, but not always accurate.
export function assignRanges(entries, pageCount) {
  return entries.map((entry, i) => {
    const next = entries.slice(i + 1).find(e => e.depth <= entry.depth && e.startPage > entry.startPage);
    return { ...entry, endPage: next ? next.startPage - 1 : pageCount, completed: false };
  });
}

export async function extractPdf(buffer) {
  const task = getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, useSystemFonts: true });
  let pdf;
  try {
    pdf = await task.promise;
    if (pdf.numPages > 600) throw new Error('Please upload a PDF with at most 600 pages. Split larger books into volumes.');
    const pages = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      let text = '';
      for (const item of content.items) {
        if ('str' in item) text += item.str + (item.hasEOL ? '\n' : ' ');
      }
      pages.push({ page: n, text: text.trim() });
      page.cleanup();
    }
    const entries = [];
    async function walk(items, depth = 0) {
      for (const item of items || []) {
        try {
          const dest = typeof item.dest === 'string' ? await pdf.getDestination(item.dest) : item.dest;
          if (dest?.[0] !== undefined) {
            const page = typeof dest[0] === 'number' ? dest[0] : await pdf.getPageIndex(dest[0]);
            entries.push({ id: id(), title: item.title || 'Untitled section', startPage: page + 1, depth: Math.min(depth, 6) });
          }
        } catch { /* An invalid bookmark should not prevent reading the book. */ }
        await walk(item.items, depth + 1);
      }
    }
    await walk(await pdf.getOutline());
    const hasOutline = entries.length > 0;
    if (!hasOutline) {
      // Never invent chapter boundaries for a PDF without bookmarks.
      for (let start = 1; start <= pdf.numPages; start += 5) {
        entries.push({ id: id(), title: `Pages ${start}–${Math.min(start + 4, pdf.numPages)}`, startPage: start, depth: 0 });
      }
    }
    return { pages, sections: assignRanges(entries, pdf.numPages), pageCount: pdf.numPages, outlineSource: hasOutline ? 'bookmarks' : 'page groups' };
  } finally {
    await task.destroy();
  }
}

export function sectionContext(doc, section, maxChars = 32000) {
  const pages = JSON.parse(doc.pages).filter(p => p.page >= section.startPage && p.page <= section.endPage);
  const full = pages.map(p => `[Page ${p.page}]\n${p.text}`).join('\n\n');
  if (!pages.some(p => p.text.trim())) throw new Error('This section has no extractable text. Run OCR on the PDF and upload the text-enabled version.');
  return { text: full.slice(0, maxChars), truncated: full.length > maxChars };
}
