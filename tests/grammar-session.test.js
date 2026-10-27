import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readGrammarSession, saveGrammarSession, resolveGrammarPosition } from '../src/grammar-session.js';

function storage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
}
const doc = { id: 'book', sections: [{ id: 'first', startPage: 1, endPage: 5 }, { id: 'second', startPage: 6, endPage: 12 }] };

test('grammar session restores the reference, section, and page separately for each language', () => {
  const session = storage();
  const position = { documentId: 'book', sectionId: 'second', page: 9 };
  saveGrammarSession('dutch', position, session);
  assert.deepEqual(readGrammarSession('dutch', session), position);
  assert.deepEqual(resolveGrammarPosition(doc, readGrammarSession('dutch', session)), position);
  assert.equal(readGrammarSession('turkish', session), null);
  saveGrammarSession('turkish', { documentId: 'other', sectionId: 'chapter', page: 4 }, session);
  saveGrammarSession('dutch', null, session);
  assert.equal(readGrammarSession('dutch', session), null);
  assert.equal(readGrammarSession('turkish', session).page, 4);
  assert.equal(readGrammarSession('dutch', storage()), null);
});

test('missing sections and different references start at the first section; edited ranges clamp the page', () => {
  const first = { documentId: 'book', sectionId: 'first', page: 1 };
  assert.deepEqual(resolveGrammarPosition(doc, null), first);
  assert.deepEqual(resolveGrammarPosition(doc, { documentId: 'deleted', sectionId: 'second', page: 9 }), first);
  assert.deepEqual(resolveGrammarPosition(doc, { documentId: 'book', sectionId: 'removed', page: 9 }), first);
  assert.equal(resolveGrammarPosition(doc, { documentId: 'book', sectionId: 'second', page: 30 }).page, 12);
  assert.equal(resolveGrammarPosition(doc, { documentId: 'book', sectionId: 'second', page: 1 }).page, 6);
  assert.equal(resolveGrammarPosition(doc, { documentId: 'book', sectionId: 'second' }).page, 6);
  assert.deepEqual(resolveGrammarPosition({ id: 'empty', sections: [] }, null), { documentId: 'empty', sectionId: null, page: null });
});

test('invalid or unavailable storage does not prevent opening Grammar', () => {
  const session = storage();
  session.setItem('lingua-grammar-session:dutch', '{invalid');
  assert.equal(readGrammarSession('dutch', session), null);
  session.setItem('lingua-grammar-session:dutch', JSON.stringify({ documentId: 42, sectionId: 'first' }));
  assert.equal(readGrammarSession('dutch', session), null);
  session.setItem('lingua-grammar-session:dutch', JSON.stringify({ documentId: 'book', sectionId: 'second', page: 'bad' }));
  assert.equal(resolveGrammarPosition(doc, readGrammarSession('dutch', session)).page, 6);
  const unavailable = { getItem() { throw new Error('Blocked'); }, setItem() { throw new Error('Full'); }, removeItem() { throw new Error('Blocked'); } };
  assert.equal(readGrammarSession('dutch', unavailable), null);
  assert.doesNotThrow(() => saveGrammarSession('dutch', { documentId: 'book' }, unavailable));
  assert.doesNotThrow(() => saveGrammarSession('dutch', null, unavailable));
});
