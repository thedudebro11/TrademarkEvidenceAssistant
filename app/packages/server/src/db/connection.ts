import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";

let db: Database.Database | undefined;

/**
 * Opens (creating parent directories as needed) the SQLite file for the
 * given database path. The path lives under `generated/<workspace>/`
 * per docs/ARCHITECTURE.md, which is git-ignored — the app owns creating
 * that directory at runtime.
 */
export function openDatabase(databasePath: string): Database.Database {
  if (db) {
    return db;
  }
  mkdirSync(dirname(databasePath), { recursive: true });
  db = new Database(databasePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

export function closeDatabase(): void {
  db?.close();
  db = undefined;
}
