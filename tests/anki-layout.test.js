import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vocabularyLayout } from '../src/anki-layout.js';

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

test('does not invent structure for unknown templates or ordinary sentences', () => {
  for (const lines of [[], ['hello'], ['hello', 'world'], ['Translate this sentence.', 'An example.'], ['This is a very long question with many words', 'noun']]) {
    assert.equal(vocabularyLayout(lines), null);
  }
});
