import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { openDatabase } from "./connection.js";
import { loadWorkspaceConfig } from "../config/workspaceConfig.js";
import { REPO_ROOT } from "../config/repoRoot.js";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "migrations");

/**
 * Migrations that rebuild a table to change a foreign key's `ON DELETE`
 * behavior (SQLite has no `ALTER COLUMN` for this — see the SQLite
 * docs, "Making Other Kinds Of Table Schema Changes"). That rebuild
 * (`DROP TABLE` + recreate) is blocked by `PRAGMA foreign_keys = ON`
 * whenever another table still holds a foreign key into the table being
 * dropped, so these specific migrations need `PRAGMA foreign_keys = OFF`
 * for their duration — and that pragma is a documented no-op while a
 * transaction is open, so it cannot simply be the first line of the
 * migration's own SQL the way every other statement here is.
 */
const FOREIGN_KEY_REBUILD_MIGRATIONS = new Set(["0015_bulk_review_operations_source_snapshot.sql"]);

/** Applies any `.sql` files in `migrations/` not yet recorded in `schema_migrations`, in filename order. */
export function runMigrations(db: Database.Database): string[] {
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  // schema_migrations itself is created by migration 0001, so bootstrap it
  // first if this is a brand-new database — the lookup below depends on it.
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))",
  );

  const applied = db
    .prepare("SELECT version FROM schema_migrations")
    .all() as { version: string }[];
  const appliedVersions = new Set(applied.map((row) => row.version));

  const newlyApplied: string[] = [];
  for (const file of files) {
    if (appliedVersions.has(file)) {
      continue;
    }
    const sql = readFileSync(join(migrationsDir, file), "utf-8");

    if (FOREIGN_KEY_REBUILD_MIGRATIONS.has(file)) {
      applyForeignKeyRebuildMigration(db, file, sql);
    } else {
      const applyMigration = db.transaction(() => {
        db.exec(sql);
        db.prepare("INSERT INTO schema_migrations (version) VALUES (?)").run(file);
      });
      applyMigration();
    }
    newlyApplied.push(file);
  }
  return newlyApplied;
}

/**
 * Runs the SQLite-recommended 12-step table-rebuild procedure's pragma
 * bookends around a migration transaction: foreign key enforcement is
 * disabled *outside* any transaction (steps 1/12), the actual DDL runs
 * inside one transaction exactly like every other migration (steps
 * 2–11), and `PRAGMA foreign_key_check` verifies the rebuild introduced
 * no dangling references before that transaction is trusted — if it did,
 * the migration is not recorded as applied, so it will be retried (and
 * fail loudly again) on the next startup rather than silently leaving
 * corrupt data marked "migrated."
 */
function applyForeignKeyRebuildMigration(db: Database.Database, file: string, sql: string): void {
  db.pragma("foreign_keys = OFF");
  try {
    const applyMigration = db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (version) VALUES (?)").run(file);
    });
    applyMigration();

    const violations = db.pragma("foreign_key_check") as unknown[];
    if (violations.length > 0) {
      throw new Error(`Migration ${file} left foreign key violations: ${JSON.stringify(violations)}`);
    }
  } finally {
    db.pragma("foreign_keys = ON");
  }
}

async function main() {
  const workspace = loadWorkspaceConfig(REPO_ROOT);
  const db = openDatabase(workspace.databasePath);
  const applied = runMigrations(db);
  if (applied.length === 0) {
    console.log("No pending migrations.");
  } else {
    console.log(`Applied migrations: ${applied.join(", ")}`);
  }
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
