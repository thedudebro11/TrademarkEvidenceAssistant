import type Database from "better-sqlite3";

/** Idempotently records the active workspace in the `workspaces` table, returning its id. */
export function ensureWorkspaceRow(
  db: Database.Database,
  name: string,
  evidenceRoot: string,
): number {
  db.prepare(
    `INSERT INTO workspaces (name, evidence_root)
     VALUES (?, ?)
     ON CONFLICT(name) DO UPDATE SET evidence_root = excluded.evidence_root`,
  ).run(name, evidenceRoot);

  const row = db.prepare("SELECT id FROM workspaces WHERE name = ?").get(name) as { id: number };
  return row.id;
}
