import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { createDictionaryLookup } from '../server/dictionary.js';

const payload = { entries: [
  { language: { code: 'en' }, senses: [{ definition: 'Not a Dutch entry.' }] },
  { language: { code: 'nl' }, partOfSpeech: 'noun', senses: [{ definition: 'a book' }, { definition: 'a written work' }] },
] };

test('dictionary requests Dutch entries, extracts English definitions, and caches normalized words', async () => {
  const calls = [];
  const lookup = createDictionaryLookup(async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => payload };
  });
  const result = await lookup('Boek');
  assert.equal(calls[0].url, 'https://freedictionaryapi.com/api/v1/entries/nl/boek');
  assert.ok(calls[0].options.signal);
  assert.deepEqual(result.definitions, [{ partOfSpeech: 'noun', definition: 'a book' }, { partOfSpeech: 'noun', definition: 'a written work' }]);
  assert.equal(result.sourceUrl, 'https://en.wiktionary.org/wiki/boek');
  assert.deepEqual(await lookup('boek'), result);
  assert.equal(calls.length, 1);
  for (const word of ['two words', '../secret', '<script>', '', 'x'.repeat(81)]) {
    await assert.rejects(lookup(word), error => error.status === 400);
  }
  assert.equal(calls.length, 1);
});

test('dictionary handles missing entries, rate limits, network failures, and invalid responses', async () => {
  const missing = createDictionaryLookup(async () => ({ ok: false, status: 404 }));
  assert.deepEqual((await missing('onbekend')).definitions, []);
  for (const [response, status] of [[{ ok: false, status: 429 }, 429], [{ ok: false, status: 500 }, 502], [{ ok: true, json: async () => { throw new Error(); } }, 502]]) {
    await assert.rejects(createDictionaryLookup(async () => response)('boek'), error => error.status === status);
  }
  await assert.rejects(createDictionaryLookup(async () => { throw new Error(); })('boek'), error => error.status === 503);
  assert.deepEqual((await createDictionaryLookup(async () => ({ ok: true, json: async () => ({}) }))('boek')).definitions, []);
});

test('Dutch practice messages offer keyboard-accessible lookups while preserving Markdown and exercise forms', async t => {
  const vite = await createServer({ server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom' });
  t.after(() => vite.close());
  const { ChatMarkdown, DictionaryProvider } = await vite.ssrLoadModule('/src/Dictionary.jsx');
  const markdown = '**boeken** en [link](https://example.com) `code` café, één!';
  const html = renderToStaticMarkup(createElement(DictionaryProvider, { enabled: true }, createElement(ChatMarkdown, null, markdown)));
  assert.ok(html.includes('<strong><button type="button" class="dictionary-word"'));
  assert.ok(html.includes('aria-label="English definition of boeken"'));
  assert.ok(html.includes('English definition of café'));
  assert.ok(html.includes('English definition of één'));
  assert.ok(html.includes('<a href="https://example.com">link</a>'));
  assert.ok(html.includes('<code>code</code>'));
  assert.ok(!html.includes('English definition of link'));
  assert.ok(!html.includes('English definition of code'));
  const plain = renderToStaticMarkup(createElement(ChatMarkdown, null, markdown));
  assert.ok(!plain.includes('dictionary-word'));
  const { default: ExerciseMessage } = await vite.ssrLoadModule('/src/ExerciseMessage.jsx');
  const exercise = renderToStaticMarkup(createElement(DictionaryProvider, { enabled: true }, createElement(ExerciseMessage, { message: { id: 'q', content: '<practice-question>Vertaal boeken.</practice-question>' } })));
  assert.ok(exercise.includes('English definition of boeken'));
  assert.ok(exercise.includes('<textarea'));
  assert.ok(exercise.includes('Check answers'));
  const { default: Chat } = await vite.ssrLoadModule('/src/Chat.jsx');
  for (const [code, grammar, enabled] of [['NL', false, true], ['TR', false, false], ['NL', true, false]]) {
    const chat = renderToStaticMarkup(createElement(Chat, { initial: { id: 'chat', messages: [{ id: 'm', role: 'assistant', content: 'Hallo!' }] }, language: { name: 'Dutch', code }, grammar, tutorReady: true }));
    assert.equal(chat.includes('English definition of Hallo'), enabled);
    assert.equal(chat.includes('Only that word is shared'), enabled);
  }
});
