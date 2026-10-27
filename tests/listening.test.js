import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesDictation, speechLanguage } from '../shared/listening.js';

test('dictation ignores casing, punctuation, and spacing but preserves accents and words', () => {
  assert.ok(matchesDictation('  HALLO   wereld ', 'Hallo, wereld!', 'nl'));
  assert.ok(matchesDictation('cafe\u0301', 'Café.', 'fr'));
  assert.ok(matchesDictation('ışık', 'IŞIK.', 'tr'));
  assert.ok(!matchesDictation('cafe', 'Café.', 'fr'));
  assert.ok(!matchesDictation('Hallo', 'Hallo wereld.', 'nl'));
});

test('speech languages accept workspace country codes', () => {
  assert.equal(speechLanguage({ code: 'JP' }), 'ja');
  assert.equal(speechLanguage({ code: 'NL' }), 'nl');
  assert.equal(speechLanguage({ code: 'TR' }), 'tr');
});
