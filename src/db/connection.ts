// ── SQLite connection via bun:sqlite ──

import { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const DB_PATH = process.env['DB_PATH'] ?? 'eto-challenge.db';

let db: Database | null = null;

export function getDb(): Database {
  if (!db) {
    throw new Error('Database not initialized — call initDb() first');
  }
  return db;
}

export function initDb(): Database {
  db = new Database(DB_PATH);

  // Apply schema
  const schemaPath = join(import.meta.dir, 'schema.sql');
  const schema = readFileSync(schemaPath, 'utf-8');

  // Execute each statement separately (bun:sqlite doesn't support multi-statement exec well)
  const statements = schema
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith('--'));

  for (const stmt of statements) {
    db.run(`${stmt};`);
  }

  console.log(`[db] Initialized SQLite at ${DB_PATH}`);
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
