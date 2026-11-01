import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.NAV_DATA_DIR || path.resolve(__dirname, '../../data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'nav.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function migrate() {
  fs.mkdirSync(path.join(DATA_DIR, 'migrations_applied'), { recursive: true });
  const dir = path.join(__dirname, '../db/migrations');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
  const applied = db.prepare(
    `CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT DEFAULT (datetime('now')))`
  ).run();
  const getApplied = db.prepare('SELECT name FROM _migrations');
  const insert = db.prepare('INSERT INTO _migrations (name) VALUES (?)');
  const run = db.transaction((sql: string, name: string) => {
    db.exec(sql);
    insert.run(name);
  });
  for (const f of files) {
    if (getApplied.all().some((r: any) => r.name === f)) continue;
    const sql = fs.readFileSync(path.join(dir, f), 'utf-8');
    run(sql, f);
    console.log(`[migrate] applied ${f}`);
  }
}

export { db, DATA_DIR, DB_PATH };
