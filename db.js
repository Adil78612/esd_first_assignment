// db.js — shared data store for saved generations.
// BOTH the HTTP API and the gRPC service will import this one module,
// so they share the same source of truth (a single SQLite file).

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// The database is ONE file on disk. DB_PATH lets us point both containers
// at the same shared file later; locally it defaults to ./data/generations.db
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'generations.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL'); // safer when more than one process uses the file

// Create the table once, if it doesn't already exist.
db.exec(`
  CREATE TABLE IF NOT EXISTS generations (
    id         TEXT PRIMARY KEY,
    type       TEXT NOT NULL,
    content    TEXT NOT NULL,
    created_at TEXT NOT NULL
  )
`);

// Save a generation.
// IDEMPOTENT: saving the same id twice does NOT create a duplicate.
// Returns { created: true } if newly inserted, { created: false } if it already existed.
function saveGeneration({ id, type, content }) {
  const stmt = db.prepare(`
    INSERT INTO generations (id, type, content, created_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO NOTHING
  `);
  const info = stmt.run(id, type, content, new Date().toISOString());
  return { created: info.changes === 1 };
}

// Fetch one saved generation by id (undefined if not found).
function getGeneration(id) {
  return db.prepare('SELECT * FROM generations WHERE id = ?').get(id);
}

// List all saved generations, newest first.
function listGenerations() {
  return db.prepare('SELECT * FROM generations ORDER BY created_at DESC').all();
}

module.exports = { saveGeneration, getGeneration, listGenerations };
