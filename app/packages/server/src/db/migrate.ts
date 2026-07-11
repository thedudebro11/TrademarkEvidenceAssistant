import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { openDatabase } from "./connection.js";
import { loadWorkspaceConfig } from "../config/workspaceConfig.js";
import { REPO_ROOT } from "../config/repoRoot.js";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "migrations");

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
    const applyMigration = db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (version) VALUES (?)").run(file);
    });
    applyMigration();
    newlyApplied.push(file);
  }
  return newlyApplied;
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
