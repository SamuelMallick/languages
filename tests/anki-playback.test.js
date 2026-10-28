import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withoutDesktopAudio } from '../server/anki-playback.js';
import { VocabularyAudio } from '../src/vocabulary-audio.js';

test('desktop audio is disabled across child presets and restored after success or failure', async () => {
  for (const fail of [false, true]) {
    const configs = { Parent: { id: 1, autoplay: true }, 'Parent::Child': { id: 2, autoplay: true }, 'Parent::Shared': { id: 1, autoplay: true }, Other: { id: 3, autoplay: true } };
    const saved = [];
    const anki = async (action, params) => {
      if (action === 'deckNames') return Object.keys(configs);
      if (action === 'getDeckConfig') return { ...configs[params.deck] };
      if (action === 'saveDeckConfig') {
        saved.push({ ...params.config });
        for (const config of Object.values(configs)) if (config.id === params.config.id) Object.assign(config, params.config);
        return true;
      }
      throw new Error(action);
    };
    const result = withoutDesktopAudio(anki, 'Parent', async () => {
      assert.equal(configs.Parent.autoplay, false);
      assert.equal(configs['Parent::Child'].autoplay, false);
      assert.equal(configs.Other.autoplay, true);
      configs.Parent.otherSetting = 'preserved';
      if (fail) throw new Error('review failed');
      return 42;
    });
    if (fail) await assert.rejects(result, /review failed/);
    else assert.equal(await result, 42);
    assert.equal(saved.length, 4);
    assert.equal(configs.Parent.autoplay, true);
    assert.equal(configs['Parent::Child'].autoplay, true);
    assert.equal(configs.Parent.otherSetting, 'preserved');
  }
});

test('device audio needs activation and plays files sequentially with cancellation', async t => {
  const oldWindow = globalThis.window;
  const oldFetch = globalThis.fetch;
  t.after(() => { globalThis.window = oldWindow; globalThis.fetch = oldFetch; });
  const sources = [];
  const fetched = [];
  globalThis.window = { AudioContext: class {
    state = 'suspended';
    destination = {};
    async resume() { this.state = 'running'; }
    async close() { this.state = 'closed'; }
    async decodeAudioData(data) { return data; }
    createBufferSource() {
      const source = { connect() {}, start() {}, stop() { this.onended(); } };
      sources.push(source);
      return source;
    }
  } };
  globalThis.fetch = async url => { fetched.push(url); return { ok: true, arrayBuffer: async () => new ArrayBuffer(1) }; };
  const audio = new VocabularyAudio();
  await assert.rejects(audio.play(['one']), { name: 'NotAllowedError' });
  await audio.unlock();
  const playback = audio.play(['one', 'two', 'three']);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(fetched, ['one']);
  sources[0].onended();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(fetched, ['one', 'two']);
  audio.stop();
  await playback;
  assert.equal(sources.length, 2);
  audio.close();
});
