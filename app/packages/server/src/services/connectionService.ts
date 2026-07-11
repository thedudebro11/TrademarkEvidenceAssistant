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

  const target = db
    .prepare("SELECT id FROM evidence_items WHERE workspace_id = ? AND original_path = ?")
    .get(workspaceId, targetOriginalPath) as { id: string } | undefined;
  if (!target) {
    throw new ConnectionValidationError(`No evidence item found at path "${targetOriginalPath}"`);
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

  const row = db.prepare("SELECT * FROM connections WHERE id = ?").get(result.lastInsertRowid) as ConnectionRow;
  return mapConnectionRow(row);
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
