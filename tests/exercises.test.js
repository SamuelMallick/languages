import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { parseExerciseContent, formatExerciseAnswers, practiceQuestionsPrompt } from '../shared/exercises.js';
import { makeIntegrations } from '../server/integrations.js';

const content = 'Complete each sentence.\n\n<practice-question>1. Ik ___ een boek. **(lezen)**</practice-question>\n\n<practice-question>2. Translate: I have a cat.</practice-question>\n\nUse full sentences.';

test('exercise boundaries preserve Markdown, instructions, question order, and multiline choices', () => {
  const parsed = parseExerciseContent(content);
  assert.deepEqual(parsed.parts.map(part => part.type), ['text', 'question', 'text', 'question', 'text']);
  assert.deepEqual(parsed.questions, ['1. Ik ___ een boek. **(lezen)**', '2. Translate: I have a cat.']);
  assert.equal(parsed.parts[3].index, 1);
  assert.ok(parsed.parts.at(-1).content.includes('Use full sentences.'));
  assert.equal(parseExerciseContent('<practice-question>Choose:\n- a\n- b</practice-question>').questions[0], 'Choose:\n- a\n- b');
  for (const text of ['A normal reply?', '1. A numbered explanation.\n2. Another example.', '<practice-question>Incomplete', '<practice-question> </practice-question>']) {
    assert.equal(parseExerciseContent(text).questions.length, 0);
  }
  const submitted = formatExerciseAnswers(parsed.questions, [' lees ', 'Ik heb een kat.']);
  assert.ok(submitted.includes('Question 1: 1. Ik ___ een boek. **(lezen)**\nMy answer: lees'));
  assert.ok(submitted.includes('Question 2: 2. Translate: I have a cat.\nMy answer: Ik heb een kat.'));
});

test('both tutor providers request interactive question blocks only for chats', async () => {
  const args = { settings: { provider: 'chatgpt' }, language: { name: 'Dutch', nativeName: 'Nederlands' }, messages: [{ role: 'user', content: 'Give me exercises.' }] };
  let system;
  const plan = makeIntegrations(undefined, { respond: async payload => { system = payload.instructions; return content; } });
  await plan.tutor({ ...args, interactiveExercises: true });
  assert.ok(system.includes('<practice-question>'));
  const local = makeIntegrations(async (url, options) => { system = JSON.parse(options.body).messages[0].content; return { ok: true, json: async () => ({ message: { content } }) }; });
  await local.tutor({ ...args, settings: { provider: 'ollama', ollamaUrl: 'http://localhost:11434', ollamaModel: 'test' }, interactiveExercises: true, context: { text: 'Page 1: articles.' }, sectionTitle: 'Articles' });
  assert.ok(system.includes('<practice-question>'));
  assert.ok(system.includes('Page 1: articles.'));
  await plan.tutor(args);
  assert.ok(!system.includes('<practice-question>'));
});

test('each question renders an accessible answer box and saved answers remain visible', async t => {
  const vite = await createServer({ server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom' });
  t.after(() => vite.close());
  const { default: ExerciseMessage } = await vite.ssrLoadModule('/src/ExerciseMessage.jsx');
  const props = { message: { id: 'message', content }, disabled: false, onSubmit() {} };
  const html = renderToStaticMarkup(createElement(ExerciseMessage, props));
  assert.equal((html.match(/<textarea/g) || []).length, 2);
  assert.equal((html.match(/aria-describedby=/g) || []).length, 2);
  assert.ok(html.indexOf('Ik ___') < html.indexOf('<textarea'));
  assert.ok(html.indexOf('Translate:') < html.lastIndexOf('<textarea'));
  assert.ok(html.includes('Answer 1'));
  assert.ok(html.includes('Answer 2'));
  assert.ok(html.includes('Check answers'));
  assert.ok(!html.includes('&lt;practice-question'));
  const saved = renderToStaticMarkup(createElement(ExerciseMessage, { ...props, submittedAnswers: ['lees', 'Ik heb een kat.'] }));
  assert.ok(saved.includes('>lees</textarea>'));
  assert.ok(saved.includes('>Ik heb een kat.</textarea>'));
  assert.ok(saved.includes('Answers submitted'));
  const busy = renderToStaticMarkup(createElement(ExerciseMessage, { ...props, disabled: true }));
  assert.equal((busy.match(/disabled=""/g) || []).length, 3);
  const plain = renderToStaticMarkup(createElement(ExerciseMessage, { ...props, message: { content: 'An ordinary explanation.' } }));
  assert.ok(!plain.includes('<textarea'));
});

test('Practice and Grammar chats hide generation and checking prompts without hiding typed messages, answers, or feedback', async t => {
  const vite = await createServer({ server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom' });
  t.after(() => vite.close());
  const { default: Chat } = await vite.ssrLoadModule('/src/Chat.jsx');
  const answers = ['lees', 'Ik heb een kat.'];
  const initial = { id: 'chat', messages: [
    { id: 'request', role: 'user', content: 'Give me practice questions.' },
    { id: 'questions', role: 'assistant', content },
    { id: 'submission', role: 'user', content: formatExerciseAnswers(parseExerciseContent(content).questions, answers), exercise: { messageId: 'questions', answers } },
    { id: 'feedback', role: 'assistant', content: 'Both answers are correct.' },
  ] };
  for (const grammar of [false, true]) {
    const language = { name: 'Dutch' };
    const restored = { ...initial, messages: [
      { id: 'generation', role: 'user', action: 'generate-practice', content: 'Internal generation prompt' },
      { id: 'legacy-generation', role: 'user', content: practiceQuestionsPrompt(language, grammar) },
      ...initial.messages,
    ] };
    const html = renderToStaticMarkup(createElement(Chat, { initial: restored, language, grammar, tutorReady: true }));
    assert.ok(!html.includes('Internal generation prompt'));
    assert.ok(!html.includes(practiceQuestionsPrompt(language, grammar)));
    assert.ok(!html.includes('Please check each of my answers'));
    assert.ok(!html.includes('My answer:'));
    assert.ok(html.includes('Give me practice questions.'));
    assert.ok(html.includes('Both answers are correct.'));
    assert.ok(html.includes('>lees</textarea>'));
    assert.ok(html.includes('>Ik heb een kat.</textarea>'));
    assert.ok(html.includes('Answers submitted'));
  }
});
