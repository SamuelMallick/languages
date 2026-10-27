const key = languageId => `lingua-grammar-session:${languageId}`;

export function readGrammarSession(languageId, storage) {
  try {
    storage ??= globalThis.sessionStorage;
    const value = JSON.parse(storage.getItem(key(languageId)));
    if (!value || typeof value.documentId !== 'string' || typeof value.sectionId !== 'string') return null;
    return { documentId: value.documentId, sectionId: value.sectionId, page: Number.isInteger(value.page) ? value.page : undefined };
  } catch { return null; }
}

export function saveGrammarSession(languageId, position, storage) {
  try {
    storage ??= globalThis.sessionStorage;
    if (position) storage.setItem(key(languageId), JSON.stringify(position));
    else storage.removeItem(key(languageId));
  } catch { /* Reading still works if session storage is unavailable or full. */ }
}

export function resolveGrammarPosition(document, saved) {
  const section = (saved?.documentId === document.id && document.sections.find(s => s.id === saved.sectionId)) || document.sections[0];
  if (!section) return { documentId: document.id, sectionId: null, page: null };
  const page = saved?.documentId === document.id && saved.sectionId === section.id && Number.isInteger(saved.page) ? saved.page : section.startPage;
  return { documentId: document.id, sectionId: section.id, page: Math.max(section.startPage, Math.min(section.endPage, page)) };
}
