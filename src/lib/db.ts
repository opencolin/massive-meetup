import Database from "better-sqlite3";
import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const DATA_DIR = join(process.cwd(), "data");
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = join(DATA_DIR, "cache.db");

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS cache (
      key TEXT PRIMARY KEY,
      response TEXT NOT NULL,
      fetched_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS searches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      city TEXT NOT NULL,
      country TEXT NOT NULL,
      topic TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      result_json TEXT
    );
    CREATE TABLE IF NOT EXISTS feedback_observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      tag TEXT NOT NULL,
      note TEXT NOT NULL,
      context TEXT
    );
  `);
  _db = db;
  return db;
}

export function cacheGet(key: string): string | null {
  const db = getDb();
  const row = db
    .prepare("SELECT response, expires_at FROM cache WHERE key = ?")
    .get(key) as { response: string; expires_at: number } | undefined;
  if (!row) return null;
  if (row.expires_at && row.expires_at < Date.now()) return null;
  return row.response;
}

export function cacheSet(key: string, response: string, ttlMs: number): void {
  const db = getDb();
  const now = Date.now();
  db.prepare(
    "INSERT OR REPLACE INTO cache (key, response, fetched_at, expires_at) VALUES (?, ?, ?, ?)",
  ).run(key, response, now, now + ttlMs);
}

export function recordObservation(tag: string, note: string, context?: unknown): void {
  const db = getDb();
  db.prepare(
    "INSERT INTO feedback_observations (ts, tag, note, context) VALUES (?, ?, ?, ?)",
  ).run(Date.now(), tag, note, context ? JSON.stringify(context) : null);
}

export function startSearch(city: string, country: string, topic: string): number {
  const db = getDb();
  const info = db
    .prepare(
      "INSERT INTO searches (city, country, topic, started_at) VALUES (?, ?, ?, ?)",
    )
    .run(city, country, topic, Date.now());
  return info.lastInsertRowid as number;
}

export function finishSearch(id: number, resultJson: string): void {
  const db = getDb();
  db.prepare(
    "UPDATE searches SET finished_at = ?, result_json = ? WHERE id = ?",
  ).run(Date.now(), resultJson, id);
}
