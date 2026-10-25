import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createStore } from '../server/store.js';

test('removing legacy language levels preserves study data and is safe to repeat', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'lingua-migration-'));
  let store;
  try {
    store = createStore(directory);
    // Reproduce the retired column on a database with related records.
    store.db.exec("ALTER TABLE languages ADD COLUMN level TEXT NOT NULL DEFAULT 'A1'");
    store.run("UPDATE languages SET level='B2' WHERE id='dutch'");
    store.run('INSERT INTO decks VALUES (?, ?, ?)', 'deck-1', 'dutch', 'Dutch words');
    store.run('INSERT INTO chats (id, languageId, documentId, sectionId, title, messages, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)', 'chat-1', 'dutch', null, null, 'Conversation', '[]', '2026-01-01');
    store.record('dutch', 'review');
    store.db.close();

    for (let attempt = 0; attempt < 2; attempt++) {
      store = createStore(directory);
      assert.deepEqual({ ...store.get("SELECT * FROM languages WHERE id='dutch'") }, { id: 'dutch', name: 'Dutch', nativeName: 'Nederlands', code: 'NL' });
      assert.equal(store.get("SELECT name FROM decks WHERE id='deck-1'").name, 'Dutch words');
      assert.equal(store.get("SELECT title FROM chats WHERE id='chat-1'").title, 'Conversation');
      assert.equal(store.get('SELECT COUNT(*) AS count FROM activity').count, 1);
      assert.deepEqual(store.all('PRAGMA foreign_key_check'), []);
      store.db.close();
      store = null;
    }
  } finally {
    store?.db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
