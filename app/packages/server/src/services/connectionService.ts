import type Database from "better-sqlite3";
import type {
  ConnectionSummary,
  ConnectionType,
  EvidenceConnection,
  SuggestionConfidence,
} from "@trademark-evidence-assistant/shared";
import { CONNECTION_TYPES, SUGGESTION_CONFIDENCES } from "@trademark-evidence-assistant/shared";

export class ConnectionValidationError extends Error {}

interface CreateConnectionInput {
  type: ConnectionType;
  explanation: string;
  confidence: SuggestionConfidence | null;
}

function normalizeSlashes(path: string): string {
  return path.replace(/\\/g, "/").toLowerCase();
}

/**
 * Resolves a typed or pasted path to an item, tolerating the most
 * common real-world mistake: pasting a full OS path (e.g. copied from
 * Windows Explorer) instead of the path-relative-to-the-evidence-root
 * that's actually stored. Tries an exact match first (the fast, common
 * case with the picker); if that fails, falls back to a case-insensitive
 * suffix match — "does the typed path end with a stored item's path?" —
 * which resolves an absolute path without needing to know the evidence
 * root here. The evidence root itself is never modified or read from
 * disk by this check; it only ever compares strings already in the DB.
 *
 * Known imprecision: raw suffix matching can't distinguish "this really
 * is the evidence root + item path" from "this longer path coincidentally
 * ends the same way" — e.g. two same-named files in different folders,
 * paired with a typo'd path, could resolve to the wrong one. This isn't
 * checked against the real evidence root because the connection creation
 * path (the atomic draft save) doesn't currently carry it this deep; the
 * picker UI is the precise, ambiguity-free way to link two items, and
 * this fallback exists only to rescue manual typing/pasting from an
 * outright failure.
 */
function resolveTargetItem(
  db: Database.Database,
  workspaceId: number,
  targetPath: string,
): { id: string } | undefined {
  const exact = db
    .prepare("SELECT id FROM evidence_items WHERE workspace_id = ? AND original_path = ?")
    .get(workspaceId, targetPath) as { id: string } | undefined;
  if (exact) return exact;

  const normalizedTarget = normalizeSlashes(targetPath);
  const candidates = db
    .prepare("SELECT id, original_path FROM evidence_items WHERE workspace_id = ?")
    .all(workspaceId) as { id: string; original_path: string }[];

  const suffixMatch = candidates.find((c) => normalizedTarget.endsWith(normalizeSlashes(c.original_path)));
  return suffixMatch ? { id: suffixMatch.id } : undefined;
}

/**
 * Creates a user-asserted connection from `sourceItemId` to an item
 * identified by its original path (paths, not opaque ids, are what a
 * human can actually type — spec 11 "no complex graph in v1" argues
 * against building a full item-search UI for this). Both items must
 * belong to the workspace; self-connections are rejected.
 */
export function createConnection(
  db: Database.Database,
  workspaceId: number,
  sourceItemId: string,
  targetOriginalPath: string,
  input: CreateConnectionInput,
): EvidenceConnection {
  if (!CONNECTION_TYPES.includes(input.type)) {
    throw new ConnectionValidationError(`"${input.type}" is not a recognized connection type`);
  }
  if (input.confidence !== null && !SUGGESTION_CONFIDENCES.includes(input.confidence)) {
    throw new ConnectionValidationError(`"${input.confidence}" is not a recognized confidence level`);
  }
  if (!input.explanation || !input.explanation.trim()) {
    throw new ConnectionValidationError("An explanation is required for every connection");
  }

  const source = db
    .prepare("SELECT id FROM evidence_items WHERE workspace_id = ? AND id = ?")
    .get(workspaceId, sourceItemId);
  if (!source) {
    throw new ConnectionValidationError(`Evidence item ${sourceItemId} not found in this workspace`);
  }

  const target = resolveTargetItem(db, workspaceId, targetOriginalPath);
  if (!target) {
    throw new ConnectionValidationError(
      `No evidence item matches "${targetOriginalPath}". Try picking it from the list instead of typing the path.`,
    );
  }
  if (target.id === sourceItemId) {
    throw new ConnectionValidationError("An evidence item cannot be connected to itself");
  }

  const result = db
    .prepare(
      `INSERT INTO connections (source_item_id, target_item_id, type, explanation, confidence)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(sourceItemId, target.id, input.type, input.explanation.trim(), input.confidence);

  // "No Related Evidence" workflow: the two states must never coexist.
  // A connection existing between these two items makes any prior
  // "no related evidence" claim stale for *both* of them, not just the
  // side whose Connect panel was used — this is the one authoritative
  // write path for that invariant, regardless of what any draft payload
  // claims (see reviewDraftService.saveDraft's own defensive check).
  db.prepare("UPDATE evidence_items SET no_related_evidence = 0 WHERE id IN (?, ?)").run(sourceItemId, target.id);

  const row = db.prepare("SELECT * FROM connections WHERE id = ?").get(result.lastInsertRowid) as ConnectionRow;
  return mapConnectionRow(row);
}

/**
 * Records (or clears) an explicit "no related evidence" determination
 * for one item. Never creates a connection row — this is review
 * metadata only. Setting `true` is silently ignored (not an error) if
 * the item already has any connections, since that would violate the
 * "must never coexist" invariant; the UI is designed so this shouldn't
 * be reachable, but this is the authoritative guard regardless of the
 * caller.
 */
export function setNoRelatedEvidence(db: Database.Database, workspaceId: number, itemId: string, value: boolean): void {
  const existing = db
    .prepare("SELECT id FROM evidence_items WHERE workspace_id = ? AND id = ?")
    .get(workspaceId, itemId);
  if (!existing) {
    throw new ConnectionValidationError(`Evidence item ${itemId} not found in this workspace`);
  }

  if (!value) {
    db.prepare("UPDATE evidence_items SET no_related_evidence = 0 WHERE id = ?").run(itemId);
    return;
  }

  const count = db
    .prepare("SELECT COUNT(*) AS c FROM connections WHERE source_item_id = ? OR target_item_id = ?")
    .get(itemId, itemId) as { c: number };
  if (count.c === 0) {
    db.prepare("UPDATE evidence_items SET no_related_evidence = 1 WHERE id = ?").run(itemId);
  }
}

/** Removes a connection. Throws if it doesn't belong to this workspace. */
export function removeConnection(db: Database.Database, workspaceId: number, connectionId: number): void {
  const row = db
    .prepare(
      `SELECT c.id FROM connections c
       JOIN evidence_items ei ON ei.id = c.source_item_id
       WHERE c.id = ? AND ei.workspace_id = ?`,
    )
    .get(connectionId, workspaceId);
  if (!row) {
    throw new ConnectionValidationError(`Connection ${connectionId} not found in this workspace`);
  }
  db.prepare("DELETE FROM connections WHERE id = ?").run(connectionId);
}

/** Returns every connection touching `itemId`, from that item's point of view. */
export function getConnectionsForItem(db: Database.Database, itemId: string): ConnectionSummary[] {
  const outgoing = db
    .prepare(
      `SELECT c.id AS connection_id, c.target_item_id AS related_id, ei.original_path AS related_path,
              c.type, c.explanation, c.confidence, c.created_at
       FROM connections c JOIN evidence_items ei ON ei.id = c.target_item_id
       WHERE c.source_item_id = ?`,
    )
    .all(itemId) as ConnectionSummaryRow[];

  const incoming = db
    .prepare(
      `SELECT c.id AS connection_id, c.source_item_id AS related_id, ei.original_path AS related_path,
              c.type, c.explanation, c.confidence, c.created_at
       FROM connections c JOIN evidence_items ei ON ei.id = c.source_item_id
       WHERE c.target_item_id = ?`,
    )
    .all(itemId) as ConnectionSummaryRow[];

  return [
    ...outgoing.map((r) => toSummary(r, "outgoing")),
    ...incoming.map((r) => toSummary(r, "incoming")),
  ];
}

interface ConnectionRow {
  id: number;
  source_item_id: string;
  target_item_id: string;
  type: string;
  explanation: string;
  confidence: string | null;
  created_by: string;
  created_at: string;
}

function mapConnectionRow(row: ConnectionRow): EvidenceConnection {
  return {
    id: row.id,
    sourceItemId: row.source_item_id,
    targetItemId: row.target_item_id,
    type: row.type as ConnectionType,
    explanation: row.explanation,
    confidence: row.confidence as SuggestionConfidence | null,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

interface ConnectionSummaryRow {
  connection_id: number;
  related_id: string;
  related_path: string;
  type: string;
  explanation: string;
  confidence: string | null;
  created_at: string;
}

function toSummary(row: ConnectionSummaryRow, direction: "outgoing" | "incoming"): ConnectionSummary {
  return {
    connectionId: row.connection_id,
    direction,
    relatedItemId: row.related_id,
    relatedOriginalPath: row.related_path,
    type: row.type as ConnectionType,
    explanation: row.explanation,
    confidence: row.confidence as SuggestionConfidence | null,
    createdAt: row.created_at,
  };
}
