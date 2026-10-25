export function mediaUrl(filename) {
  return `/api/anki/media?filename=${encodeURIComponent(filename)}`;
}

export async function replayAudio(audio) {
  // Seeking before metadata is available can fail in some browsers.
  if (audio.readyState > 0) audio.currentTime = 0;
  await audio.play();
}

// Call after sanitizing card HTML. Construct controls with DOM APIs so media
// filenames and card text can never become executable markup.
export function addAudioControls(clean, audioFiles, parser) {
  const doc = parser.parseFromString(clean, 'text/html');
  function audio(filename) {
    const element = doc.createElement('audio');
    element.preload = 'none'; element.setAttribute('src', mediaUrl(filename));
    return element;
  }
  const walker = doc.createTreeWalker(doc.body, 4);
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);
  for (const node of textNodes) {
    const pattern = /\[sound:([^\]]+)\]|\[{1,2}anki:play:([qa]):(\d+)\]{1,2}/g;
    const matches = [...node.textContent.matchAll(pattern)];
    if (!matches.length) continue;
    const fragment = doc.createDocumentFragment();
    let position = 0;
    for (const match of matches) {
      fragment.append(doc.createTextNode(node.textContent.slice(position, match.index)));
      const filename = match[1] || audioFiles?.[match[2]]?.[Number(match[3])];
      if (filename) fragment.append(audio(filename));
      else {
        const unavailable = doc.createElement('span');
        unavailable.className = 'small muted'; unavailable.textContent = 'Audio unavailable';
        fragment.append(unavailable);
      }
      position = match.index + match[0].length;
    }
    fragment.append(doc.createTextNode(node.textContent.slice(position)));
    node.replaceWith(fragment);
  }
  doc.querySelectorAll('audio').forEach(element => {
    const wrapper = doc.createElement('span'); wrapper.className = 'anki-audio';
    const button = doc.createElement('button');
    button.type = 'button'; button.className = 'audio-play';
    button.setAttribute('aria-label', 'Play audio');
    button.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>';
    element.removeAttribute('controls'); element.removeAttribute('autoplay');
    element.preload = 'none';
    element.replaceWith(wrapper); wrapper.append(button, element);
  });
  return doc.body.innerHTML;
}
