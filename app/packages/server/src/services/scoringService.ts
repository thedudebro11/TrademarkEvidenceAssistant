import type Database from "better-sqlite3";
import type {
  ConnectionType,
  EvidenceUsefulness,
  FileRole,
  ReviewAnswer,
  UsefulnessBand,
  UsefulnessOverride,
} from "@trademark-evidence-assistant/shared";
import { USEFULNESS_BANDS } from "@trademark-evidence-assistant/shared";
import { computeUsefulness } from "../engines/scoringEngine.js";

export class ScoringValidationError extends Error {}

interface OverrideRow {
  usefulness_override_score: number | null;
  usefulness_override_band: string | null;
  usefulness_override_note: string | null;
  usefulness_override_at: string | null;
}

/** Combines the freshly-computed score with any stored override. Never hides the computed value. */
export function getUsefulness(
  db: Database.Database,
  itemId: string,
  answers: ReviewAnswer[],
  fileRole: FileRole | null,
  hasDuplicates: boolean,
  hasNotes: boolean,
  connectionTypes: ConnectionType[],
): EvidenceUsefulness {
  const computed = computeUsefulness({ answers, fileRole, hasDuplicates, hasNotes, connectionTypes });

  const row = db
    .prepare(
      "SELECT usefulness_override_score, usefulness_override_band, usefulness_override_note, usefulness_override_at FROM evidence_items WHERE id = ?",
    )
    .get(itemId) as OverrideRow | undefined;

  const override: UsefulnessOverride | null =
    row?.usefulness_override_score !== null && row?.usefulness_override_score !== undefined
      ? {
          score: row.usefulness_override_score,
          band: row.usefulness_override_band as UsefulnessBand,
          note: row.usefulness_override_note ?? "",
          overriddenAt: row.usefulness_override_at ?? "",
        }
      : null;

  return {
    computed,
    override,
    effective: override
      ? { score: override.score, band: override.band, positiveFactors: computed.positiveFactors, missingElements: computed.missingElements }
      : computed,
  };
}

/** Sets a manual override. A note is required — spec 08: "user override requires a note". */
export function setOverride(
  db: Database.Database,
  workspaceId: number,
  itemId: string,
  score: number,
  band: UsefulnessBand,
  note: string,
): void {
  if (!Number.isInteger(score) || score < 0 || score > 100) {
    throw new ScoringValidationError("score must be an integer between 0 and 100");
  }
  if (!USEFULNESS_BANDS.includes(band)) {
    throw new ScoringValidationError(`"${band}" is not a recognized usefulness band`);
  }
  if (!note || !note.trim()) {
    throw new ScoringValidationError("An override requires a note explaining why");
  }

  const existing = db
    .prepare("SELECT id FROM evidence_items WHERE workspace_id = ? AND id = ?")
    .get(workspaceId, itemId);
  if (!existing) {
    throw new ScoringValidationError(`Evidence item ${itemId} not found in this workspace`);
  }

  db.prepare(
    `UPDATE evidence_items
     SET usefulness_override_score = ?, usefulness_override_band = ?,
         usefulness_override_note = ?, usefulness_override_at = datetime('now')
     WHERE id = ?`,
  ).run(score, band, note.trim(), itemId);
}

/** Removes an override, reverting display to the computed score. */
export function clearOverride(db: Database.Database, workspaceId: number, itemId: string): void {
  const existing = db
    .prepare("SELECT id FROM evidence_items WHERE workspace_id = ? AND id = ?")
    .get(workspaceId, itemId);
  if (!existing) {
    throw new ScoringValidationError(`Evidence item ${itemId} not found in this workspace`);
  }
  db.prepare(
    `UPDATE evidence_items
     SET usefulness_override_score = NULL, usefulness_override_band = NULL,
         usefulness_override_note = NULL, usefulness_override_at = NULL
     WHERE id = ?`,
  ).run(itemId);
}
