import { dirname } from "node:path";
import type Database from "better-sqlite3";
import type { SuggestionConfidence, SuggestionQueueFilters, SuggestionQueueItemView, SuggestionQueueResponse } from "@trademark-evidence-assistant/shared";
import { isLatestAnalysisStale } from "./analysisService.js";

/**
 * Evidence Intelligence Phase 2 — the Review Suggestions queue: every
 * evidence item that currently has an actionable, unconfirmed analysis
 * suggestion, with the filters the batch-review UI needs. Purely a
 * read-model over Phase 1's existing tables — this module writes
 * nothing and confirms nothing; opening an item still goes through the
 * existing AnalysisPanel/confirmAnalysisSuggestions path exactly as it
 * does for a single "Analyze Evidence" run.
 */

const CONFIDENCE_RANK: Record<SuggestionConfidence, number> = { low: 0, medium: 1, high: 2 };

interface CandidateRunRow {
  run_id: number;
  evidence_item_id: string;
  original_filename: string;
  original_path: string;
  provider_id: string | null;
}

function folderOf(originalPath: string): string {
  const d = dirname(originalPath);
  return d === "." ? "" : d;
}

export function getSuggestionQueue(db: Database.Database, workspaceId: number, filters: SuggestionQueueFilters): SuggestionQueueResponse {
  let candidateRows: CandidateRunRow[];
  if (filters.jobId !== undefined) {
    candidateRows = db
      .prepare(
        `SELECT ar.id AS run_id, ei.id AS evidence_item_id, ei.original_filename, ei.original_path, ar.provider_id
           FROM batch_analysis_job_items bji
           JOIN analysis_runs ar ON ar.id = bji.analysis_run_id
           JOIN evidence_items ei ON ei.id = bji.evidence_item_id
          WHERE bji.job_id = ? AND bji.status = 'succeeded' AND ar.superseded_at IS NULL`,
      )
      .all(filters.jobId) as CandidateRunRow[];
  } else {
    candidateRows = db
      .prepare(
        `SELECT ar.id AS run_id, ei.id AS evidence_item_id, ei.original_filename, ei.original_path, ar.provider_id
           FROM analysis_runs ar
           JOIN evidence_items ei ON ei.id = ar.evidence_item_id
          WHERE ar.workspace_id = ? AND ar.superseded_at IS NULL
            AND ar.id = (SELECT MAX(id) FROM analysis_runs WHERE evidence_item_id = ei.id)`,
      )
      .all(workspaceId) as CandidateRunRow[];
  }

  const items: SuggestionQueueItemView[] = [];

  for (const row of candidateRows) {
    const typeSuggestions = db
      .prepare("SELECT proposed_value, confidence, state FROM evidence_suggestions WHERE analysis_run_id = ? AND field_kind = 'evidence_type' ORDER BY id")
      .all(row.run_id) as { proposed_value: string; confidence: string; state: string }[];
    const actionableTypes = typeSuggestions.filter((s) => s.state === "proposed" || s.state === "edited");
    const topType = actionableTypes[0] ?? null;
    const alternatives = actionableTypes.slice(1).map((s) => s.proposed_value);

    const answerSuggestions = db
      .prepare("SELECT state FROM evidence_suggestions WHERE analysis_run_id = ? AND field_kind = 'question_answer'")
      .all(row.run_id) as { state: string }[];
    const answerCount = answerSuggestions.filter((s) => s.state === "proposed" || s.state === "edited").length;
    const hasUnresolvedQuestion = answerSuggestions.some((s) => s.state === "unresolved");

    const dateRows = db.prepare("SELECT conflict_state FROM date_assertions WHERE analysis_run_id = ?").all(row.run_id) as { conflict_state: string }[];
    const dateCount = dateRows.length;
    const dateContradiction = dateRows.some((d) => d.conflict_state === "conflicts_with_other_assertion");

    const identifierCount = (db.prepare("SELECT COUNT(*) AS c FROM extracted_entities WHERE analysis_run_id = ?").get(row.run_id) as { c: number }).c;

    const connectionRows = db.prepare("SELECT state, contradiction_warning FROM connection_suggestions WHERE analysis_run_id = ? AND source_item_id = ?").all(row.run_id, row.evidence_item_id) as {
      state: string;
      contradiction_warning: string | null;
    }[];
    const connectionSuggestionCount = connectionRows.filter((c) => c.state === "proposed").length;
    const connectionContradiction = connectionRows.some((c) => c.contradiction_warning !== null);

    // Something actionable must exist, or this item doesn't belong in a
    // *review* queue at all — everything already confirmed/rejected on
    // this run is simply not shown here.
    const hasActionableContent = actionableTypes.length > 0 || answerCount > 0 || hasUnresolvedQuestion || connectionSuggestionCount > 0;
    if (!hasActionableContent) continue;

    const stale = isLatestAnalysisStale(db, workspaceId, row.evidence_item_id) === true;
    const failedExtraction = identifierCount === 0 && dateCount === 0;

    items.push({
      evidenceItemId: row.evidence_item_id,
      filename: row.original_filename,
      folder: folderOf(row.original_path),
      analysisRunId: row.run_id,
      suggestedEvidenceType: topType?.proposed_value ?? null,
      alternativeEvidenceTypes: alternatives,
      confidence: (topType?.confidence as SuggestionConfidence | undefined) ?? null,
      answerSuggestionCount: answerCount,
      dateCount,
      identifierCount,
      connectionSuggestionCount,
      hasContradiction: dateContradiction || connectionContradiction,
      hasUnresolvedQuestion,
      failedExtraction,
      stale,
      providerAvailable: row.provider_id !== null,
    });
  }

  const filtered = items.filter((item) => {
    if (filters.evidenceType && item.suggestedEvidenceType !== filters.evidenceType) return false;
    if (filters.folder !== undefined && item.folder !== filters.folder) return false;
    if (filters.minConfidence) {
      if (!item.confidence || CONFIDENCE_RANK[item.confidence] < CONFIDENCE_RANK[filters.minConfidence]) return false;
    }
    if (filters.unresolvedCustomerStatus && !item.hasUnresolvedQuestion) return false;
    if (filters.hasContradiction && !item.hasContradiction) return false;
    if (filters.hasConnections && item.connectionSuggestionCount === 0) return false;
    if (filters.failedExtraction && !item.failedExtraction) return false;
    if (filters.stale && !item.stale) return false;
    if (filters.noProvider && item.providerAvailable) return false;
    return true;
  });

  return { items: filtered, total: filtered.length };
}
