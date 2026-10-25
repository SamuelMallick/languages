// Recognize only explicit part-of-speech markers, not arbitrary short lines.
const typeName = '(?:conj(?:unction)?|n(?:oun)?|v(?:erb)?|adj(?:ective)?|adv(?:erb)?|prep(?:osition)?|pron(?:oun)?|det(?:erminer)?|art(?:icle)?|interj(?:ection)?|num(?:eral)?|aux(?:iliary)?)\\.?';
const typeOnly = new RegExp(`^\\s*[([]?\\s*(${typeName})\\s*[)\\]]?\\s*$`, 'i');
const trailingType = new RegExp(`^(.+?)\\s+(?:[([]\\s*(${typeName})\\s*[)\\]]|(${typeName}))\\s*$`, 'i');

export function vocabularyLayout(texts) {
  const lines = texts.map(text => text.trim());
  if (!lines.length) return null;
  const shortTerm = text => text.length <= 100 && text.split(/\s+/).length <= 6;
  if (lines.length >= 2 && shortTerm(lines[0]) && typeOnly.test(lines[1])) {
    return { word: lines[0], type: lines[1], inline: false, detailsFrom: 2 };
  }
  const match = lines[0].match(trailingType);
  if (match && shortTerm(match[1])) {
    return { word: match[1], type: match[2] || match[3], inline: true, detailsFrom: 1 };
  }
  // Unknown templates remain intact rather than guessing which text is an example.
  return null;
}

// Operates only on already-sanitized HTML. Preserve inline emphasis when turning
// common Anki div/p/br layouts into separate word, type, and example regions.
export function formatVocabularyHtml(clean, parser) {
  const doc = parser.parseFromString(clean, 'text/html');
  if (doc.body.querySelector('hr')) {
    const sections = clean.split(/<hr\b[^>]*>/i);
    return sections.map(section => formatVocabularyHtml(section, parser) || section).join('<hr>');
  }
  if (doc.body.querySelector('table, ul, ol, pre, img, audio, video, ruby')) return null;
  function parts(node) {
    if (node.nodeType === 3) {
      const span = doc.createElement('span'); span.textContent = node.textContent;
      return [span.innerHTML];
    }
    if (node.nodeType !== 1) return [''];
    if (node.tagName === 'BR') return ['', ''];
    let result = [''];
    for (const child of node.childNodes) {
      const next = parts(child);
      result[result.length - 1] += next[0];
      result.push(...next.slice(1));
    }
    if (['BODY', 'DIV', 'P', 'SECTION', 'H1', 'H2', 'H3'].includes(node.tagName)) {
      return node.tagName === 'BODY' ? result : ['', ...result, ''];
    }
    return result.map(html => {
      const clone = node.cloneNode(false); clone.innerHTML = html;
      return clone.outerHTML;
    });
  }
  const lines = parts(doc.body).map(html => {
    const element = doc.createElement('div'); element.innerHTML = html;
    return { html, text: element.textContent.trim() };
  }).filter(line => line.text);
  const layout = vocabularyLayout(lines.map(line => line.text));
  if (!layout) return null;
  const root = doc.createElement('div'); root.className = 'anki-vocabulary';
  function region(className, html, text) {
    const element = doc.createElement('div'); element.className = className;
    if (text !== undefined) element.textContent = text;
    else element.innerHTML = html;
    root.append(element);
  }
  region('anki-word', layout.inline ? null : lines[0].html, layout.inline ? layout.word : undefined);
  region('anki-type', null, layout.type);
  if (lines.length > layout.detailsFrom) {
    const examples = doc.createElement('div'); examples.className = 'anki-examples';
    for (const line of lines.slice(layout.detailsFrom)) {
      const paragraph = doc.createElement('p'); paragraph.innerHTML = line.html;
      examples.append(paragraph);
    }
    root.append(examples);
  }
  return root.outerHTML;
}
