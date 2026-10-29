import { AppError } from './integrations.js';

export function createDictionaryLookup(fetcher = fetch) {
  const cache = new Map();
  return async function lookup(value) {
    const word = value.normalize('NFC').trim().toLocaleLowerCase('nl');
    if (!/^[\p{L}\p{M}]+(?:['’\-][\p{L}\p{M}]+)*$/u.test(word) || word.length > 80) {
      throw new AppError(400, 'Select a single Dutch word.');
    }
    const cached = cache.get(word);
    if (cached && cached.expires > Date.now()) return cached.result;
    let response;
    try {
      response = await fetcher(`https://freedictionaryapi.com/api/v1/entries/nl/${encodeURIComponent(word)}`, { signal: AbortSignal.timeout(10000) });
    } catch { throw new AppError(503, 'The dictionary could not be reached. Try again.'); }
    if (response.status === 429) throw new AppError(429, 'The dictionary request limit was reached. Try again later.');
    if (!response.ok && response.status !== 404) throw new AppError(502, 'The dictionary is unavailable. Try again.');
    let data;
    try { data = response.status === 404 ? {} : await response.json(); }
    catch { throw new AppError(502, 'The dictionary returned an invalid response. Try again.'); }
    const definitions = [];
    for (const entry of Array.isArray(data?.entries) ? data.entries : []) {
      if (entry.language?.code !== 'nl') continue;
      for (const sense of Array.isArray(entry.senses) ? entry.senses : []) {
        if (typeof sense.definition === 'string' && sense.definition.trim()) {
          definitions.push({ partOfSpeech: typeof entry.partOfSpeech === 'string' ? entry.partOfSpeech : '', definition: sense.definition });
        }
        if (definitions.length >= 12) break;
      }
      if (definitions.length >= 12) break;
    }
    const result = { word, definitions, sourceUrl: `https://en.wiktionary.org/wiki/${encodeURIComponent(word)}` };
    // Bound memory use and avoid repeated requests for the same word.
    if (cache.size >= 500) cache.delete(cache.keys().next().value);
    cache.set(word, { result, expires: Date.now() + 60 * 60 * 1000 });
    return result;
  };
}
