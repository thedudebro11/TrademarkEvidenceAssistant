import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../db/migrate.js";
import { ensureWorkspaceRow } from "../db/ensureWorkspaceRow.js";

describe("runMigrations", () => {
  it("applies migrations once and is a no-op on rerun", () => {
    const db = new Database(":memory:");

    const firstRun = runMigrations(db);
    expect(firstRun.length).toBeGreaterThan(0);

    const secondRun = runMigrations(db);
    expect(secondRun).toEqual([]);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as { name: string }[];
    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toEqual(
      expect.arrayContaining(["schema_migrations", "workspaces", "settings"]),
    );

    db.close();
  });

  it("ensureWorkspaceRow upserts without duplicating", () => {
    const db = new Database(":memory:");
    runMigrations(db);

    ensureWorkspaceRow(db, "Fatletic", "/some/path/evidence");
    ensureWorkspaceRow(db, "Fatletic", "/some/updated/path/evidence");

    const rows = db.prepare("SELECT * FROM workspaces").all() as {
      name: string;
      evidence_root: string;
    }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].evidence_root).toBe("/some/updated/path/evidence");

    db.close();
  });
});
