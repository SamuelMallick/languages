import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vocabularyLayout, formatVocabularyHtml } from '../src/anki-layout.js';

test('separates word, explicit type, and subsequent example lines', () => {
  assert.deepEqual(vocabularyLayout(['maar', 'conj.', 'Ik wil komen, maar ik heb geen tijd.']), {
    word: 'maar', type: 'conj.', inline: false, detailsFrom: 2,
  });
  assert.equal(vocabularyLayout(['ev', '(noun)', 'Bu benim evim.']).detailsFrom, 2);
  assert.equal(vocabularyLayout(['in spite of', 'prep.', 'An example.']).word, 'in spite of');
});

test('recognizes inline part-of-speech markers', () => {
  for (const marker of ['conj', '(conj.)', '[conjunction]']) {
    assert.deepEqual(vocabularyLayout([`maar ${marker}`, 'An example.']), {
      word: 'maar', type: marker === '[conjunction]' ? 'conjunction' : marker.includes('.') ? 'conj.' : 'conj', inline: true, detailsFrom: 1,
    });
  }
});

test('HTML formatting leaves an unknown Turkish template unchanged', () => {
  // A minimal DOM fixture for the read-only path. Rewriting must not occur.
  const body = {
    tagName: 'BODY', nodeType: 1,
    querySelector: () => null,
    childNodes: ['ev', 'house', 'Bu benim evim.'].map(text => ({
      tagName: 'DIV', nodeType: 1, childNodes: [{ nodeType: 3, textContent: text }],
    })),
  };
  const parser = { parseFromString: () => ({
    body,
    createElement: () => ({
      textContent: '',
      get innerHTML() { return this.textContent; },
      set innerHTML(value) { this.textContent = value; },
      append() { assert.fail('Unknown templates must not be rebuilt'); },
    }),
  }) };
  assert.equal(formatVocabularyHtml('<div>ev</div><div>house</div><div>Bu benim evim.</div>', parser), null);
});

test('answer separators inside template containers must not break their nesting', () => {
  const body = {};
  const separator = { parentElement: {} };
  body.querySelector = () => separator;
  body.querySelectorAll = () => [separator];
  const parser = { parseFromString: () => ({ body }) };
  assert.equal(formatVocabularyHtml('<div>ev<hr id="answer">house</div>', parser), null);
});

test('does not invent structure for unknown templates or ordinary sentences', () => {
  for (const lines of [[], ['hello'], ['hello', 'world'], ['ev', 'house', 'Bu benim evim.'], ['Translate this sentence.', 'An example.'], ['This is a very long question with many words', 'noun']]) {
    assert.equal(vocabularyLayout(lines), null);
  }
});
