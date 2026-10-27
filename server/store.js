import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DEFAULT_TUTOR_INSTRUCTIONS } from '../shared/tutor.js';

export const id = () => randomUUID();
export function createStore(directory) {
  mkdirSync(directory, { recursive: true });
  mkdirSync(path.join(directory, 'uploads'), { recursive: true });
  const db = new DatabaseSync(path.join(directory, 'lingua.sqlite'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS languages (
      id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      nativeName TEXT NOT NULL, code TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY, languageId TEXT NOT NULL REFERENCES languages(id) ON DELETE CASCADE,
      title TEXT NOT NULL, filename TEXT NOT NULL, pageCount INTEGER NOT NULL,
      pages TEXT NOT NULL, sections TEXT NOT NULL, outlineSource TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS decks (
      id TEXT PRIMARY KEY, languageId TEXT NOT NULL REFERENCES languages(id) ON DELETE CASCADE,
      name TEXT NOT NULL, UNIQUE(languageId, name)
    );
    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY, languageId TEXT NOT NULL REFERENCES languages(id) ON DELETE CASCADE,
      documentId TEXT REFERENCES documents(id) ON DELETE CASCADE, sectionId TEXT,
      title TEXT NOT NULL, messages TEXT NOT NULL DEFAULT '[]', updatedAt TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS grammar_chat ON chats(documentId, sectionId) WHERE documentId IS NOT NULL;
    CREATE TABLE IF NOT EXISTS activity (
      id TEXT PRIMARY KEY, languageId TEXT NOT NULL REFERENCES languages(id) ON DELETE CASCADE,
      kind TEXT NOT NULL, createdAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS listening_history (
      id INTEGER PRIMARY KEY, languageId TEXT NOT NULL REFERENCES languages(id) ON DELETE CASCADE,
      sentence TEXT NOT NULL, normalized TEXT NOT NULL, topic TEXT NOT NULL,
      createdAt TEXT NOT NULL, UNIQUE(languageId, normalized)
    );
    CREATE INDEX IF NOT EXISTS listening_recent ON listening_history(languageId, id DESC);
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  const chatColumns = db.prepare('PRAGMA table_info(chats)').all();
  if (!chatColumns.some(column => column.name === 'tutorInstructions')) db.exec("ALTER TABLE chats ADD COLUMN tutorInstructions TEXT");
  if (!chatColumns.some(column => column.name === 'tutorLevel')) db.exec("ALTER TABLE chats ADD COLUMN tutorLevel TEXT NOT NULL DEFAULT ''");
  // Remove the retired proficiency setting from existing databases without
  // recreating languages or disturbing their related study data.
  if (db.prepare('PRAGMA table_info(languages)').all().some(column => column.name === 'level')) {
    db.exec('ALTER TABLE languages DROP COLUMN level');
  }
  if (!db.prepare('SELECT id FROM languages LIMIT 1').get()) {
    const insert = db.prepare('INSERT INTO languages (id, name, nativeName, code) VALUES (?, ?, ?, ?)');
    insert.run('dutch', 'Dutch', 'Nederlands', 'NL');
    insert.run('turkish', 'Turkish', 'Türkçe', 'TR');
  }
  return {
    db, directory,
    all: (sql, ...args) => db.prepare(sql).all(...args),
    get: (sql, ...args) => db.prepare(sql).get(...args),
    run: (sql, ...args) => db.prepare(sql).run(...args),
    record(languageId, kind) { db.prepare('INSERT INTO activity VALUES (?, ?, ?, ?)').run(id(), languageId, kind, new Date().toISOString()); },
    countReviewsToday(languageId) {
      return db.prepare("SELECT COUNT(*) AS count FROM activity WHERE languageId=? AND kind='review' AND substr(createdAt, 1, 10)=date('now')").get(languageId).count;
    },
    settings() {
      const row = db.prepare("SELECT value FROM settings WHERE key='config'").get();
      const saved = row ? JSON.parse(row.value) : {};
      return {
        // Old API-key settings migrate to ChatGPT. They cannot trigger paid API requests.
        provider: saved.provider === 'ollama' ? 'ollama' : 'chatgpt',
        chatgptModel: saved.chatgptModel || '',
        ollamaModel: saved.ollamaModel || process.env.OLLAMA_MODEL || 'llama3.2',
        ollamaUrl: saved.ollamaUrl || process.env.OLLAMA_URL || 'http://127.0.0.1:11434',
        ankiKey: saved.ankiKey ?? process.env.ANKI_CONNECT_KEY ?? '',
      };
    },
    saveSettings(value) { db.prepare("INSERT INTO settings VALUES ('config', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(value)); },
  };
}

export function documentSummary(doc) {
  const { pages, sections, ...rest } = doc;
  return { ...rest, sections: JSON.parse(sections), hasText: JSON.parse(pages).some(p => p.text.trim()) };
}
export function chatView(chat) { return { ...chat, tutorInstructions: chat.tutorInstructions ?? DEFAULT_TUTOR_INSTRUCTIONS, tutorLevel: chat.tutorLevel || '', messages: JSON.parse(chat.messages) }; }
