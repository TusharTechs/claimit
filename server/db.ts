import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.ts';

fs.mkdirSync(config.dataDir, { recursive: true });

export const db = new DatabaseSync(path.join(config.dataDir, 'claimit.db'));

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sellers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  shop TEXT NOT NULL,
  upi TEXT NOT NULL,
  key TEXT NOT NULL,
  created INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS drops (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL REFERENCES sellers(id),
  title TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'live',
  live_url TEXT,
  current_item TEXT,
  created INTEGER NOT NULL,
  ended INTEGER
);

CREATE TABLE IF NOT EXISTS images (
  id TEXT PRIMARY KEY,
  mime TEXT NOT NULL,
  data BLOB NOT NULL
);

CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  drop_id TEXT NOT NULL REFERENCES drops(id),
  name TEXT NOT NULL,
  price INTEGER NOT NULL,
  image_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  idx INTEGER NOT NULL,
  dropped_at INTEGER,
  version INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS buyers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  key TEXT NOT NULL,
  created INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS claims (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES items(id),
  drop_id TEXT NOT NULL REFERENCES drops(id),
  buyer_id TEXT NOT NULL REFERENCES buyers(id),
  buyer_name TEXT NOT NULL,
  status TEXT NOT NULL,
  seq INTEGER NOT NULL,
  created INTEGER NOT NULL,
  hold_until INTEGER,
  utr TEXT,
  paid_at INTEGER
);
CREATE INDEX IF NOT EXISTS claims_item ON claims(item_id, status);
CREATE INDEX IF NOT EXISTS claims_buyer ON claims(buyer_id);

CREATE TABLE IF NOT EXISTS tokens (
  user_id TEXT PRIMARY KEY,
  token TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  drop_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  user_id TEXT,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS events_drop ON events(drop_id, kind);
`);

// Additive migrations for existing databases (SQLite has no ADD COLUMN IF NOT EXISTS).
function addColumn(table: string, column: string, type: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}
addColumn('drops', 'hold_seconds', 'INTEGER');
addColumn('buyers', 'phone', 'TEXT');
addColumn('buyers', 'address', 'TEXT');
addColumn('buyers', 'pincode', 'TEXT');
addColumn('buyers', 'is_guest', 'INTEGER NOT NULL DEFAULT 0');
addColumn('claims', 'ship_phone', 'TEXT');
addColumn('claims', 'ship_address', 'TEXT');
addColumn('claims', 'ship_pincode', 'TEXT');
addColumn('events', 'ref', 'TEXT');
db.exec(`
CREATE TABLE IF NOT EXISTS follows (
  seller_id TEXT NOT NULL REFERENCES sellers(id),
  buyer_id TEXT NOT NULL REFERENCES buyers(id),
  created INTEGER NOT NULL,
  PRIMARY KEY (seller_id, buyer_id)
);
CREATE TABLE IF NOT EXISTS pro_waitlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  seller_id TEXT,
  contact TEXT NOT NULL,
  created INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  drop_id TEXT,
  role TEXT NOT NULL,
  user_id TEXT,
  rating INTEGER,
  text TEXT,
  quote_ok INTEGER NOT NULL DEFAULT 0,
  created INTEGER NOT NULL
);
`);

export function tx<T>(fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export const now = () => Date.now();

const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
export function rid(len = 10): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let s = '';
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return s;
}
