// Country codes are also accepted when adding a language in the workspace.
export function speechLanguage(language) {
  const code = language.code.toLowerCase();
  return ({ jp: 'ja', cn: 'zh', kr: 'ko', gb: 'en', us: 'en', gr: 'el', cz: 'cs' })[code] || code;
}

export function normalizeDictation(text, locale) {
  return text.normalize('NFKC').toLocaleLowerCase(locale).replace(/[\p{P}\p{S}]/gu, '').replace(/\s+/gu, ' ').trim();
}

export function matchesDictation(answer, sentence, locale) {
  return normalizeDictation(answer, locale) === normalizeDictation(sentence, locale);
}
