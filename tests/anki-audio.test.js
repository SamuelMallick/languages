import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardAudioFiles } from '../server/anki-audio.js';
import { mediaUrl, replayAudio } from '../src/anki-media.js';

const card = { template: 'Vocabulary', fields: {
  Example: { value: '[sound:example.mp3]', order: 0 },
  Word: { value: '[sound:word.mp3]', order: 1 },
  Empty: { value: '', order: 2 },
} };

test('audio indices follow each template, not field order or repeated FrontSide', () => {
  assert.deepEqual(cardAudioFiles(card, { Vocabulary: {
    Front: '{{Word}}', Back: '{{FrontSide}}<hr>{{Word}}{{Example}}',
  } }), { q: ['word.mp3'], a: ['word.mp3', 'example.mp3'] });
});

test('audio templates respect conditional fields and literal sound files', () => {
  assert.deepEqual(cardAudioFiles(card, { Vocabulary: {
    Front: '{{#Empty}}[sound:hidden.mp3]{{/Empty}}{{^Empty}}{{Word}}{{/Empty}}',
    Back: '{{#Word}}{{#Example}}{{Example}}{{/Example}}{{/Word}}[sound:extra.mp3]',
  } }), { q: ['word.mp3'], a: ['example.mp3', 'extra.mp3'] });
});

test('unsupported TTS or missing templates do not guess audio indices', () => {
  assert.deepEqual(cardAudioFiles(card, {}), { q: [], a: [] });
  assert.deepEqual(cardAudioFiles(card, { Vocabulary: { Front: '{{tts en_US:Word}}{{Example}}', Back: '' } }), { q: [], a: [] });
});

test('audio loads on first click without seeking before metadata is ready', async () => {
  let played = false;
  await replayAudio({ readyState: 0, set currentTime(value) { throw new Error('Not loaded'); }, async play() { played = true; } });
  assert.equal(played, true);
});

test('loaded audio restarts and playback failures reach the caller', async () => {
  const audio = { readyState: 4, currentTime: 8, async play() { assert.equal(this.currentTime, 0); } };
  await replayAudio(audio);
  await assert.rejects(replayAudio({ readyState: 0, async play() { throw new Error('Missing media'); } }), /Missing media/);
});

test('media filenames are encoded as a single local query parameter', () => {
  const filename = 'word " & café.mp3';
  const url = new URL(mediaUrl(filename), 'http://localhost');
  assert.equal(url.pathname, '/api/anki/media');
  assert.equal(url.searchParams.get('filename'), filename);
  assert.equal([...url.searchParams].length, 1);
});
