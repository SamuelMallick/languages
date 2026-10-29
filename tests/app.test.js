import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { get as httpGet } from 'node:http';
import { PDFDocument, StandardFonts, PDFName, PDFString } from 'pdf-lib';
import { createStore } from '../server/store.js';
import { createApp } from '../server/app.js';
import { makeIntegrations, validateLocalUrl, AppError } from '../server/integrations.js';
import { assignRanges, extractPdf, sectionContext } from '../server/pdf.js';

async function fixture(t, integrations, dictionaryLookup) {
  const directory = mkdtempSync(path.join(tmpdir(), 'lingua-test-'));
  const store = createStore(directory);
  const server = createApp(store, integrations, null, {}, dictionaryLookup).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); store.db.close();
    // Only remove the exact disposable directory created by this test.
    assert.equal(path.dirname(directory), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith('lingua-test-'));
    rmSync(directory, { recursive: true, force: true });
  });
  async function request(route, options = {}) {
    const body = options.body;
    const response = await fetch(`${base}/api${route}`, { ...options,
      headers: body instanceof FormData ? options.headers : { 'Content-Type': 'application/json', ...options.headers },
      ...(body !== undefined ? { body: body instanceof FormData ? body : JSON.stringify(body) } : {}),
    });
    return { status: response.status, data: await response.json() };
  }
  return { store, request, base };
}

test('listening generates the sentence and translation in one model call with student feedback', async t => {
  const calls = [];
  const pair = { sentence: 'Ik ga morgen naar de winkel.', translation: 'I am going to the shop tomorrow.' };
  const { request } = await fixture(t, { tutor: async args => { calls.push(args); return JSON.stringify(pair); } });
  const route = '/languages/dutch/listening';
  const instructions = 'Use shorter sentences about shopping, with past tense.';
  const generated = await request(route, { method: 'POST', body: { level: 'A2', previous: ['Hallo wereld.'], instructions } });
  assert.equal(generated.status, 200);
  assert.deepEqual(generated.data, { ...pair, level: 'A2' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].language.name, 'Dutch');
  assert.equal(calls[0].tutorLevel, 'A2');
  assert.ok(calls[0].messages[0].content.includes('Hallo wereld.'));
  assert.ok(calls[0].messages[0].content.includes(instructions));
  assert.ok(calls[0].tutorInstructions.includes('English translation'));
  assert.ok(calls[0].tutorInstructions.includes('untrusted study data'));
  assert.equal((await request('/languages/dutch/chats')).data.length, 0);
  // History applies across levels, even when the client sends no history.
  assert.equal((await request(route, { method: 'POST', body: { level: 'B1' } })).status, 502);
  assert.equal(calls.length, 4);
  for (const body of [{ level: '' }, { level: 'B3' }, { level: 'A1', instructions: 'x'.repeat(2001) }, { level: 'A1', instructions: 42 }]) {
    assert.equal((await request(route, { method: 'POST', body })).status, 400);
  }
  assert.equal((await request('/languages/missing/listening', { method: 'POST', body: { level: 'A1' } })).status, 404);
  assert.equal((await request(route, { method: 'POST', body: { level: 'A1', previous: [pair.sentence] } })).status, 502);
});

test('listening rejects malformed or incomplete generated sentence/translation pairs', async t => {
  let result;
  const { request } = await fixture(t, { tutor: async () => result });
  const pair = { sentence: 'Hallo.', translation: 'Hello.' };
  const invalid = ['', 'Not JSON', 'null', '[]', '{}',
    JSON.stringify({ sentence: pair.sentence }),
    JSON.stringify({ ...pair, sentence: '' }),
    JSON.stringify({ ...pair, sentence: 'x'.repeat(601) }),
    JSON.stringify({ ...pair, sentence: 'Hallo.\nDag.' }),
    JSON.stringify({ ...pair, translation: '   ' }),
    JSON.stringify({ ...pair, translation: 42 }),
    JSON.stringify({ ...pair, translation: 'x'.repeat(1201) }),
    JSON.stringify({ ...pair, translation: 'Hello.\nGoodbye.' })];
  for (result of invalid) {
    assert.equal((await request('/languages/dutch/listening', { method: 'POST', body: { level: 'A1' } })).status, 502);
  }
  result = '```json\n' + JSON.stringify(pair) + '\n```';
  const generated = await request('/languages/dutch/listening', { method: 'POST', body: { level: 'A1' } });
  assert.equal(generated.status, 200);
  assert.deepEqual(generated.data, { ...pair, level: 'A1' });
});

test('listening generation provider failures can be retried', async t => {
  let fail = true;
  const { request } = await fixture(t, { tutor: async () => {
    if (fail) throw new AppError(503, 'Tutor is unavailable.');
    return JSON.stringify({ sentence: 'Hallo.', translation: 'Hello.' });
  } });
  const route = '/languages/dutch/listening';
  const body = { level: 'A1' };
  assert.equal((await request(route, { method: 'POST', body })).status, 503);
  fail = false;
  assert.equal((await request(route, { method: 'POST', body })).data.translation, 'Hello.');
});

test('dictionary route returns definitions without sending chat data', async t => {
  const calls = [];
  const result = { word: 'boek', definitions: [{ partOfSpeech: 'noun', definition: 'a book' }], sourceUrl: 'https://en.wiktionary.org/wiki/boek' };
  const { request } = await fixture(t, {}, async word => { calls.push(word); return result; });
  const response = await request('/dictionary/nl/boek');
  assert.equal(response.status, 200);
  assert.deepEqual(response.data, result);
  assert.deepEqual(calls, ['boek']);
  assert.equal((await request('/dictionary/tr/boek')).status, 404);
});

test('practice instruction defaults apply only to future chats in the same language', async t => {
  const { request, store } = await fixture(t, {});
  const createChat = async (languageId = 'dutch') => (await request('/chats', { method: 'POST', body: { languageId } })).data;
  const existing = await createChat();
  const current = await createChat();
  const instructions = 'Speak Dutch and explain corrections in English.';
  const save = body => request(`/chats/${current.id}/tutor`, { method: 'PATCH', body });
  const saved = await save({ tutorInstructions: instructions, tutorLevel: 'A2', saveAsDefault: true });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.tutorInstructions, instructions);
  assert.equal(store.get('SELECT tutorInstructions FROM practice_defaults WHERE languageId=?', 'dutch').tutorInstructions, instructions);
  const next = await createChat();
  assert.equal(next.tutorInstructions, instructions);
  assert.equal(next.tutorLevel, '');
  assert.equal((await request(`/chats/${existing.id}`)).data.tutorInstructions, existing.tutorInstructions);
  assert.equal((await createChat('turkish')).tutorInstructions, existing.tutorInstructions);
  await save({ tutorInstructions: 'Only for this conversation.', tutorLevel: '' });
  assert.equal((await createChat()).tutorInstructions, instructions);
  assert.equal((await save({ tutorInstructions: instructions, tutorLevel: '', saveAsDefault: 'yes' })).status, 400);
  // An explicitly blank default is preserved rather than replaced by built-in instructions.
  await save({ tutorInstructions: '', tutorLevel: '', saveAsDefault: true });
  assert.equal((await createChat()).tutorInstructions, '');
});

test('per-conversation tutor settings persist, validate, and reach both providers', async t => {
  let received;
  const { request } = await fixture(t, { tutor: async value => { received = value; return 'Hallo'; } });
  const first = (await request('/chats', { method: 'POST', body: { languageId: 'dutch' } })).data;
  const second = (await request('/chats', { method: 'POST', body: { languageId: 'dutch' } })).data;
  assert.ok(first.tutorInstructions.includes('gently correct'));
  const body = { tutorInstructions: 'Speak Dutch and correct every mistake.', tutorLevel: 'A2' };
  assert.equal((await request(`/chats/${first.id}/tutor`, { method: 'PATCH', body })).status, 200);
  assert.equal((await request(`/chats/${first.id}`)).data.tutorLevel, 'A2');
  assert.equal((await request(`/chats/${second.id}`)).data.tutorLevel, '');
  assert.equal((await request(`/chats/${first.id}/tutor`, { method: 'PATCH', body: { ...body, tutorLevel: 'invalid' } })).status, 400);
  assert.equal((await request(`/chats/${first.id}/tutor`, { method: 'PATCH', body: { ...body, tutorInstructions: 'x'.repeat(8001) } })).status, 400);
  await request(`/chats/${first.id}/messages`, { method: 'POST', body: { content: 'Hallo' } });
  assert.equal(received.tutorInstructions, body.tutorInstructions);
  assert.equal(received.tutorLevel, 'A2');
  let system;
  const args = { ...received, settings: { provider: 'chatgpt' } };
  await makeIntegrations(undefined, { respond: async payload => { system = payload.instructions; return 'ok'; } }).tutor(args);
  assert.ok(system.includes(body.tutorInstructions)); assert.ok(system.includes('Assume CEFR level A2'));
  await makeIntegrations(async (url, options) => { system = JSON.parse(options.body).messages[0].content; return { ok: true, json: async () => ({ message: { content: 'ok' } }) }; }).tutor({ ...args, settings: { provider: 'ollama', ollamaUrl: 'http://localhost:11434', ollamaModel: 'test' } });
  assert.ok(system.includes(body.tutorInstructions)); assert.ok(system.includes('Assume CEFR level A2'));
});

async function samplePdf(bookmarks = false) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const text of ['Chapter 1: Dutch articles. Use de with common nouns.', 'Section 1.1: Use het with neuter nouns. Het huis means the house.', 'Chapter 2: Word order. The finite verb comes second.']) {
    pdf.addPage([500, 700]).drawText(text, { x: 40, y: 650, size: 10, font });
  }
  if (bookmarks) {
    const outline = pdf.context.obj({ Type: 'Outlines', Count: 2 });
    const outlineRef = pdf.context.register(outline);
    const first = pdf.context.obj({ Title: PDFString.of('Articles'), Parent: outlineRef, Dest: [pdf.getPages()[0].ref, PDFName.of('Fit')] });
    const second = pdf.context.obj({ Title: PDFString.of('Word order'), Parent: outlineRef, Dest: [pdf.getPages()[2].ref, PDFName.of('Fit')] });
    const firstRef = pdf.context.register(first); const secondRef = pdf.context.register(second);
    first.set(PDFName.of('Next'), secondRef); second.set(PDFName.of('Prev'), firstRef);
    outline.set(PDFName.of('First'), firstRef); outline.set(PDFName.of('Last'), secondRef);
    pdf.catalog.set(PDFName.of('Outlines'), outlineRef);
  }
  return Buffer.from(await pdf.save());
}

test('local access protection, validation, settings secrecy, and language separation', async t => {
  const { request, base, store } = await fixture(t);
  const initial = await request('/bootstrap');
  assert.deepEqual(initial.data.languages.map(l => l.name), ['Dutch', 'Turkish']);
  assert.equal((await request('/bootstrap', { headers: { Origin: 'https://untrusted.example' } })).status, 403);
  // Node fetch replaces Host; use the HTTP client to exercise DNS-rebinding protection.
  const hostStatus = await new Promise((resolve, reject) => {
    httpGet(`${base}/api/bootstrap`, { headers: { Host: 'untrusted.example' } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject);
  });
  assert.equal(hostStatus, 403);
  assert.equal((await request('/languages', { method: 'POST', body: { name: '' } })).status, 400);
  assert.equal((await request('/languages', { method: 'POST', body: { name: 'dUtCh', nativeName: 'Dutch', code: 'NL' } })).status, 409);
  const language = await request('/languages', { method: 'POST', body: { name: 'Italian', nativeName: 'Italiano', code: 'IT' } });
  assert.equal(language.status, 201);
  assert.equal('level' in language.data, false);
  assert.ok((await request('/bootstrap')).data.languages.every(l => !('level' in l)));
  store.saveSettings({ provider: 'openai', apiKey: 'fake-test-key' });
  assert.equal(store.settings().provider, 'chatgpt');
  assert.equal(store.settings().apiKey, undefined);
  assert.equal((await request('/settings', { method: 'PUT', body: { provider: 'openai', model: 'test-model', ollamaModel: 'local', ollamaUrl: 'http://127.0.0.1:11434' } })).status, 400);
  const settings = await request('/settings', { method: 'PUT', body: { provider: 'chatgpt', chatgptModel: '', ollamaModel: 'local', ollamaUrl: 'http://127.0.0.1:11434', ankiKey: 'fake-anki-key' } });
  assert.equal(settings.status, 200); assert.equal(settings.data.apiKey, undefined);
  assert.equal(settings.data.hasAnkiKey, true); assert.equal(settings.data.ankiKey, undefined);
  assert.ok(!JSON.stringify((await request('/bootstrap')).data).includes('fake-test-key'));
  const invalid = await request('/settings', { method: 'PUT', body: { ...settings.data, ollamaUrl: 'https://external.example' } });
  assert.equal(invalid.status, 400);
  assert.equal((await request('/languages/turkish/chats')).data.length, 0);
});

test('PDF extraction reads real bookmarks and safely falls back to page groups', async () => {
  const bookmarked = await extractPdf(await samplePdf(true));
  assert.equal(bookmarked.pageCount, 3);
  assert.equal(bookmarked.outlineSource, 'bookmarks');
  assert.deepEqual(bookmarked.sections.map(s => [s.title, s.startPage, s.endPage]), [['Articles', 1, 2], ['Word order', 3, 3]]);
  assert.match(bookmarked.pages[1].text, /het with neuter/);
  const plain = await extractPdf(await samplePdf());
  assert.equal(plain.outlineSource, 'page groups');
  assert.equal(plain.sections[0].title, 'Pages 1–3');
  const ranges = assignRanges([{ startPage: 1, depth: 0 }, { startPage: 2, depth: 1 }, { startPage: 4, depth: 1 }, { startPage: 8, depth: 0 }], 10);
  assert.deepEqual(ranges.map(s => s.endPage), [7, 3, 7, 10]);
  assert.throws(() => sectionContext({ pages: JSON.stringify([{ page: 1, text: '' }]) }, { startPage: 1, endPage: 1 }), /OCR/);
});

test('upload, selected section context, saved discussions, range edits, and cascade deletion', async t => {
  const calls = [];
  const { request, store } = await fixture(t, { tutor: async args => { calls.push(args); return 'Use de for common nouns (page 1).'; } });
  const invalidForm = new FormData(); invalidForm.set('file', new Blob(['not a PDF']), 'invalid.pdf');
  assert.equal((await request('/languages/dutch/documents', { method: 'POST', body: invalidForm })).status, 400);
  const form = new FormData(); form.set('file', new Blob([await samplePdf(true)], { type: 'application/pdf' }), 'Dutch grammar.pdf');
  const uploaded = await request('/languages/dutch/documents', { method: 'POST', body: form });
  assert.equal(uploaded.status, 201);
  const doc = uploaded.data;
  assert.equal((await request('/languages/turkish/documents')).data.length, 0);
  assert.equal((await request('/languages/dutch/documents')).data.length, 1);
  assert.equal((await request('/chats', { method: 'POST', body: { languageId: 'turkish', documentId: doc.id, sectionId: doc.sections[0].id } })).status, 400);
  const create = () => request('/chats', { method: 'POST', body: { languageId: 'dutch', documentId: doc.id, sectionId: doc.sections[0].id } });
  const { data: chat } = await create();
  assert.equal((await create()).data.id, chat.id);
  const message = await request(`/chats/${chat.id}/messages`, { method: 'POST', body: { content: 'Summarize this section.' } });
  assert.equal(message.status, 200); assert.equal(message.data.messages.length, 2);
  assert.match(calls[0].context.text, /Page 2/); assert.doesNotMatch(calls[0].context.text, /Word order/);
  assert.equal(calls[0].language.name, 'Dutch');
  assert.equal((await request(`/chats/${chat.id}`)).data.messages[1].content, 'Use de for common nouns (page 1).');
  const reopened = createStore(store.directory);
  assert.equal(JSON.parse(reopened.get('SELECT messages FROM chats WHERE id=?', chat.id).messages).length, 2); reopened.db.close();
  const badRange = { ...doc.sections[0], endPage: 100 };
  assert.equal((await request(`/documents/${doc.id}`, { method: 'PATCH', body: { title: doc.title, sections: [badRange] } })).status, 400);
  const edited = await request(`/documents/${doc.id}`, { method: 'PATCH', body: { title: doc.title, sections: doc.sections.map((s, i) => i === 0 ? { ...s, endPage: 1 } : s) } });
  assert.equal(edited.status, 200); assert.equal((await request(`/chats/${chat.id}`)).status, 404);
  const anotherChat = await create(); assert.notEqual(anotherChat.data.id, chat.id);
  assert.equal((await request(`/documents/${doc.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await request(`/chats/${anotherChat.data.id}`)).status, 404);
});

test('practice and grammar questions accept per-question answers, persist them, and retain transcripts on failure', async t => {
  const questions = '<practice-question>Fill the gap: Ik ___ een boek. (lezen)</practice-question>\n<practice-question>Translate: I have a cat.</practice-question>';
  let received;
  let fail = false;
  const { request } = await fixture(t, { tutor: async args => {
    received = args;
    if (fail) throw new AppError(503, 'Tutor unavailable.');
    return args.messages.at(-1).content.includes('My answer:') ? 'Both answers are correct.' : questions;
  } });
  const file = new FormData(); file.append('file', new Blob([await samplePdf()], { type: 'application/pdf' }), 'grammar.pdf');
  const { data: doc } = await request('/languages/dutch/documents', { method: 'POST', body: file });
  for (const grammar of [false, true]) {
    const { data: chat } = await request('/chats', { method: 'POST', body: { languageId: 'dutch', ...(grammar ? { documentId: doc.id, sectionId: doc.sections[0].id } : {}) } });
    const route = `/chats/${chat.id}/messages`;
    for (const body of [{ action: 'unknown' }, { action: 'generate-practice', content: 'Override prompt' }]) {
      assert.equal((await request(route, { method: 'POST', body })).status, 400);
    }
    fail = true;
    assert.equal((await request(route, { method: 'POST', body: { action: 'generate-practice' } })).status, 503);
    assert.equal((await request(`/chats/${chat.id}`)).data.messages.length, 0);
    fail = false;
    const generated = await request(route, { method: 'POST', body: { action: 'generate-practice' } });
    assert.equal(generated.status, 200);
    assert.equal(generated.data.messages[0].action, 'generate-practice');
    assert.ok(received.messages.at(-1).content.includes(grammar ? 'exercises for this section' : 'practice questions in Dutch'));
    if (!grammar) assert.equal(generated.data.title, 'Practice questions');
    assert.equal(received.interactiveExercises, true);
    assert.equal(Boolean(received.context), grammar);
    const messageId = generated.data.messages[1].id;
    const exercise = { messageId, answers: ['lees', 'Ik heb een kat.'] };
    for (const invalid of [{ messageId: 'other-chat', answers: exercise.answers }, { messageId: generated.data.messages[0].id, answers: exercise.answers }, { messageId, answers: ['lees'] }, { messageId, answers: ['', 'Ik heb een kat.'] }, { messageId, answers: ['x'.repeat(1001), 'ok'] }]) {
      assert.equal((await request(route, { method: 'POST', body: { exercise: invalid } })).status, 400);
    }
    fail = true;
    assert.equal((await request(route, { method: 'POST', body: { exercise } })).status, 503);
    assert.equal((await request(`/chats/${chat.id}`)).data.messages.length, 2);
    fail = false;
    const submitted = await request(route, { method: 'POST', body: { exercise } });
    assert.equal(submitted.status, 200);
    assert.ok(received.messages.at(-1).content.includes('Fill the gap: Ik ___ een boek. (lezen)\nMy answer: lees'));
    assert.ok(received.messages.at(-1).content.includes('Translate: I have a cat.\nMy answer: Ik heb een kat.'));
    const saved = (await request(`/chats/${chat.id}`)).data;
    assert.equal(saved.messages[0].action, 'generate-practice');
    assert.deepEqual(saved.messages[2].exercise, exercise);
    assert.equal(saved.messages[3].content, 'Both answers are correct.');
    assert.equal(saved.messages.length, 4);
  }
});

test('chat failures preserve the prior transcript and concurrent messages are rejected', async t => {
  let reject; let mode = 'success';
  const { request } = await fixture(t, { tutor: async () => {
    if (mode === 'wait') return new Promise((_, no) => { reject = no; });
    return 'Hallo! Hoe gaat het?';
  } });
  const { data: chat } = await request('/chats', { method: 'POST', body: { languageId: 'dutch' } });
  await request(`/chats/${chat.id}/messages`, { method: 'POST', body: { content: 'Hallo' } });
  mode = 'wait';
  const inFlight = request(`/chats/${chat.id}/messages`, { method: 'POST', body: { content: 'Help me.' } });
  while (!reject) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal((await request(`/chats/${chat.id}/messages`, { method: 'POST', body: { content: 'Duplicate' } })).status, 409);
  assert.equal((await request(`/chats/${chat.id}`, { method: 'DELETE' })).status, 409);
  reject(new AppError(503, 'Test provider unavailable'));
  assert.equal((await inFlight).status, 503);
  assert.equal((await request(`/chats/${chat.id}`)).data.messages.length, 2);
  assert.equal((await request('/languages/turkish/chats')).data.length, 0);
});

test('Anki reviews require a space-triggered reveal, respect scheduler order, and reject stale or repeated ratings', async t => {
  const actions = []; let current = { cardId: 10, question: 'hallo', answer: 'hello [anki:play:a:0]', template: 'Basic', modelName: 'Vocabulary', fields: { Audio: { value: '[sound:hello.mp3]', order: 0 } }, buttons: [1, 2, 3, 4] };
  const { request } = await fixture(t, { anki: async (action, params) => {
    actions.push({ action, params });
    if (action === 'getDeckConfig') return { id: 1, autoplay: true };
    if (action === 'saveDeckConfig') return true;
    if (action === 'deckNames') return ['Dutch basics'];
    if (action === 'getDeckStats') return { 1: { name: 'Dutch basics', new_count: current.cardId === 10 ? 1 : 0, learn_count: 0, review_count: 1 } };
    if (action === 'guiDeckReview' || action === 'guiShowAnswer') return true;
    if (action === 'guiCurrentCard') return current;
    if (action === 'cardsInfo') {
      assert.deepEqual(params.cards, [current.cardId]);
      return [{ type: current.cardId === 10 ? 0 : 3, queue: current.cardId === 10 ? 0 : 1 }];
    }
    if (action === 'modelTemplates') return { Basic: { Front: 'hallo', Back: 'hello {{Audio}}' } };
    if (action === 'guiAnswerCard') {
      // Anki acknowledges the rating before its background scheduler advances.
      setTimeout(() => { current = { ...current, cardId: 11 }; }, 20);
      return true;
    }
  } });
  assert.equal((await request('/languages/dutch/decks', { method: 'POST', body: { name: 'Dutch basics' } })).status, 201);
  assert.equal((await request('/languages/turkish/decks')).data.length, 0);
  const { data: start } = await request('/anki/review/start', { method: 'POST', body: { languageId: 'dutch', name: 'Dutch basics' } });
  assert.deepEqual(start.counts, { new: 1, learning: 0, review: 1 });
  assert.equal(start.card.category, 'new');
  assert.deepEqual(start.card.audioFiles, { q: [], a: ['hello.mp3'] });
  const body = { token: start.token, cardId: 10, ease: 3 };
  assert.equal((await request('/anki/review/rate', { method: 'POST', body })).status, 400);
  const revealed = await request('/anki/review/reveal', { method: 'POST', body });
  assert.equal(revealed.status, 200);
  assert.equal(revealed.data.card.category, 'new');
  assert.deepEqual(revealed.data.counts, start.counts);
  const rated = await request('/anki/review/rate', { method: 'POST', body });
  assert.equal(rated.data.card.cardId, 11);
  assert.equal(rated.data.card.category, 'learning');
  assert.deepEqual(rated.data.counts, { new: 0, learning: 0, review: 1 });
  assert.equal((await request('/anki/review/rate', { method: 'POST', body })).status, 409);
  assert.equal(actions.filter(a => a.action === 'guiAnswerCard').length, 1);
  assert.equal((await request('/bootstrap')).data.languages[0].reviews, 1);
  current = { ...current, cardId: 99 };
  assert.equal((await request('/anki/review/reveal', { method: 'POST', body: { token: start.token, cardId: 11 } })).status, 409);
});

test('the last rating completes the deck when Anki leaves the reviewer, without recording it twice', async t => {
  let finished = false;
  let ratings = 0;
  const { request } = await fixture(t, { anki: async action => {
    if (action === 'getDeckConfig') return { id: 1, autoplay: true };
    if (action === 'saveDeckConfig') return true;
    if (action === 'deckNames') return ['Turkish'];
    if (action === 'getDeckStats') return { 1: { name: 'Turkish', new_count: finished ? 0 : 1, learn_count: 0, review_count: 0 } };
    if (action === 'guiDeckReview' || action === 'guiShowAnswer') return true;
    if (action === 'guiCurrentCard') {
      if (finished) throw new AppError(502, 'AnkiConnect: Gui review is not currently active.');
      return { cardId: 42, question: 'ev', answer: 'house', buttons: [1, 2, 3, 4] };
    }
    if (action === 'cardsInfo') return [{ type: 0, queue: 0 }];
    if (action === 'guiAnswerCard') { ratings++; finished = true; return true; }
    throw new Error(`Unexpected Anki action: ${action}`);
  } });
  await request('/languages/turkish/decks', { method: 'POST', body: { name: 'Turkish' } });
  const started = await request('/anki/review/start', { method: 'POST', body: { languageId: 'turkish', name: 'Turkish' } });
  const body = { token: started.data.token, cardId: 42, ease: 3 };
  assert.equal((await request('/anki/review/reveal', { method: 'POST', body })).status, 200);
  const rated = await request('/anki/review/rate', { method: 'POST', body });
  assert.equal(rated.status, 200);
  assert.equal(rated.data.card, null);
  assert.deepEqual(rated.data.counts, { new: 0, learning: 0, review: 0 });
  assert.equal(rated.data.reviewedToday, 1);
  assert.equal((await request('/anki/review/rate', { method: 'POST', body })).status, 409);
  assert.equal(ratings, 1);
  const reopened = await request('/anki/review/start', { method: 'POST', body: { languageId: 'turkish', name: 'Turkish' } });
  assert.equal(reopened.status, 200);
  assert.equal(reopened.data.card, null);
  assert.equal(reopened.data.reviewedToday, 1);
});

test('unrelated Anki errors are not treated as a finished deck', async t => {
  const { request } = await fixture(t, { anki: async action => {
    if (action === 'getDeckConfig') return { id: 1, autoplay: true };
    if (action === 'saveDeckConfig') return true;
    if (action === 'deckNames') return ['Turkish'];
    if (action === 'guiDeckReview') return true;
    if (action === 'guiCurrentCard') throw new AppError(503, 'Anki is not connected.');
    throw new Error(`Unexpected Anki action: ${action}`);
  } });
  await request('/languages/turkish/decks', { method: 'POST', body: { name: 'Turkish' } });
  const result = await request('/anki/review/start', { method: 'POST', body: { languageId: 'turkish', name: 'Turkish' } });
  assert.equal(result.status, 503);
  assert.equal(result.data.error, 'Anki is not connected.');
});

test('nested Turkish decks use deck IDs for listing and review counts without confusing identical leaf names', async t => {
  const names = ['Dutch::Vocabulary', 'Turkish::Vocabulary', 'Turkish::Empty'];
  const stats = {
    1: { deck_id: 1, name: 'Vocabulary', new_count: 2, learn_count: 1, review_count: 5, total_in_deck: 40 },
    2: { deck_id: 2, name: 'Vocabulary', new_count: 20, learn_count: 3, review_count: 7, total_in_deck: 100 },
    3: { deck_id: 3, name: 'Empty', new_count: 0, learn_count: 0, review_count: 0, total_in_deck: 0 },
  };
  const { request } = await fixture(t, { anki: async (action, params) => {
    if (action === 'getDeckConfig') return { id: 1, autoplay: true };
    if (action === 'saveDeckConfig') return true;
    if (action === 'deckNames') return names;
    if (action === 'deckNamesAndIds') return Object.fromEntries(names.map((name, index) => [name, index + 1]));
    if (action === 'getDeckStats') return Object.fromEntries(Object.entries(stats).filter(([id]) => params.decks.includes(names[Number(id) - 1])));
    if (action === 'guiDeckReview' || action === 'guiShowAnswer') return true;
    if (action === 'guiCurrentCard') return { cardId: 20, question: 'ev', answer: 'house', buttons: [1, 2, 3, 4] };
    if (action === 'cardsInfo') return [{ type: 0, queue: 0 }];
    throw new Error(`Unexpected Anki action: ${action}`);
  } });
  const listed = await request('/anki/decks');
  assert.equal(listed.status, 200);
  assert.deepEqual(listed.data.map(deck => [deck.name, deck.new_count, deck.learn_count, deck.review_count, deck.total_in_deck]), [
    [names[0], 2, 1, 5, 40], [names[1], 20, 3, 7, 100], [names[2], 0, 0, 0, 0],
  ]);
  assert.equal((await request('/languages/turkish/decks', { method: 'POST', body: { name: names[1] } })).status, 201);
  const started = await request('/anki/review/start', { method: 'POST', body: { languageId: 'turkish', name: names[1] } });
  assert.equal(started.status, 200);
  assert.deepEqual(started.data.counts, { new: 20, learning: 3, review: 7 });
  const revealed = await request('/anki/review/reveal', { method: 'POST', body: { token: started.data.token, cardId: 20 } });
  assert.equal(revealed.status, 200);
  assert.deepEqual(revealed.data.counts, started.data.counts);
});

test('provider adapters use documented payloads and surface connection errors', async () => {
  const requests = [];
  const planRequests = [];
  const integrations = makeIntegrations(async (url, options) => {
    requests.push({ url, ...options, body: JSON.parse(options.body) });
    return new Response(JSON.stringify(url.endsWith('/api/chat') ? { message: { content: 'Merhaba' } } : { output: [{ type: 'message', content: [{ type: 'output_text', text: 'Hallo' }] }] }), { status: 200 });
  }, { respond: async request => { planRequests.push(request); return 'Hallo'; } });
  const language = { name: 'Dutch', nativeName: 'Nederlands' };
  const messages = [{ role: 'user', content: 'Hello' }];
  assert.equal(await integrations.tutor({ settings: { provider: 'chatgpt', chatgptModel: 'chosen-model' }, language, messages }), 'Hallo');
  assert.equal(planRequests[0].model, 'chosen-model');
  assert.equal(requests.length, 0);
  await assert.rejects(() => integrations.tutor({ settings: { provider: 'openai', apiKey: 'fake-key' }, language, messages }), /API-key billing is disabled/);
  assert.equal(requests.length, 0);
  assert.equal(await integrations.tutor({ settings: { provider: 'ollama', ollamaUrl: 'http://127.0.0.1:11434', ollamaModel: 'local' }, language, messages }), 'Merhaba');
  assert.doesNotMatch(requests[0].body.messages[0].content, /CEFR|undefined/);
  assert.equal(requests[0].body.stream, false); assert.equal(requests[0].body.messages[0].role, 'system');
  assert.throws(() => validateLocalUrl('http://169.254.169.254'), /localhost/);
  assert.throws(() => validateLocalUrl('http://localhost:11434/redirect'), /without a path/);
  await assert.rejects(() => makeIntegrations().tutor({ settings: { provider: 'chatgpt' }, language, messages }), /Connect your tutor/);
  await assert.rejects(() => makeIntegrations(async () => { throw new Error('offline'); }).anki('deckNames'), /Anki is not connected/);
});
