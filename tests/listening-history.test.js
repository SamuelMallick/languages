import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createStore } from '../server/store.js';
import { generateListening, similarSentence } from '../server/listening.js';

function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'listening-test-'));
  let store = createStore(directory);
  t.after(() => { store.db.close(); rmSync(directory, { recursive: true, force: true }); });
  return {
    get store() { return store; },
    reopen() { store.db.close(); store = createStore(directory); },
    async generate(results, extra = {}) {
      const calls = [];
      const integrations = { tutor: async args => {
        calls.push(args);
        const sentence = results[Math.min(calls.length - 1, results.length - 1)];
        return JSON.stringify({ sentence, translation: 'English translation.' });
      } };
      const result = await generateListening({ store, integrations, language: store.get('SELECT * FROM languages WHERE id=?', extra.languageId || 'dutch'), level: 'A1', previous: [], instructions: '', ...extra });
      return { result, calls };
    },
  };
}

test('listening history survives a database reopen and retries normalized duplicates', async t => {
  const f = fixture(t);
  await f.generate(['Ik ga naar huis.']);
  f.reopen();
  const { result, calls } = await f.generate(['  IK ga naar huis! ', 'De trein is laat.']);
  assert.equal(result.sentence, 'De trein is laat.');
  assert.equal(calls.length, 2);
  assert.ok(calls[0].messages[0].content.includes('Ik ga naar huis.'));
  assert.ok(calls[1].messages[0].content.includes('last candidate was a duplicate'));
  assert.equal(f.store.get('SELECT COUNT(*) AS count FROM listening_history').count, 2);
});

test('normalized checks cover all stored history, not just the prompt window', async t => {
  const f = fixture(t);
  await f.generate(['Oude zin.']);
  for (let i = 0; i < 210; i++) {
    f.store.run('INSERT INTO listening_history (languageId, sentence, normalized, topic, createdAt) VALUES (?, ?, ?, ?, ?)', 'dutch', `zin ${i}`, `zin ${i}`, 'food', new Date().toISOString());
  }
  const { result, calls } = await f.generate(['OUDE ZIN!', 'Nieuwe zin.']);
  assert.equal(result.sentence, 'Nieuwe zin.');
  assert.equal(calls.length, 2);
});

test('history is language-specific and removed with the language', async t => {
  const f = fixture(t);
  await f.generate(['Hallo.']);
  await f.generate(['Hallo.'], { languageId: 'turkish' });
  f.store.run('DELETE FROM languages WHERE id=?', 'dutch');
  assert.equal(f.store.get('SELECT COUNT(*) AS count FROM listening_history').count, 1);
});

test('duplicate retries are bounded and unsuccessful candidates are not stored', async t => {
  const f = fixture(t);
  let calls = 0;
  await assert.rejects(generateListening({ store: f.store, language: f.store.get('SELECT * FROM languages WHERE id=?', 'dutch'), level: 'A1', previous: ['Hallo.'], instructions: '', integrations: { tutor: async () => { calls++; return JSON.stringify({ sentence: 'HALLO!', translation: 'Hello!' }); } } }), /three attempts/);
  assert.equal(calls, 3);
  assert.equal(f.store.get('SELECT COUNT(*) AS count FROM listening_history').count, 0);
});

test('recent topic rotation and near-duplicate rejection', async t => {
  const f = fixture(t);
  const first = 'Ik ga morgen met mijn zus naar de winkel.';
  await f.generate([first]);
  const topic = f.store.get('SELECT topic FROM listening_history').topic;
  const { calls } = await f.generate(['Ik ga morgen met mijn broer naar de winkel.', 'De hond slaapt.']);
  assert.equal(calls.length, 2);
  assert.ok(!calls[0].messages[0].content.includes(`use the topic ${topic} and situation`));
  assert.equal(similarSentence('ik eet brood', 'ik eet kaas'), false);
  assert.equal(similarSentence('café', 'cafe'), false);
});

test('overlapping generation cannot save the same normalized sentence twice', async t => {
  const f = fixture(t);
  const results = await Promise.all([f.generate(['Hallo.', 'Dag.']), f.generate(['Hallo.', 'Tot ziens.'])]);
  assert.equal(new Set(results.map(value => value.result.sentence)).size, 2);
  assert.equal(f.store.get('SELECT COUNT(*) AS count FROM listening_history').count, 2);
});
