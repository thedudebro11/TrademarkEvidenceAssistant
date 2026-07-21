import { dirname, extname } from "node:path";
import type Database from "better-sqlite3";
import type {
  AnalysisResultResponse,
  AnalysisRunSummary,
  ConfirmAnalysisRequest,
  ConfirmAnalysisResponse,
  ConnectionSuggestionView,
  DateAssertionView,
  EvidenceSuggestionView,
  ExtractedEntityType,
  ExtractedEntityView,
  ReviewDraftPayload,
} from "@trademark-evidence-assistant/shared";
import { EVIDENCE_TYPE_REGISTRY_META, getInterviewForType, SUGGESTION_CONFIDENCES } from "@trademark-evidence-assistant/shared";
import type { RetrievedExampleView } from "@trademark-evidence-assistant/shared";
import { DETERMINISTIC_RULE_VERSION, METADATA_EXTRACTION_VERSION, runDeterministicAnalysis, type AnalysisEngineInput } from "../engines/analysisEngine.js";
import { retrieveConfirmedExamples, type RetrievedExample } from "../engines/exemplarRetrieval.js";
import { getConfiguredAnalysisProvider } from "./analysisProvider.js";
import { extractTextFromItem, OcrError } from "./ocrService.js";
import { saveDraftWithTx } from "./reviewDraftService.js";
import { createConnection } from "./connectionService.js";

/**
 * Evidence Intelligence Phase 1 — current-item "Analyze Evidence" flow.
 * Everything this module writes (analysis_runs, evidence_suggestions,
 * extracted_entities, date_assertions, connection_suggestions) is
 * staged data; the *only* function here that ever touches a confirmed
 * field is `confirmAnalysisSuggestions`, and that always goes through
 * the existing `saveDraftWithTx`/`createConnection` path — the exact
 * same functions manual review already uses. Nothing else in this file
 * calls either of those.
 */

export class AnalysisItemNotFoundError extends Error {}
export class AnalysisValidationError extends Error {}
export class AnalysisRunNotFoundError extends Error {}

const QUESTION_REGISTRY_VERSION = EVIDENCE_TYPE_REGISTRY_META.version; // interview questions live inside the same registry — see analysisService.ts's doc comment in migration 0017

interface EvidenceItemRow {
  id: string;
  original_path: string;
  original_filename: string;
  extension: string;
  mime_type: string;
  sha256: string;
  missing_since: string | null;
  fs_created_at: string | null;
  fs_modified_at: string | null;
  evidence_type_id: string | null;
}

interface FileMetadataRow {
  width: number | null;
  height: number | null;
  exif_date_time_original: string | null;
  exif_create_date: string | null;
  filename_inferred_date: string | null;
}

function getEvidenceItemRow(db: Database.Database, workspaceId: number, itemId: string): EvidenceItemRow | undefined {
  return db
    .prepare(
      `SELECT id, original_path, original_filename, extension, mime_type, sha256, missing_since, fs_created_at, fs_modified_at, evidence_type_id
       FROM evidence_items WHERE workspace_id = ? AND id = ?`,
    )
    .get(workspaceId, itemId) as EvidenceItemRow | undefined;
}

/** Concatenated raw text from a confirmed exemplar's own most recent (non-superseded) analysis run — reused as that exemplar's text-overlap signal so retrieval never re-runs OCR (see exemplarRetrieval.ts's doc comment). `null` when the exemplar was never analyzed. */
function getExemplarTextSignal(db: Database.Database, itemId: string): string | null {
  const latestRun = db.prepare("SELECT id FROM analysis_runs WHERE evidence_item_id = ? ORDER BY id DESC LIMIT 1").get(itemId) as { id: number } | undefined;
  if (!latestRun) return null;
  const rows = db.prepare("SELECT raw_text FROM extracted_entities WHERE analysis_run_id = ?").all(latestRun.id) as { raw_text: string }[];
  if (rows.length === 0) return null;
  return rows.map((r) => r.raw_text).join(" ");
}

function getFileMetadataRow(db: Database.Database, itemId: string): FileMetadataRow | undefined {
  return db
    .prepare("SELECT width, height, exif_date_time_original, exif_create_date, filename_inferred_date FROM file_metadata WHERE evidence_item_id = ?")
    .get(itemId) as FileMetadataRow | undefined;
}

function getSiblingExtensions(db: Database.Database, workspaceId: number, itemId: string, originalPath: string): string[] {
  const folder = dirname(originalPath);
  const rows = db.prepare("SELECT original_path FROM evidence_items WHERE workspace_id = ? AND id != ?").all(workspaceId, itemId) as { original_path: string }[];
  return rows.filter((r) => dirname(r.original_path) === folder).map((r) => extname(r.original_path).replace(/^\./, ""));
}

async function getOcrTextForItem(db: Database.Database, workspaceId: number, itemId: string, evidenceRoot: string): Promise<string | null> {
  try {
    const result = await extractTextFromItem(db, workspaceId, itemId, evidenceRoot);
    return result.rawText.trim() ? result.rawText : null;
  } catch (err) {
    // Fails soft — an item whose type doesn't support OCR (a PDF, a
    // video, a HEIC customer photo with nothing to read) or whose file
    // is temporarily unreadable simply proceeds without OCR-derived
    // suggestions, exactly like metadataEngine.ts's own "extraction
    // failure never aborts a scan" convention. Not rethrown.
    void err;
    return null;
  }
}

export interface AnalysisPaths {
  evidenceRoot: string;
}

/**
 * Starts a new analysis run for `itemId`: runs deterministic extraction
 * (OCR when supported, metadata, entities, dates, evidence-type
 * ranking), persists everything as staged suggestions, supersedes the
 * item's previous run (if any) and its still-open suggestions, and
 * proposes exact-identifier connections against every other evidence
 * item in the workspace. Nothing here writes to evidence_items,
 * review_answers, or connections.
 */
export async function startAnalysis(db: Database.Database, workspaceId: number, itemId: string, paths: AnalysisPaths): Promise<AnalysisResultResponse> {
  const item = getEvidenceItemRow(db, workspaceId, itemId);
  if (!item) throw new AnalysisItemNotFoundError(`Evidence item ${itemId} not found in this workspace`);

  const metadata = getFileMetadataRow(db, itemId);
  const siblingExtensions = getSiblingExtensions(db, workspaceId, itemId, item.original_path);
  const ocrText = item.missing_since ? null : await getOcrTextForItem(db, workspaceId, itemId, paths.evidenceRoot);

  const engineInput: AnalysisEngineInput = {
    originalFilename: item.original_filename,
    originalPath: item.original_path,
    folderPath: dirname(item.original_path) === "." ? "" : dirname(item.original_path),
    extension: item.extension,
    siblingExtensions,
    width: metadata?.width ?? null,
    height: metadata?.height ?? null,
    exifDateTimeOriginal: metadata?.exif_date_time_original ?? null,
    exifCreateDate: metadata?.exif_create_date ?? null,
    filenameInferredDate: metadata?.filename_inferred_date ?? null,
    fsCreatedAt: item.fs_created_at,
    fsModifiedAt: item.fs_modified_at,
    ocrText,
  };

  const result = runDeterministicAnalysis(engineInput);
  const provider = getConfiguredAnalysisProvider();
  const capability = await provider.checkAvailability();

  // Confirmed-example retrieval (Phase 2) — evaluated against whichever
  // evidence-type candidate the deterministic engine currently ranks
  // first, purely to explain/corroborate it, never to invent a
  // candidate that folder/filename/OCR signals didn't already produce.
  const topCandidate = result.evidenceTypeCandidates[0] as (typeof result.evidenceTypeCandidates)[number] | undefined;
  const retrievedExamples: RetrievedExample[] = retrieveConfirmedExamples(
    db,
    workspaceId,
    {
      itemId,
      originalFilename: item.original_filename,
      folderPath: engineInput.folderPath,
      extension: item.extension,
      mimeType: item.mime_type,
      ocrText,
    },
    topCandidate?.typeId ?? null,
    (exampleId) => getExemplarTextSignal(db, exampleId),
  );

  // A conservative, bounded confidence nudge: real confirmed exemplars
  // corroborating the current top candidate can lift it from "low" to
  // "medium" (never further — "folder context alone must not produce
  // High confidence," and exemplar agreement is still ultimately rooted
  // in the same folder/filename signals for most of these matches, so it
  // gets the same ceiling). OCR-content-derived High-confidence
  // candidates are untouched — they don't need this and this never
  // downgrades anything.
  const supportingExamples = retrievedExamples.filter((e) => e.agreement === "supports");
  if (topCandidate && topCandidate.confidence === "low" && supportingExamples.length >= 2) {
    topCandidate.confidence = "medium";
    topCandidate.reasons = [...topCandidate.reasons, `Corroborated by ${supportingExamples.length} of your own prior confirmed "${topCandidate.typeId.replace(/_/g, " ")}" examples with similar signals`];
  }

  // Supersede this item's previous run + its still-open suggestions
  // *before* inserting the new one, in the same transaction as
  // everything else below — "reanalysis creates a new run and
  // supersedes the previous proposed suggestions."
  const previousRun = db.prepare("SELECT id FROM analysis_runs WHERE evidence_item_id = ? AND superseded_at IS NULL ORDER BY id DESC LIMIT 1").get(itemId) as { id: number } | undefined;

  const persist = db.transaction(() => {
    const insertRun = db
      .prepare(
        `INSERT INTO analysis_runs
           (workspace_id, evidence_item_id, source_fingerprint, metadata_version, evidence_type_registry_version,
            question_registry_version, deterministic_rule_version, status, initiated_at, completed_at,
            provider_id, provider_model, provider_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'completed', datetime('now'), datetime('now'), ?, ?, ?)`,
      )
      .run(
        workspaceId,
        itemId,
        item.sha256,
        METADATA_EXTRACTION_VERSION,
        EVIDENCE_TYPE_REGISTRY_META.version,
        QUESTION_REGISTRY_VERSION,
        DETERMINISTIC_RULE_VERSION,
        capability.providerId,
        capability.model,
        capability.version,
      );
    const runId = Number(insertRun.lastInsertRowid);

    if (previousRun) {
      db.prepare("UPDATE analysis_runs SET superseded_at = datetime('now'), superseded_by_run_id = ? WHERE id = ?").run(runId, previousRun.id);
      db.prepare(
        `UPDATE evidence_suggestions SET state = 'superseded' WHERE analysis_run_id = ? AND state IN ('proposed', 'edited', 'unresolved')`,
      ).run(previousRun.id);
      db.prepare(`UPDATE connection_suggestions SET state = 'superseded' WHERE analysis_run_id = ? AND state = 'proposed'`).run(previousRun.id);
    }

    const insertSuggestion = db.prepare(
      `INSERT INTO evidence_suggestions
         (workspace_id, evidence_item_id, analysis_run_id, field_kind, field_id, proposed_value, normalized_value,
          confidence, rationale, supporting_signals_json, source_locations_json, generation_method, state)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'deterministic', ?)`,
    );
    for (const c of result.evidenceTypeCandidates) {
      insertSuggestion.run(workspaceId, itemId, runId, "evidence_type", null, c.typeId, c.typeId, c.confidence, c.reasons.join("; "), JSON.stringify(c.reasons), JSON.stringify([]), "proposed");
    }
    for (const a of result.answerSuggestions) {
      insertSuggestion.run(
        workspaceId,
        itemId,
        runId,
        "question_answer",
        a.questionId,
        a.proposedValue,
        a.normalizedValue,
        a.confidence,
        a.rationale,
        JSON.stringify(a.supportingSignals),
        JSON.stringify(a.sourceLocations),
        a.unresolved ? "unresolved" : "proposed",
      );
    }

    const insertEntity = db.prepare(
      `INSERT INTO extracted_entities (workspace_id, evidence_item_id, analysis_run_id, entity_type, raw_text, normalized_value, source_location, extraction_method, confidence)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const e of result.entities) {
      insertEntity.run(workspaceId, itemId, runId, e.entityType, e.rawText, e.normalizedValue, e.sourceLocation, e.extractionMethod, e.confidence);
    }

    const insertDate = db.prepare(
      `INSERT INTO date_assertions (workspace_id, evidence_item_id, analysis_run_id, source_type, raw_value, normalized_value, timezone_status, source_location, confidence, conflict_state, explanation)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const distinctDays = new Set(result.dates.map((d) => d.normalizedValue?.slice(0, 10)).filter(Boolean));
    const conflictState = distinctDays.size > 1 ? "conflicts_with_other_assertion" : "none";
    for (const d of result.dates) {
      insertDate.run(workspaceId, itemId, runId, d.sourceType, d.rawValue, d.normalizedValue, d.timezoneStatus, d.sourceLocation, d.confidence, conflictState, d.explanation);
    }

    proposeExactIdentifierConnections(db, workspaceId, itemId, runId, result.entities);
    proposeFileHashConnections(db, workspaceId, itemId, runId, item.sha256);

    const insertExample = db.prepare(
      `INSERT INTO analysis_retrieved_examples
         (workspace_id, analysis_run_id, evidence_item_id, example_item_id, example_evidence_type_id, matched_signals_json, influence_score, agreement)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const example of retrievedExamples) {
      insertExample.run(workspaceId, runId, itemId, example.exampleItemId, example.exampleEvidenceTypeId, JSON.stringify(example.matchedSignals), example.influenceScore, example.agreement);
    }

    return runId;
  });

  const runId = persist();
  return getAnalysisResult(db, workspaceId, itemId, runId, capability.available);
}

/**
 * Strong, deterministic, exact-identifier connection proposals only
 * (Phase 1 scope) — order/shipment/tracking number or SKU shared with
 * another evidence item. Never auto-creates a `connections` row; the
 * UNIQUE constraint on connection_suggestions prevents the same
 * source/target/type/identifier pair from ever being staged twice, and
 * an existing *confirmed* connection between the same pair suppresses
 * the suggestion entirely (reusing the existing graph, per the Phase 1
 * requirement to reuse confirmed connections, not duplicate them).
 */
const IDENTIFIER_ENTITY_TYPES = new Set<ExtractedEntityType>(["order_number", "shipment_number", "tracking_number", "sku"]);

function proposeExactIdentifierConnections(db: Database.Database, workspaceId: number, itemId: string, runId: number, entities: { entityType: ExtractedEntityType; normalizedValue: string | null }[]): void {
  // ON CONFLICT rather than INSERT OR IGNORE: the UNIQUE constraint
  // (source, target, type, identifier) intentionally prevents this exact
  // suggestion from ever being duplicated *across* runs, but a
  // reanalysis must still bring a previously-superseded instance of the
  // same match back to 'proposed' under the new run — otherwise a
  // repeat analysis of the same real match would silently stop
  // suggesting it. A user's own prior 'accepted'/'rejected' decision on
  // this exact pair is explicitly preserved, never overwritten by a
  // later analysis.
  const insertSuggestion = db.prepare(
    `INSERT INTO connection_suggestions
       (workspace_id, source_item_id, target_item_id, analysis_run_id, proposed_type, matched_identifier_type, matched_identifier_value, confidence, rationale, contradiction_warning, state)
     VALUES (?, ?, ?, ?, 'related_to', ?, ?, 'high', ?, ?, 'proposed')
     ON CONFLICT (source_item_id, target_item_id, proposed_type, matched_identifier_value) DO UPDATE SET
       analysis_run_id = excluded.analysis_run_id, rationale = excluded.rationale, state = 'proposed'
       WHERE connection_suggestions.state NOT IN ('accepted', 'rejected')`,
  );

  for (const entity of entities) {
    if (!IDENTIFIER_ENTITY_TYPES.has(entity.entityType) || !entity.normalizedValue) continue;

    // `other_run_id` (the *other* item's own current run, from the same
    // join that found the match) is what its reverse-direction row must
    // be tagged with — not `runId` (this item's own current run). Every
    // connectionRows lookup elsewhere (getAnalysisResult,
    // reviewSuggestionsQueueService) filters by
    // `analysis_run_id = <that item's own latest run>`, so tagging both
    // directions with the same single `runId` left the *other* item's
    // own row permanently invisible whenever that item's analysis was
    // later viewed on its own — a real bug this comment now prevents
    // from being reintroduced.
    const matches = db
      .prepare(
        `SELECT DISTINCT ee.evidence_item_id AS other_item_id, ar.id AS other_run_id
           FROM extracted_entities ee
           JOIN analysis_runs ar ON ar.id = ee.analysis_run_id AND ar.superseded_at IS NULL
          WHERE ee.workspace_id = ? AND ee.entity_type = ? AND ee.normalized_value = ? AND ee.evidence_item_id != ?`,
      )
      .all(workspaceId, entity.entityType, entity.normalizedValue, itemId) as { other_item_id: string; other_run_id: number }[];

    for (const match of matches) {
      const otherId = match.other_item_id;
      const alreadyConfirmed = db
        .prepare("SELECT id FROM connections WHERE (source_item_id = ? AND target_item_id = ?) OR (source_item_id = ? AND target_item_id = ?)")
        .get(itemId, otherId, otherId, itemId);
      if (alreadyConfirmed) continue; // already a real connection — nothing to suggest

      const rationale = `Both items share the same ${entity.entityType.replace(/_/g, " ")}: "${entity.normalizedValue}".`;
      insertSuggestion.run(workspaceId, itemId, otherId, runId, entity.entityType, entity.normalizedValue, rationale, null);
      insertSuggestion.run(workspaceId, otherId, itemId, match.other_run_id, entity.entityType, entity.normalizedValue, rationale, null);
    }
  }
}

/**
 * Exact byte-for-byte file duplicates (same SHA-256), the other
 * exact-identifier category named in the Phase 1 spec alongside
 * order/shipment/tracking/SKU — deliberately separate from
 * `proposeExactIdentifierConnections` since it matches on
 * `evidence_items.sha256` directly rather than an OCR-derived entity.
 * Same staging semantics: never auto-applied, symmetric suggestion rows,
 * suppressed once a real `connections` row already links the pair.
 */
function proposeFileHashConnections(db: Database.Database, workspaceId: number, itemId: string, runId: number, sha256: string): void {
  const insertSuggestion = db.prepare(
    `INSERT INTO connection_suggestions
       (workspace_id, source_item_id, target_item_id, analysis_run_id, proposed_type, matched_identifier_type, matched_identifier_value, confidence, rationale, contradiction_warning, state)
     VALUES (?, ?, ?, ?, 'related_to', 'file_hash', ?, 'high', ?, ?, 'proposed')
     ON CONFLICT (source_item_id, target_item_id, proposed_type, matched_identifier_value) DO UPDATE SET
       analysis_run_id = excluded.analysis_run_id, rationale = excluded.rationale, state = 'proposed'
       WHERE connection_suggestions.state NOT IN ('accepted', 'rejected')`,
  );

  const matches = db
    .prepare(
      `SELECT id AS other_item_id FROM evidence_items
        WHERE workspace_id = ? AND sha256 = ? AND id != ? AND missing_since IS NULL`,
    )
    .all(workspaceId, sha256, itemId) as { other_item_id: string }[];

  for (const match of matches) {
    const otherId = match.other_item_id;
    const alreadyConfirmed = db
      .prepare("SELECT id FROM connections WHERE (source_item_id = ? AND target_item_id = ?) OR (source_item_id = ? AND target_item_id = ?)")
      .get(itemId, otherId, otherId, itemId);
    if (alreadyConfirmed) continue;

    // The reverse-direction row must be tagged with the *other* item's
    // own current run, not this item's — see the identical, more fully
    // explained fix in proposeExactIdentifierConnections above. Unlike
    // that function, file-hash matching queries evidence_items directly
    // rather than joining through analysis_runs, so the other item's own
    // latest run isn't already in hand and may not exist yet at all (a
    // duplicate discovered before its twin has ever been analyzed) — in
    // that case the reverse row is simply not created now; it will be
    // created correctly, tagged with that item's own run, the first time
    // that item itself gets analyzed and rediscovers the same match.
    const otherRun = db.prepare("SELECT id FROM analysis_runs WHERE evidence_item_id = ? AND superseded_at IS NULL ORDER BY id DESC LIMIT 1").get(otherId) as { id: number } | undefined;

    const rationale = "Both items are byte-for-byte identical copies of the same file (matching SHA-256 hash).";
    insertSuggestion.run(workspaceId, itemId, otherId, runId, sha256, rationale, null);
    if (otherRun) {
      insertSuggestion.run(workspaceId, otherId, itemId, otherRun.id, sha256, rationale, null);
    }
  }
}

/** True when the run is superseded by a later one, or its recorded versions/fingerprint no longer match the item's current state — computed live, never stored (see migration 0017's doc comment). */
function computeRunStaleness(run: { source_fingerprint: string; evidence_type_registry_version: string; question_registry_version: string; deterministic_rule_version: string; superseded_at: string | null }, item: EvidenceItemRow): boolean {
  if (run.superseded_at !== null) return true;
  if (run.source_fingerprint !== item.sha256) return true;
  if (run.evidence_type_registry_version !== EVIDENCE_TYPE_REGISTRY_META.version) return true;
  if (run.question_registry_version !== QUESTION_REGISTRY_VERSION) return true;
  if (run.deterministic_rule_version !== DETERMINISTIC_RULE_VERSION) return true;
  return false;
}

interface RunRow {
  id: number;
  evidence_item_id: string;
  source_fingerprint: string;
  metadata_version: string;
  evidence_type_registry_version: string;
  question_registry_version: string;
  deterministic_rule_version: string;
  status: string;
  initiated_at: string;
  completed_at: string | null;
  provider_id: string | null;
  provider_model: string | null;
  provider_version: string | null;
  error: string | null;
  superseded_at: string | null;
}

function mapRun(row: RunRow, item: EvidenceItemRow): AnalysisRunSummary {
  return {
    id: row.id,
    evidenceItemId: row.evidence_item_id,
    sourceFingerprint: row.source_fingerprint,
    metadataVersion: row.metadata_version,
    evidenceTypeRegistryVersion: row.evidence_type_registry_version,
    questionRegistryVersion: row.question_registry_version,
    deterministicRuleVersion: row.deterministic_rule_version,
    status: row.status as AnalysisRunSummary["status"],
    initiatedAt: row.initiated_at,
    completedAt: row.completed_at,
    providerId: row.provider_id,
    providerModel: row.provider_model,
    providerVersion: row.provider_version,
    errorMessage: row.error,
    stale: computeRunStaleness(row, item),
  };
}

interface SuggestionRow {
  id: number;
  analysis_run_id: number;
  field_kind: string;
  field_id: string | null;
  proposed_value: string;
  normalized_value: string | null;
  confidence: string;
  rationale: string;
  supporting_signals_json: string;
  source_locations_json: string;
  generation_method: string;
  state: string;
  user_correction: string | null;
  created_at: string;
  confirmed_at: string | null;
}

function mapSuggestion(row: SuggestionRow, stale: boolean): EvidenceSuggestionView {
  const state = stale && (row.state === "proposed" || row.state === "edited" || row.state === "unresolved") ? "stale" : (row.state as EvidenceSuggestionView["state"]);
  return {
    id: row.id,
    analysisRunId: row.analysis_run_id,
    fieldKind: row.field_kind as EvidenceSuggestionView["fieldKind"],
    fieldId: row.field_id,
    proposedValue: row.proposed_value,
    normalizedValue: row.normalized_value,
    confidence: row.confidence as EvidenceSuggestionView["confidence"],
    rationale: row.rationale,
    supportingSignals: JSON.parse(row.supporting_signals_json),
    sourceLocations: JSON.parse(row.source_locations_json),
    generationMethod: row.generation_method as EvidenceSuggestionView["generationMethod"],
    state,
    userCorrection: row.user_correction,
    createdAt: row.created_at,
    confirmedAt: row.confirmed_at,
  };
}

/** Read-only: the latest analysis run for `itemId` (if any) plus its suggestions/entities/dates/connection-suggestions. Never triggers a new analysis. */
export function getLatestAnalysis(db: Database.Database, workspaceId: number, itemId: string): AnalysisResultResponse | null {
  const item = getEvidenceItemRow(db, workspaceId, itemId);
  if (!item) return null;
  const runRow = db.prepare("SELECT * FROM analysis_runs WHERE workspace_id = ? AND evidence_item_id = ? ORDER BY id DESC LIMIT 1").get(workspaceId, itemId) as RunRow | undefined;
  if (!runRow) return null;
  const capability = { available: false }; // read path never re-probes the provider — see startAnalysis for the one place that does
  return getAnalysisResult(db, workspaceId, itemId, runRow.id, capability.available);
}

/** For batchAnalysisService.ts's "Reanalyze Stale" selection — `true` only when a real analysis run exists for this item AND it's stale; `false` for a current run; `null` when the item has never been analyzed at all (not the same thing as stale, so never selected by "Reanalyze Stale"). Reuses the exact same live staleness computation `getLatestAnalysis`/`confirmAnalysisSuggestions` already use. */
export function isLatestAnalysisStale(db: Database.Database, workspaceId: number, itemId: string): boolean | null {
  const item = getEvidenceItemRow(db, workspaceId, itemId);
  if (!item) return null;
  const runRow = db.prepare("SELECT id, source_fingerprint, evidence_type_registry_version, question_registry_version, deterministic_rule_version, superseded_at FROM analysis_runs WHERE workspace_id = ? AND evidence_item_id = ? ORDER BY id DESC LIMIT 1").get(workspaceId, itemId) as
    | { id: number; source_fingerprint: string; evidence_type_registry_version: string; question_registry_version: string; deterministic_rule_version: string; superseded_at: string | null }
    | undefined;
  if (!runRow) return null;
  return computeRunStaleness(runRow, item);
}

function getAnalysisResult(db: Database.Database, workspaceId: number, itemId: string, runId: number, providerAvailable: boolean): AnalysisResultResponse {
  const item = getEvidenceItemRow(db, workspaceId, itemId)!;
  const runRow = db.prepare("SELECT * FROM analysis_runs WHERE id = ?").get(runId) as RunRow;
  const run = mapRun(runRow, item);

  const suggestionRows = db.prepare("SELECT * FROM evidence_suggestions WHERE analysis_run_id = ? ORDER BY id").all(runId) as SuggestionRow[];
  const suggestions = suggestionRows.map((r) => mapSuggestion(r, run.stale));
  const evidenceTypeSuggestions = suggestions.filter((s) => s.fieldKind === "evidence_type");
  const answerSuggestions = suggestions.filter((s) => s.fieldKind === "question_answer");

  const entityRows = db.prepare("SELECT * FROM extracted_entities WHERE analysis_run_id = ? ORDER BY id").all(runId) as {
    id: number;
    entity_type: string;
    raw_text: string;
    normalized_value: string | null;
    source_location: string | null;
    extraction_method: string;
    confidence: string;
  }[];
  const entities: ExtractedEntityView[] = entityRows.map((r) => ({
    id: r.id,
    entityType: r.entity_type as ExtractedEntityView["entityType"],
    rawText: r.raw_text,
    normalizedValue: r.normalized_value,
    sourceLocation: r.source_location,
    extractionMethod: r.extraction_method,
    confidence: r.confidence as ExtractedEntityView["confidence"],
  }));

  const dateRows = db.prepare("SELECT * FROM date_assertions WHERE analysis_run_id = ? ORDER BY id").all(runId) as {
    id: number;
    source_type: string;
    raw_value: string;
    normalized_value: string | null;
    timezone_status: string;
    source_location: string | null;
    confidence: string;
    conflict_state: string;
    confirmation_state: string;
    explanation: string;
  }[];
  const dates: DateAssertionView[] = dateRows.map((r) => ({
    id: r.id,
    sourceType: r.source_type as DateAssertionView["sourceType"],
    rawValue: r.raw_value,
    normalizedValue: r.normalized_value,
    timezoneStatus: r.timezone_status as DateAssertionView["timezoneStatus"],
    sourceLocation: r.source_location,
    confidence: r.confidence as DateAssertionView["confidence"],
    conflictState: r.conflict_state as DateAssertionView["conflictState"],
    confirmationState: r.confirmation_state as DateAssertionView["confirmationState"],
    explanation: r.explanation,
  }));

  const connectionRows = db
    .prepare(
      `SELECT cs.*, ei.original_filename AS target_filename, ei.original_path AS target_original_path
         FROM connection_suggestions cs
         JOIN evidence_items ei ON ei.id = cs.target_item_id
        WHERE cs.analysis_run_id = ? AND cs.source_item_id = ?
        ORDER BY cs.id`,
    )
    .all(runId, itemId) as {
    id: number;
    source_item_id: string;
    target_item_id: string;
    proposed_type: string;
    matched_identifier_type: string;
    matched_identifier_value: string;
    confidence: string;
    rationale: string;
    contradiction_warning: string | null;
    state: string;
    target_filename: string;
    target_original_path: string;
  }[];
  const connectionSuggestions: ConnectionSuggestionView[] = connectionRows.map((r) => ({
    id: r.id,
    sourceItemId: r.source_item_id,
    targetItemId: r.target_item_id,
    targetFilename: r.target_filename,
    targetOriginalPath: r.target_original_path,
    proposedType: r.proposed_type as ConnectionSuggestionView["proposedType"],
    matchedIdentifierType: r.matched_identifier_type,
    matchedIdentifierValue: r.matched_identifier_value,
    confidence: r.confidence as ConnectionSuggestionView["confidence"],
    rationale: r.rationale,
    contradictionWarning: r.contradiction_warning,
    state: (run.stale && r.state === "proposed" ? "stale" : r.state) as ConnectionSuggestionView["state"],
  }));

  const exampleRows = db
    .prepare(
      `SELECT are.*, ei.original_filename AS example_filename, ei.original_path AS example_original_path
         FROM analysis_retrieved_examples are
         JOIN evidence_items ei ON ei.id = are.example_item_id
        WHERE are.analysis_run_id = ?
        ORDER BY are.influence_score DESC, are.id`,
    )
    .all(runId) as {
    id: number;
    example_item_id: string;
    example_evidence_type_id: string;
    matched_signals_json: string;
    influence_score: number;
    agreement: string;
    example_filename: string;
    example_original_path: string;
  }[];
  const retrievedExamples: RetrievedExampleView[] = exampleRows.map((r) => ({
    id: r.id,
    exampleItemId: r.example_item_id,
    exampleFilename: r.example_filename,
    exampleOriginalPath: r.example_original_path,
    exampleEvidenceTypeId: r.example_evidence_type_id,
    matchedSignals: JSON.parse(r.matched_signals_json),
    influenceScore: r.influence_score,
    agreement: r.agreement as RetrievedExampleView["agreement"],
  }));

  return {
    run,
    evidenceTypeSuggestions,
    answerSuggestions,
    entities,
    dates,
    connectionSuggestions,
    retrievedExamples,
    summary: {
      answerCount: answerSuggestions.filter((s) => s.state !== "stale" && s.state !== "superseded").length,
      dateCount: dates.length,
      identifierCount: entities.length,
      connectionCount: connectionSuggestions.filter((s) => s.state === "proposed").length,
    },
    providerAvailable,
  };
}

/**
 * The one place staged suggestions can become confirmed values. Every
 * step below is a real validation, not a formality:
 *
 * 1. Whitelists exactly the fields a confirm request can touch
 *    (evidence type, registered-question answers, selected connections)
 *    — the request body can never become an arbitrary database update.
 * 2/3. Reloads the evidence item and rejects if its source fingerprint
 *    no longer matches the analysis run's (the file changed since
 *    analysis) or the run itself is stale/superseded.
 * 4/5. Validates the accepted evidence type is a real registry id and
 *    loads *its* exact registered questions — an accepted answer for a
 *    question that doesn't belong to the (possibly just-accepted) type
 *    is rejected.
 * 6. Validates confidence values against the shared enum.
 * 7/8. Rechecks every accepted connection target still exists and isn't
 *    already a confirmed connection.
 * 9/10. Saves through saveDraftWithTx and createConnection — the exact
 *    same functions manual review uses — inside one transaction with
 *    everything else here.
 * 11/12/13. Rejected/unresolved suggestions are left untouched; accepted
 *    ones are marked 'accepted' (or 'edited', recording the correction)
 *    with a confirmedAt timestamp.
 */
export function confirmAnalysisSuggestions(db: Database.Database, workspaceId: number, itemId: string, request: ConfirmAnalysisRequest): ConfirmAnalysisResponse {
  const item = getEvidenceItemRow(db, workspaceId, itemId);
  if (!item) throw new AnalysisItemNotFoundError(`Evidence item ${itemId} not found in this workspace`);

  const runRow = db.prepare("SELECT * FROM analysis_runs WHERE id = ? AND workspace_id = ? AND evidence_item_id = ?").get(request.analysisRunId, workspaceId, itemId) as RunRow | undefined;
  if (!runRow) throw new AnalysisRunNotFoundError(`Analysis run ${request.analysisRunId} not found for this evidence item`);
  if (computeRunStaleness(runRow, item)) {
    throw new AnalysisValidationError("This analysis is stale (the file or registry changed since it ran) — re-analyze before confirming.");
  }

  // 1. Whitelist: only suggestion rows that actually belong to this
  // exact run/item are ever looked up — an id from a different item or
  // a different run is simply not found, never blindly trusted.
  const suggestionRow = (id: number) =>
    db.prepare("SELECT * FROM evidence_suggestions WHERE id = ? AND analysis_run_id = ? AND evidence_item_id = ?").get(id, request.analysisRunId, itemId) as SuggestionRow | undefined;

  let acceptedTypeId: string | null = null;
  if (request.acceptedEvidenceTypeSuggestionId !== null) {
    const row = suggestionRow(request.acceptedEvidenceTypeSuggestionId);
    if (!row || row.field_kind !== "evidence_type") throw new AnalysisValidationError("The accepted evidence-type suggestion was not found for this analysis run");
    acceptedTypeId = row.proposed_value;
  }

  const effectiveTypeId = acceptedTypeId ?? item.evidence_type_id;
  const validQuestionIds = effectiveTypeId ? new Set(getInterviewForType(effectiveTypeId).map((q) => q.id)) : new Set<string>();

  const acceptedAnswerRows: { row: SuggestionRow; value: string }[] = [];
  for (const accepted of request.acceptedAnswers) {
    const row = suggestionRow(accepted.suggestionId);
    if (!row || row.field_kind !== "question_answer" || !row.field_id) {
      throw new AnalysisValidationError(`Suggestion ${accepted.suggestionId} was not found for this analysis run`);
    }
    if (!validQuestionIds.has(row.field_id)) {
      throw new AnalysisValidationError(`"${row.field_id}" is not a registered question for evidence type "${effectiveTypeId}"`);
    }
    if (!SUGGESTION_CONFIDENCES.includes(row.confidence as (typeof SUGGESTION_CONFIDENCES)[number])) {
      throw new AnalysisValidationError(`Suggestion ${accepted.suggestionId} has an invalid confidence value`);
    }
    if (!accepted.value || !accepted.value.trim()) {
      throw new AnalysisValidationError(`An accepted answer for "${row.field_id}" must not be empty`);
    }
    acceptedAnswerRows.push({ row, value: accepted.value });
  }

  const acceptedConnectionRows = request.acceptedConnectionSuggestionIds.map((id) => {
    const row = db
      .prepare("SELECT * FROM connection_suggestions WHERE id = ? AND analysis_run_id = ? AND source_item_id = ?")
      .get(id, request.analysisRunId, itemId) as
      | { id: number; target_item_id: string; proposed_type: string; rationale: string; confidence: string; state: string }
      | undefined;
    if (!row) throw new AnalysisValidationError(`Connection suggestion ${id} was not found for this analysis run`);
    const targetExists = db.prepare("SELECT id, original_path FROM evidence_items WHERE workspace_id = ? AND id = ?").get(workspaceId, row.target_item_id) as { id: string; original_path: string } | undefined;
    if (!targetExists) throw new AnalysisValidationError(`The target evidence item for connection suggestion ${id} no longer exists`);
    return { row, targetOriginalPath: targetExists.original_path };
  });

  const run = db.transaction(() => {
    if (acceptedTypeId || acceptedAnswerRows.length > 0) {
      // saveDraftWithTx's payload always carries the item's *current*
      // notes and no-related-evidence flag through unchanged —
      // reviewDraftService.saveNotes/setNoRelatedEvidence both write
      // whatever they're given unconditionally, so passing a default
      // (empty notes, false) here would silently erase either one as a
      // side effect of accepting a suggestion. Analysis must never do
      // that — only the fields the user actually accepted change.
      const current = db.prepare("SELECT notes, no_related_evidence FROM evidence_items WHERE id = ?").get(itemId) as { notes: string | null; no_related_evidence: number };
      const payload: ReviewDraftPayload = {
        evidenceType: acceptedTypeId ? { typeId: acceptedTypeId, source: "user", confidence: null, reason: "Accepted from an Evidence Intelligence suggestion" } : null,
        interviewAnswers: Object.fromEntries(
          acceptedAnswerRows.map(({ row, value }) => [row.field_id!, { value, confidence: row.confidence as (typeof SUGGESTION_CONFIDENCES)[number], note: value !== row.proposed_value ? "Edited from an Evidence Intelligence suggestion" : null }]),
        ),
        connectionsToAdd: [],
        connectionIdsToRemove: [],
        noRelatedEvidence: Boolean(current.no_related_evidence),
        usefulnessOverride: { action: "none", score: null, band: null, note: null },
        notes: current.notes ?? "",
        decisionAction: null,
      };
      saveDraftWithTx(db, workspaceId, itemId, payload);
    }

    let acceptedConnectionCount = 0;
    for (const { row, targetOriginalPath } of acceptedConnectionRows) {
      const alreadyConfirmed = db
        .prepare("SELECT id FROM connections WHERE (source_item_id = ? AND target_item_id = ?) OR (source_item_id = ? AND target_item_id = ?)")
        .get(itemId, row.target_item_id, row.target_item_id, itemId);
      if (!alreadyConfirmed) {
        createConnection(db, workspaceId, itemId, targetOriginalPath, {
          type: row.proposed_type as ReviewDraftPayload["connectionsToAdd"][number]["type"],
          explanation: row.rationale,
          confidence: row.confidence as (typeof SUGGESTION_CONFIDENCES)[number],
        });
        acceptedConnectionCount++;
      }
      db.prepare("UPDATE connection_suggestions SET state = 'accepted', confirmed_at = datetime('now') WHERE id = ?").run(row.id);
    }
    for (const id of request.rejectedConnectionSuggestionIds) {
      db.prepare("UPDATE connection_suggestions SET state = 'rejected' WHERE id = ? AND analysis_run_id = ? AND source_item_id = ?").run(id, request.analysisRunId, itemId);
    }

    if (acceptedTypeId) {
      db.prepare("UPDATE evidence_suggestions SET state = 'accepted', confirmed_at = datetime('now') WHERE id = ?").run(request.acceptedEvidenceTypeSuggestionId);
    }
    for (const { row, value } of acceptedAnswerRows) {
      const edited = value !== row.proposed_value;
      db.prepare("UPDATE evidence_suggestions SET state = ?, user_correction = ?, confirmed_at = datetime('now') WHERE id = ?").run(edited ? "edited" : "accepted", edited ? value : null, row.id);
    }
    for (const id of request.rejectedSuggestionIds) {
      db.prepare("UPDATE evidence_suggestions SET state = 'rejected' WHERE id = ? AND analysis_run_id = ? AND evidence_item_id = ?").run(id, request.analysisRunId, itemId);
    }

    return { acceptedConnectionCount };
  })();

  return {
    evidenceItemId: itemId,
    acceptedEvidenceType: acceptedTypeId,
    acceptedAnswerCount: acceptedAnswerRows.length,
    acceptedConnectionCount: run.acceptedConnectionCount,
    rejectedCount: request.rejectedSuggestionIds.length + request.rejectedConnectionSuggestionIds.length,
  };
}
