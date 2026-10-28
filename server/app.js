import express from 'express';
import { createAccessPolicy } from './access.js';
import { generateListening } from './listening.js';
import { TUTOR_LEVELS } from '../shared/tutor.js';
import { parseExerciseContent, formatExerciseAnswers, practiceQuestionsPrompt } from '../shared/exercises.js';
import { cardAudioFiles } from './anki-audio.js';
import multer from 'multer';
import { z, ZodError } from 'zod';
import path from 'node:path';
import { writeFile, unlink } from 'node:fs/promises';
import { id, documentSummary, chatView } from './store.js';
import { extractPdf, sectionContext } from './pdf.js';
import { AppError, makeIntegrations, validateLocalUrl } from './integrations.js';

const short = z.string().trim().min(1).max(160);
const languageSchema = z.object({ name: short, nativeName: short, code: z.string().trim().min(2).max(3) });
const sectionSchema = z.object({ id: short, title: short, startPage: z.number().int().min(1), endPage: z.number().int().min(1), depth: z.number().int().min(0).max(6), completed: z.boolean().default(false) });

export function createApp(store, integrations, chatgpt = null, access = {}) {
  integrations ??= makeIntegrations(fetch, chatgpt);
  const app = express();
  app.disable('x-powered-by');
  app.use(createAccessPolicy(access));
  app.use(express.json({ limit: '1mb' }));
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024, files: 1 } });
  const requireLanguage = value => {
    const lang = store.get('SELECT * FROM languages WHERE id=?', value);
    if (!lang) throw new AppError(404, 'Language not found.');
    return lang;
  };
  const requireDocument = value => {
    const doc = store.get('SELECT * FROM documents WHERE id=?', value);
    if (!doc) throw new AppError(404, 'Reference not found.');
    return doc;
  };
  const publicSettings = req => {
    const { ankiKey, ...settings } = store.settings();
    return { ...settings, hasAnkiKey: Boolean(ankiKey), chatgpt: { ...(chatgpt?.status() || { connected: false, sharing: false, profiles: [] }), signInAvailable: req.localAccess } };
  };
  const anki = (action, params) => integrations.anki(action, params, store.settings());
  async function reviewCard() {
    const card = await anki('guiCurrentCard');
    if (card) {
      card.category = null;
      try {
        const [info] = await anki('cardsInfo', { cards: [card.cardId] });
        // Relearning cards belong to Learning, even though they were reviewed before.
        if (info?.queue === 1 || info?.queue === 3 || info?.type === 1 || info?.type === 3) card.category = 'learning';
        else if (info?.type === 0) card.category = 'new';
        else if (info?.type === 2) card.category = 'review';
      } catch {
        // Missing scheduling metadata must not block the review or guess a category.
      }
    }
    if (card && /(?:play:|playsound:)[qa]:\d+/.test(`${card.question} ${card.answer}`)) {
      try {
        card.audioFiles = cardAudioFiles(card, await anki('modelTemplates', { modelName: card.modelName }));
      } catch {
        // A missing template must not block reviewing or rating the card.
        card.audioFiles = { q: [], a: [] };
      }
    }
    return card;
  }
  async function reviewCounts(name) {
    try {
      const stats = await anki('getDeckStats', { decks: [name] });
      const deck = Object.values(stats || {}).find(deck => deck.name === name);
      return deck ? { new: deck.new_count, learning: deck.learn_count, review: deck.review_count } : null;
    } catch {
      // A stats failure must not turn a successful rating into a failed request.
      return null;
    }
  }
  const activeChats = new Set();
  let review = null;
  let ankiBusy = false;
  async function withAnkiLock(fn) {
    if (ankiBusy) throw new AppError(409, 'Another review action is still in progress.');
    ankiBusy = true;
    try { return await fn(); } finally { ankiBusy = false; }
  }
  async function checkedCard(token, cardId) {
    if (!review || review.token !== token || review.cardId !== cardId) throw new AppError(409, 'This review has changed. Start the review again.');
    const current = await anki('guiCurrentCard');
    if (!current || current.cardId !== cardId) throw new AppError(409, 'The current card changed in Anki. Start the review again to continue safely.');
    return current;
  }

  app.get('/api/bootstrap', (req, res) => {
    const languages = store.all('SELECT * FROM languages ORDER BY rowid');
    const summaries = languages.map(language => ({
      ...language,
      decks: store.get('SELECT COUNT(*) AS count FROM decks WHERE languageId=?', language.id).count,
      references: store.get('SELECT COUNT(*) AS count FROM documents WHERE languageId=?', language.id).count,
      conversations: store.get('SELECT COUNT(*) AS count FROM chats WHERE languageId=? AND documentId IS NULL', language.id).count,
      reviews: store.get("SELECT COUNT(*) AS count FROM activity WHERE languageId=? AND kind='review'", language.id).count,
      completed: store.all('SELECT sections FROM documents WHERE languageId=?', language.id).reduce((n, d) => n + JSON.parse(d.sections).filter(s => s.completed).length, 0),
    }));
    res.json({ languages: summaries, settings: publicSettings(req), activity: store.all('SELECT languageId, kind, createdAt FROM activity ORDER BY createdAt DESC LIMIT 500') });
  });
  app.post('/api/languages', (req, res) => {
    const data = languageSchema.parse(req.body);
    if (store.get('SELECT id FROM languages WHERE name=? COLLATE NOCASE', data.name)) throw new AppError(409, 'That language is already in your workspace.');
    const languageId = id();
    store.run('INSERT INTO languages (id, name, nativeName, code) VALUES (?, ?, ?, ?)', languageId, data.name, data.nativeName, data.code.toUpperCase());
    res.status(201).json({ id: languageId, ...data });
  });
  app.get('/api/settings', (req, res) => res.json(publicSettings(req)));
  app.put('/api/settings', (req, res) => {
    const data = z.object({
      provider: z.enum(['chatgpt', 'ollama']), chatgptModel: z.string().trim().max(160).default(''), ollamaModel: short, ollamaUrl: short,
      ankiKey: z.string().max(500).optional(), clearAnkiKey: z.boolean().optional(),
    }).parse(req.body);
    validateLocalUrl(data.ollamaUrl);
    const previous = store.settings();
    const { clearAnkiKey, ...values } = data;
    store.saveSettings({ ...previous, ...values,
      ankiKey: clearAnkiKey ? '' : data.ankiKey?.trim() || previous.ankiKey,
    });
    res.json(publicSettings(req));
  });

  const requireChatGPT = () => { if (!chatgpt) throw new AppError(503, 'ChatGPT sign-in is not available. Restart the app.'); return chatgpt; };
  // OpenAI's loopback redirect points at the browser's device, not our proxy.
  // Existing server-side connections can still be used by the iPad.
  app.use(['/api/chatgpt/sign-in', '/auth/chatgpt/start', '/auth/callback'], (req, res, next) => {
    if (!req.localAccess) return res.status(403).json({ error: 'Connect ChatGPT on the computer running the app using its localhost address, then reopen Settings on the iPad.' });
    next();
  });
  app.post('/api/chatgpt/sign-in', (req, res) => {
    const body = z.object({ profileId: short.optional(), newProfile: z.boolean().optional(), enablePlan: z.boolean().optional() }).parse(req.body);
    const port = req.socket.localPort;
    res.json(requireChatGPT().begin({ ...body, port }));
  });
  app.get('/auth/chatgpt/start', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const result = requireChatGPT().launch(z.string().max(100).parse(req.query.ticket));
    res.cookie(result.cookieName, result.cookie, { httpOnly: true, sameSite: 'lax', path: '/auth/callback', maxAge: result.maxAge * 1000 });
    res.redirect(302, result.url);
  });
  app.get('/auth/callback', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const query = Object.fromEntries(new URL(req.originalUrl, 'http://127.0.0.1').searchParams);
    const cookieName = /^[-\w]{43}$/.test(query.state || '') ? `lingua_oauth_${query.state}` : '';
    const cookie = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
    try {
      await requireChatGPT().callback(query, cookie);
      store.saveSettings({ ...store.settings(), provider: 'chatgpt', chatgptModel: '' });
      res.clearCookie(cookieName, { path: '/auth/callback', httpOnly: true, sameSite: 'lax' });
      res.redirect(303, '/?settings=1');
    } catch (error) {
      if (cookieName) res.clearCookie(cookieName, { path: '/auth/callback', httpOnly: true, sameSite: 'lax' });
      // Never reflect code, token, or upstream diagnostics into callback HTML.
      const message = error.code === 'oauth_declined' ? 'Sign-in was cancelled. You can try again from Settings.' : 'Sign-in could not be completed or verified. Return to Settings and try again.';
      res.status(error.status || 400).type('html').send(`<!doctype html><html lang="en"><meta name="viewport" content="width=device-width"><meta name="color-scheme" content="dark"><title>Mallick Diller · ChatGPT connection</title><body><main><h1>ChatGPT connection</h1><p>${message}</p><p><a href="/?settings=1">Return to Mallick Diller settings</a></p></main></body></html>`);
    }
  });
  app.get('/api/chatgpt/models', async (req, res) => res.json(await requireChatGPT().listModels()));
  app.post('/api/chatgpt/select', async (req, res) => {
    const { profileId } = z.object({ profileId: short }).parse(req.body);
    await requireChatGPT().select(profileId);
    store.saveSettings({ ...store.settings(), provider: 'chatgpt', chatgptModel: '' });
    res.json(publicSettings(req));
  });
  app.post('/api/chatgpt/sign-out', async (req, res) => {
    const { profileId } = z.object({ profileId: short.optional() }).parse(req.body);
    const result = await requireChatGPT().signOut(profileId);
    res.json({ ...publicSettings(req), warning: result.warning });
  });
  app.post('/api/chatgpt/resume', (req, res) => { requireChatGPT().resume(); res.json(publicSettings(req)); });
  app.post('/api/chatgpt/welcome', async (req, res) => { await requireChatGPT().acknowledgeWelcome(); res.json(publicSettings(req)); });

  app.get('/api/languages/:id/documents', (req, res) => {
    requireLanguage(req.params.id);
    res.json(store.all('SELECT * FROM documents WHERE languageId=? ORDER BY createdAt DESC', req.params.id).map(documentSummary));
  });
  app.post('/api/languages/:id/documents', upload.single('file'), async (req, res) => {
    requireLanguage(req.params.id);
    if (!req.file || !req.file.buffer.subarray(0, 1024).toString('latin1').includes('%PDF-')) throw new AppError(400, 'Choose a valid PDF file (up to 30 MB).');
    let extracted;
    try { extracted = await extractPdf(req.file.buffer); }
    catch (error) { throw new AppError(400, error.name === 'PasswordException' ? 'This PDF is password protected. Upload an unlocked copy.' : `Could not read this PDF. ${error.message}`); }
    const documentId = id();
    const filename = req.file.originalname.replace(/[^\p{L}\p{N} ._()-]/gu, '_').slice(0, 200);
    const title = filename.replace(/\.pdf$/i, '') || 'Grammar reference';
    const target = path.join(store.directory, 'uploads', `${documentId}.pdf`);
    await writeFile(target, req.file.buffer);
    try {
      store.run('INSERT INTO documents VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', documentId, req.params.id, title, filename, extracted.pageCount, JSON.stringify(extracted.pages), JSON.stringify(extracted.sections), extracted.outlineSource, new Date().toISOString());
    } catch (error) { await unlink(target); throw error; }
    res.status(201).json(documentSummary(requireDocument(documentId)));
  });
  app.get('/api/documents/:id', (req, res) => {
    const doc = requireDocument(req.params.id);
    res.json({ ...documentSummary(doc), pages: JSON.parse(doc.pages) });
  });
  app.get('/api/documents/:id/file', (req, res) => {
    const doc = requireDocument(req.params.id);
    res.type('application/pdf').sendFile(path.join(store.directory, 'uploads', `${doc.id}.pdf`));
  });
  app.patch('/api/documents/:id', (req, res) => {
    const doc = requireDocument(req.params.id);
    const data = z.object({ title: short, sections: z.array(sectionSchema).min(1).max(1000) }).parse(req.body);
    if (data.sections.some(s => s.endPage < s.startPage || s.endPage > doc.pageCount) || new Set(data.sections.map(s => s.id)).size !== data.sections.length) throw new AppError(400, 'Every section needs a unique ID and a valid page range within the PDF.');
    if (store.all('SELECT id FROM chats WHERE documentId=?', doc.id).some(c => activeChats.has(c.id))) throw new AppError(409, 'Wait for the tutor to finish before editing this outline.');
    // Changed page ranges invalidate their old discussion context.
    const oldSections = JSON.parse(doc.sections);
    store.db.exec('BEGIN');
    try {
      for (const old of oldSections) {
        const next = data.sections.find(s => s.id === old.id);
        if (!next || next.startPage !== old.startPage || next.endPage !== old.endPage) store.run('DELETE FROM chats WHERE documentId=? AND sectionId=?', doc.id, old.id);
      }
      store.run('UPDATE documents SET title=?, sections=?, outlineSource=? WHERE id=?', data.title, JSON.stringify(data.sections), 'edited outline', doc.id);
      store.db.exec('COMMIT');
    } catch (error) { store.db.exec('ROLLBACK'); throw error; }
    res.json(documentSummary(requireDocument(doc.id)));
  });
  app.delete('/api/documents/:id', async (req, res) => {
    const doc = requireDocument(req.params.id);
    if (store.all('SELECT id FROM chats WHERE documentId=?', doc.id).some(c => activeChats.has(c.id))) throw new AppError(409, 'Wait for the tutor to finish before removing this reference.');
    await unlink(path.join(store.directory, 'uploads', `${doc.id}.pdf`)).catch(error => { if (error.code !== 'ENOENT') throw error; });
    store.run('DELETE FROM documents WHERE id=?', doc.id);
    res.json({ ok: true });
  });

  app.get('/api/languages/:id/decks', (req, res) => {
    requireLanguage(req.params.id);
    res.json(store.all('SELECT * FROM decks WHERE languageId=? ORDER BY name', req.params.id));
  });
  app.get('/api/anki/decks', async (req, res) => {
    const names = await anki('deckNames');
    const stats = names.length ? await anki('getDeckStats', { decks: names }) : {};
    res.json(names.map(name => ({ name, ...(Object.values(stats || {}).find(s => s.name === name) || {}) })));
  });
  app.post('/api/languages/:id/decks', async (req, res) => {
    requireLanguage(req.params.id);
    const { name } = z.object({ name: short }).parse(req.body);
    const names = await anki('deckNames');
    if (!names.includes(name)) throw new AppError(400, 'That deck is not available in the current Anki profile.');
    store.run('INSERT OR IGNORE INTO decks VALUES (?, ?, ?)', id(), req.params.id, name);
    res.status(201).json(store.get('SELECT * FROM decks WHERE languageId=? AND name=?', req.params.id, name));
  });
  app.delete('/api/decks/:id', (req, res) => { store.run('DELETE FROM decks WHERE id=?', req.params.id); res.json({ ok: true }); });
  app.post('/api/anki/review/start', async (req, res) => res.json(await withAnkiLock(async () => {
    const { languageId, name } = z.object({ languageId: short, name: short }).parse(req.body);
    if (!store.get('SELECT id FROM decks WHERE languageId=? AND name=?', languageId, name)) throw new AppError(400, 'Link this deck to your language first.');
    if (!await anki('guiDeckReview', { name })) throw new AppError(502, 'Anki could not start this deck. Close any open Anki dialogs and try again.');
    const card = await reviewCard();
    review = { token: id(), languageId, name, cardId: card?.cardId, revealed: false };
    return { token: review.token, card, counts: await reviewCounts(name), reviewedToday: store.countReviewsToday(languageId) };
  })));
  app.post('/api/anki/review/reveal', async (req, res) => res.json(await withAnkiLock(async () => {
    const { token, cardId } = z.object({ token: short, cardId: z.number().int() }).parse(req.body);
    await checkedCard(token, cardId);
    if (!await anki('guiShowAnswer')) throw new AppError(409, 'Anki could not show this answer. Restart the review.');
    review.revealed = true;
    return { card: await reviewCard(), counts: await reviewCounts(review.name) };
  })));
  app.post('/api/anki/review/rate', async (req, res) => res.json(await withAnkiLock(async () => {
    const { token, cardId, ease } = z.object({ token: short, cardId: z.number().int(), ease: z.number().int().min(1).max(4) }).parse(req.body);
    const current = await checkedCard(token, cardId);
    if (!review.revealed || !current.buttons?.includes(ease)) throw new AppError(400, 'Reveal the answer and choose an available rating.');
    if (!await anki('guiAnswerCard', { ease })) throw new AppError(409, 'Anki did not accept that rating. Restart the review.');
    store.record(review.languageId, 'review');
    review.cardId = null;
    review.revealed = false;
    const card = await reviewCard();
    review.cardId = card?.cardId;
    return { card, counts: await reviewCounts(review.name), reviewedToday: store.countReviewsToday(review.languageId) };
  })));
  app.get('/api/anki/media', async (req, res) => {
    const filename = short.parse(req.query.filename);
    if (/[\\/]/.test(filename) || filename.includes('..')) throw new AppError(400, 'Invalid media filename.');
    const allowed = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.mp3', '.wav', '.ogg', '.m4a']);
    const extension = path.extname(filename).toLowerCase();
    if (!allowed.has(extension)) throw new AppError(400, 'This card media type is not supported.');
    const data = await anki('retrieveMediaFile', { filename });
    if (!data) throw new AppError(404, 'Card media not found.');
    res.type(extension).send(Buffer.from(data, 'base64'));
  });

  app.get('/api/languages/:id/chats', (req, res) => {
    requireLanguage(req.params.id);
    res.json(store.all('SELECT id, title, updatedAt FROM chats WHERE languageId=? AND documentId IS NULL ORDER BY updatedAt DESC', req.params.id));
  });
  app.post('/api/chats', (req, res) => {
    const data = z.object({ languageId: short, documentId: short.optional(), sectionId: short.optional() }).parse(req.body);
    requireLanguage(data.languageId);
    let title = 'New conversation';
    if (data.documentId) {
      const doc = requireDocument(data.documentId);
      const section = JSON.parse(doc.sections).find(s => s.id === data.sectionId);
      if (doc.languageId !== data.languageId || !section) throw new AppError(400, 'Section does not belong to this language.');
      const existing = store.get('SELECT * FROM chats WHERE documentId=? AND sectionId=?', data.documentId, data.sectionId);
      if (existing) return res.json(chatView(existing));
      title = section.title;
    } else if (data.sectionId) throw new AppError(400, 'A grammar section requires a reference.');
    const chatId = id();
    store.run('INSERT INTO chats (id, languageId, documentId, sectionId, title, messages, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)', chatId, data.languageId, data.documentId || null, data.sectionId || null, title, '[]', new Date().toISOString());
    res.status(201).json(chatView(store.get('SELECT * FROM chats WHERE id=?', chatId)));
  });
  app.post('/api/languages/:id/listening', async (req, res) => {
    const language = requireLanguage(req.params.id);
    const { level, previous, instructions } = z.object({
      level: z.enum(TUTOR_LEVELS.filter(Boolean)),
      previous: z.array(z.string().max(600)).max(10).default([]),
      instructions: z.string().trim().max(2000).default(''),
    }).strict().parse(req.body);
    res.json(await generateListening({ store, integrations, language, level, previous, instructions }));
  });
  app.get('/api/chats/:id', (req, res) => {
    const chat = store.get('SELECT * FROM chats WHERE id=?', req.params.id);
    if (!chat) throw new AppError(404, 'Conversation not found.');
    res.json(chatView(chat));
  });
  app.patch('/api/chats/:id/tutor', (req, res) => {
    const data = z.object({ tutorInstructions: z.string().trim().max(8000), tutorLevel: z.enum(TUTOR_LEVELS) }).strict().parse(req.body);
    const chat = store.get('SELECT * FROM chats WHERE id=?', req.params.id);
    if (!chat) throw new AppError(404, 'Conversation not found.');
    if (chat.documentId) throw new AppError(400, 'Tutor settings are only available for practice conversations.');
    if (activeChats.has(chat.id)) throw new AppError(409, 'Wait for the tutor to finish before changing instructions.');
    store.run('UPDATE chats SET tutorInstructions=?, tutorLevel=? WHERE id=?', data.tutorInstructions, data.tutorLevel, chat.id);
    res.json(chatView(store.get('SELECT * FROM chats WHERE id=?', chat.id)));
  });
  app.delete('/api/chats/:id', (req, res) => {
    if (activeChats.has(req.params.id)) throw new AppError(409, 'Wait for the tutor to finish before deleting this conversation.');
    store.run('DELETE FROM chats WHERE id=?', req.params.id);
    res.json({ ok: true });
  });
  app.post('/api/chats/:id/messages', async (req, res) => {
    const data = z.object({
      content: z.string().trim().min(1).max(8000).optional(),
      exercise: z.object({ messageId: short, answers: z.array(z.string().trim().min(1).max(1000)).min(1).max(12) }).strict().optional(),
      action: z.enum(['generate-practice']).optional(),
    }).refine(value => [value.content, value.exercise, value.action].filter(Boolean).length === 1, { message: 'Provide a message, exercise answers, or a practice action.' }).parse(req.body);
    const chat = store.get('SELECT * FROM chats WHERE id=?', req.params.id);
    if (!chat) throw new AppError(404, 'Conversation not found.');
    if (activeChats.has(chat.id)) throw new AppError(409, 'Your tutor is still responding to the previous message.');
    activeChats.add(chat.id);
    try {
      const language = requireLanguage(chat.languageId);
      let context, sectionTitle;
      if (chat.documentId) {
        const doc = requireDocument(chat.documentId);
        const section = JSON.parse(doc.sections).find(s => s.id === chat.sectionId);
        if (!section) throw new AppError(404, 'This section was removed. Choose another section.');
        sectionTitle = section.title;
        try { context = sectionContext(doc, section); }
        catch (error) { throw new AppError(422, error.message); }
      }
      const previous = JSON.parse(chat.messages);
      let content = data.action === 'generate-practice' ? practiceQuestionsPrompt(language, Boolean(chat.documentId)) : data.content;
      if (data.exercise) {
        const source = previous.find(message => message.id === data.exercise.messageId && message.role === 'assistant');
        if (!source) throw new AppError(400, 'These practice questions are not in this conversation.');
        const { questions } = parseExerciseContent(source.content);
        if (!questions.length || questions.length !== data.exercise.answers.length) throw new AppError(400, 'Provide an answer for each practice question.');
        content = formatExerciseAnswers(questions, data.exercise.answers);
        if (content.length > 24000) throw new AppError(400, 'These answers are too long. Shorten them and try again.');
      }
      const user = { id: id(), role: 'user', content, createdAt: new Date().toISOString(), ...(data.exercise ? { exercise: data.exercise } : {}), ...(data.action ? { action: data.action } : {}) };
      // Bound the context window while keeping the complete local transcript.
      let budget = 24000;
      const recent = [];
      for (const message of [...previous, user].reverse()) {
        if (message.content.length > budget && recent.length) break;
        recent.unshift({ role: message.role, content: message.content });
        budget -= message.content.length;
      }
      const answer = await integrations.tutor({ settings: store.settings(), language, messages: recent, context, sectionTitle, tutorInstructions: chat.documentId ? undefined : chat.tutorInstructions, tutorLevel: chat.documentId ? undefined : chat.tutorLevel, interactiveExercises: true });
      const messages = [...previous, user, { id: id(), role: 'assistant', content: answer, createdAt: new Date().toISOString() }];
      const title = !chat.documentId && previous.length === 0 ? data.action === 'generate-practice' ? 'Practice questions' : content.slice(0, 65) : chat.title;
      store.run('UPDATE chats SET messages=?, title=?, updatedAt=? WHERE id=?', JSON.stringify(messages), title, new Date().toISOString(), chat.id);
      store.record(language.id, chat.documentId ? 'grammar' : 'practice');
      res.json({ ...chatView(store.get('SELECT * FROM chats WHERE id=?', chat.id)), contextTruncated: Boolean(context?.truncated), historyTruncated: recent.length < previous.length + 1 });
    } finally { activeChats.delete(chat.id); }
  });
  app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint not found.' }));
  app.use((error, req, res, next) => {
    const status = error instanceof ZodError ? 400 : error instanceof multer.MulterError ? 400 : error.status || 500;
    const message = error instanceof ZodError ? error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') : error.code === 'LIMIT_FILE_SIZE' ? 'PDFs must be 30 MB or smaller.' : status === 500 ? 'Something went wrong on the local server. Please try again.' : error.message;
    if (status === 500) console.error(error);
    res.status(status).json({ error: message, ...(error.code ? { code: error.code } : {}), ...(error.requestId ? { requestId: error.requestId } : {}) });
  });
  return app;
}
