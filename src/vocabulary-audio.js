// One AudioContext per vocabulary screen. Resume it directly from the user's
// Review click so iPad Safari permits subsequent playback after API requests.
export class VocabularyAudio {
  context = null;
  generation = 0;
  source = null;
  unlock() {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return Promise.reject(new Error('Audio is not supported by this browser.'));
    this.context ??= new Context();
    return this.context.resume();
  }
  stop() {
    this.generation++;
    this.source?.stop();
    this.source = null;
  }
  async play(urls) {
    this.stop();
    const generation = this.generation;
    if (urls.length && (!this.context || this.context.state !== 'running')) {
      const error = new Error('Enable audio on this device.');
      error.name = 'NotAllowedError';
      throw error;
    }
    const context = this.context;
    for (const url of urls) {
      if (generation !== this.generation) return;
      const response = await fetch(url);
      if (!response.ok) throw new Error('Could not load audio from Anki.');
      const data = await response.arrayBuffer();
      if (generation !== this.generation) return;
      const buffer = await context.decodeAudioData(data);
      if (generation !== this.generation) return;
      if (context.state !== 'running') {
        const error = new Error('Tap Enable audio to allow automatic playback on this device.');
        error.name = 'NotAllowedError';
        throw error;
      }
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      this.source = source;
      await new Promise(resolve => { source.onended = resolve; source.start(); });
      if (generation !== this.generation) return;
      this.source = null;
    }
  }
  close() {
    this.stop();
    this.context?.close().catch(() => {});
    this.context = null;
  }
}
