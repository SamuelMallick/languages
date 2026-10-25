// Newer Anki renders sound tags as [anki:play:q:0] / [anki:play:a:0].
// Resolve indices from template order, not note field order (which may differ).
export function cardAudioFiles(card, templates) {
  const template = templates?.[card.template];
  if (!template) return { q: [], a: [] };
  function files(source) {
    let html = source || '';
    let previous;
    do {
      previous = html;
      html = html.replace(/{{([#^])([^{}]+)}}((?:(?!{{[#^])[\s\S])*?){{\/\2}}/g, (_, mode, name, body) => {
        const present = Boolean(card.fields?.[name]?.value?.trim());
        return present === (mode === '#') ? body : '';
      });
    } while (html !== previous);
    // Unknown conditionals or TTS cannot safely be mapped to file indices.
    if (/{{[#^]|{{tts[:\s]/i.test(html)) return [];
    html = html.replace(/{{([^{}]+)}}/g, (_, name) => {
      if (name === 'FrontSide') return '';
      return card.fields?.[name]?.value || '';
    });
    return [...html.matchAll(/\[sound:([^\]]+)\]/g)].map(match => match[1]);
  }
  return { q: files(template.Front), a: files(template.Back) };
}
