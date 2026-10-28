// AnkiConnect has no reviewer-only mute API. Temporarily disable autoplay in
// the relevant presets, and restore only that setting after the transition.
export async function withoutDesktopAudio(anki, name, transition) {
  const names = (await anki('deckNames')).filter(deck => deck === name || deck.startsWith(`${name}::`));
  const changed = [];
  const seen = new Set();
  try {
    for (const deck of names) {
      const config = await anki('getDeckConfig', { deck });
      if (!config || config.id == null) throw new Error('Could not read Anki audio settings. Update AnkiConnect and try again.');
      if (seen.has(String(config.id))) continue;
      seen.add(String(config.id));
      if (config.autoplay === false) continue;
      changed.push({ deck, autoplay: config.autoplay });
      if (!await anki('saveDeckConfig', { config: { ...config, autoplay: false } })) throw new Error('Could not disable desktop audio in Anki.');
    }
    return await transition();
  } finally {
    // Attempt every restoration even if one preset cannot be saved.
    const results = await Promise.allSettled(changed.map(async ({ deck, autoplay }) => {
      const config = await anki('getDeckConfig', { deck });
      if (!config || !await anki('saveDeckConfig', { config: { ...config, autoplay } })) throw new Error('Could not restore Anki audio settings. Check the deck’s audio options in Anki.');
    }));
    const failure = results.find(result => result.status === 'rejected');
    if (failure) throw failure.reason;
  }
}
