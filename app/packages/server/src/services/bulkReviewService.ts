import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import {
  ARCHIVE_SIMILAR_REASON_LABELS,
  DESIGN_MOCKUP_QUESTION_IDS,
  SUGGESTION_CONFIDENCES,
  deriveDesignMockupDateAnswer,
  folderOf,
  getArchiveSimilarPresetByOperationType,
  getArchiveSimilarPresetsForEvidenceType,
  resolveArchiveSimilarPreset,
  type ArchiveSimilarApplyResponse,
  type ArchiveSimilarCandidateInput,
  type ArchiveSimilarConnectionInfo,
  type ArchiveSimilarDerivedAnswer,
  type ArchiveSimilarDerivedFieldInfo,
  type ArchiveSimilarEligibleItem,
  type ArchiveSimilarExcludedItem,
  type ArchiveSimilarItemSnapshot,
  type ArchiveSimilarPresetDefinition,
  type ArchiveSimilarPreviewResponse,
  type ArchiveSimilarReasonCode,
  type ArchiveSimilarReviewTemplate,
  type ArchiveSimilarSkippedItem,
  type ArchiveSimilarUndoResponse,
  type BulkOperationStatus,
  type BulkOperationUndoStatus,
  type ConnectionType,
  type DraftInterviewAnswer,
  type InclusionDecision,
  type ReviewDraftPayload,
  type ReviewStatus,
  type SuggestionConfidence,
} from "@trademark-evidence-assistant/shared";
import { saveDraftWithTx } from "./reviewDraftService.js";

export class BulkReviewValidationError extends Error {}
export class BulkOperationNotFoundError extends Error {}

/**
 * "Archive Similar" (docs/ADR_0004_ARCHIVE_SIMILAR.md, extended for
 * Design Mockup). Two presets are wired up (shared/archiveSimilarPresets.ts):
 * Product Mockup (v1, unchanged) and Design Mockup, which additionally
 * derives one question — "Roughly when was this created?" — per item
 * from that item's own `fs_modified_at`, never copied from the
 * source. Everything here revolves around each preset's own
 * `checkEligibility`: preview, apply, and undo all call it fresh
 * against the database's *current* state — nothing here trusts a
 * client-supplied candidate list or a client-supplied derived date.
 *
 * Transaction architecture: `saveDraftWithTx` (reviewDraftService.ts)
 * has no transaction of its own — this service opens exactly one
 * `db.transaction()` per apply/undo and calls it directly per affected
 * item, so a failure partway through rolls back every item in that
 * operation, not just the one that failed. The one exception is the
 * audit *envelope* row (`bulk_review_operations`): it's inserted before
 * the mutation transaction and updated after, specifically so a failed
 * operation still leaves a record explaining that it was attempted and
 * failed — that row's insert/update statements are intentionally
 * outside the rolled-back transaction.
 */

interface EvidenceItemRow {
  id: string;
  original_path: string;
  original_filename: string;
  extension: string;
  review_status: string;
  inclusion_decision: string | null;
  evidence_type_id: string | null;
  fs_modified_at: string | null;
}

/**
 * Every other item in the same folder as `excludeId`'s source, with its
 * connection types pre-joined in one batched query — never one query
 * per candidate. `folderOf` filtering happens in JS (same pattern
 * `buildEvidenceTree` already uses) since SQLite has no `dirname()`.
 * Each candidate carries both the flat `connectionTypes` list (Product
 * Mockup's allowlist check) and the richer `connections` list with
 * direction + the *other* item's confirmed evidence type (Design
 * Mockup's semantics-aware protected-connection policy) — computed from
 * the same query, so the two presets can never see a different picture
 * of a candidate's real connections.
 */
function getFolderCandidates(
  db: Database.Database,
  workspaceId: number,
  folderPath: string,
  excludeItemId: string,
): { input: ArchiveSimilarCandidateInput; filename: string }[] {
  const rows = db
    .prepare(
      `SELECT id, original_path, original_filename, extension, review_status, inclusion_decision, evidence_type_id, fs_modified_at
       FROM evidence_items WHERE workspace_id = ? AND id != ?`,
    )
    .all(workspaceId, excludeItemId) as EvidenceItemRow[];

  const inFolder = rows.filter((r) => folderOf(r.original_path) === folderPath);
  if (inFolder.length === 0) return [];

  const ids = inFolder.map((r) => r.id);
  const placeholders = ids.map(() => "?").join(",");
  const connRows = db
    .prepare(
      `SELECT c.source_item_id, c.target_item_id, c.type,
              src.evidence_type_id AS source_evidence_type_id,
              tgt.evidence_type_id AS target_evidence_type_id
       FROM connections c
       JOIN evidence_items src ON src.id = c.source_item_id
       JOIN evidence_items tgt ON tgt.id = c.target_item_id
       WHERE c.source_item_id IN (${placeholders}) OR c.target_item_id IN (${placeholders})`,
    )
    .all(...ids, ...ids) as {
    source_item_id: string;
    target_item_id: string;
    type: string;
    source_evidence_type_id: string | null;
    target_evidence_type_id: string | null;
  }[];

  const connectionTypesByItem = new Map<string, ConnectionType[]>();
  const connectionsByItem = new Map<string, ArchiveSimilarConnectionInfo[]>();
  const idSet = new Set(ids);
  for (const row of connRows) {
    if (idSet.has(row.source_item_id)) {
      const list = connectionTypesByItem.get(row.source_item_id) ?? [];
      list.push(row.type as ConnectionType);
      connectionTypesByItem.set(row.source_item_id, list);
      const rich = connectionsByItem.get(row.source_item_id) ?? [];
      rich.push({ type: row.type as ConnectionType, direction: "outgoing", otherItemEvidenceTypeId: row.target_evidence_type_id });
      connectionsByItem.set(row.source_item_id, rich);
    }
    if (idSet.has(row.target_item_id)) {
      const list = connectionTypesByItem.get(row.target_item_id) ?? [];
      list.push(row.type as ConnectionType);
      connectionTypesByItem.set(row.target_item_id, list);
      const rich = connectionsByItem.get(row.target_item_id) ?? [];
      rich.push({ type: row.type as ConnectionType, direction: "incoming", otherItemEvidenceTypeId: row.source_evidence_type_id });
      connectionsByItem.set(row.target_item_id, rich);
    }
  }

  // Only consumed by the Earlier Logo Iterations preset (its
  // auto-defaulted creator answer must never silently overwrite a
  // value a human already entered on this specific candidate) — cheap
  // to fetch unconditionally for every candidate set, since it's one
  // indexed batch query keyed by a fixed question id.
  const creatorRows = db
    .prepare(`SELECT evidence_item_id, value FROM review_answers WHERE question_id = ? AND evidence_item_id IN (${placeholders})`)
    .all(DESIGN_MOCKUP_QUESTION_IDS.creator, ...ids) as { evidence_item_id: string; value: string }[];
  const existingCreatorByItem = new Map(creatorRows.map((r) => [r.evidence_item_id, r.value]));

  return inFolder.map((r) => ({
    filename: r.original_filename,
    input: {
      id: r.id,
      originalPath: r.original_path,
      extension: r.extension,
      reviewStatus: r.review_status as ReviewStatus,
      inclusionDecision: r.inclusion_decision as InclusionDecision | null,
      evidenceTypeId: r.evidence_type_id,
      connectionTypes: connectionTypesByItem.get(r.id) ?? [],
      connections: connectionsByItem.get(r.id) ?? [],
      filesystemModifiedAt: r.fs_modified_at,
      existingCreatorAnswer: existingCreatorByItem.get(r.id) ?? null,
    },
  }));
}

function getSourceRow(db: Database.Database, workspaceId: number, sourceItemId: string): EvidenceItemRow {
  const row = db
    .prepare(
      `SELECT id, original_path, original_filename, extension, review_status, inclusion_decision, evidence_type_id, fs_modified_at
       FROM evidence_items WHERE workspace_id = ? AND id = ?`,
    )
    .get(workspaceId, sourceItemId) as EvidenceItemRow | undefined;
  if (!row) {
    throw new BulkReviewValidationError(`Evidence item ${sourceItemId} not found in this workspace`);
  }
  return row;
}

/**
 * Resolves and validates the preset for a submitted template, rejecting
 * both an unrecognized evidence type and a forged/incomplete template
 * for a recognized one — the single gate both preview and apply go
 * through before doing anything else. Design Mockup now has two
 * presets sharing one evidence type (the unused-design preset and
 * Earlier Logo Iterations); `resolveArchiveSimilarPreset` tries each
 * registered preset's own `validateTemplate` and returns whichever one
 * actually matches the submitted answers — they're mutually exclusive
 * by construction (opposite required values for
 * `design_mockup_related_final_logo`), so at most one can ever match.
 */
function assertValidTemplate(template: ArchiveSimilarReviewTemplate): ArchiveSimilarPresetDefinition {
  const preset = resolveArchiveSimilarPreset(template.evidenceTypeId, template.answers, template.decisionAction);
  if (preset) {
    return preset;
  }
  const candidates = getArchiveSimilarPresetsForEvidenceType(template.evidenceTypeId);
  if (candidates.length === 0) {
    throw new BulkReviewValidationError(`"${template.evidenceTypeId}" has no Archive Similar preset`);
  }
  // None of the registered presets for this evidence type validated —
  // report the last candidate's specific reason as representative
  // (every candidate's validateTemplate necessarily failed, so this is
  // always a real reasonCode, never null).
  const validation = candidates[candidates.length - 1].validateTemplate({
    evidenceTypeId: template.evidenceTypeId,
    answers: template.answers,
    decisionAction: template.decisionAction,
  });
  throw new BulkReviewValidationError(ARCHIVE_SIMILAR_REASON_LABELS[validation.reasonCode!]);
}

function relevantQuestionIdsFor(preset: ArchiveSimilarPresetDefinition): string[] {
  return [...preset.copiedQuestionIds, ...preset.derivedQuestionIds];
}

/** A deterministic fingerprint of the candidate set — not a security token, just a cheap "did the folder scope look the same at preview time" hint for the client. Server-side per-item revalidation during apply is what actually matters. */
function computePreviewToken(sourceItemId: string, folderPath: string, candidateIds: string[]): string {
  const canonical = JSON.stringify({ sourceItemId, folderPath, candidateIds: [...candidateIds].sort() });
  return createHash("sha256").update(canonical).digest("hex");
}

function derivedFieldInfoFor(preset: ArchiveSimilarPresetDefinition): ArchiveSimilarDerivedFieldInfo | null {
  const questionId = preset.derivedQuestionIds[0];
  if (!questionId) return null;
  return { questionId, source: "filesystem_last_modified", defaultConfidence: "medium" };
}

/** Design Mockup's one derived answer for a candidate, at the default "medium" confidence used for preview display — apply recomputes this fresh and applies whatever confidence the operation actually requested. `null` for a preset with no derived questions, or when the candidate's date can't be derived (should not occur for anything preview/apply already reported eligible). */
function derivedAnswersFor(preset: ArchiveSimilarPresetDefinition, filesystemModifiedAt: string | null): Record<string, ArchiveSimilarDerivedAnswer> | undefined {
  if (preset.derivedQuestionIds.length === 0) return undefined;
  const questionId = preset.derivedQuestionIds[0];
  const derived = deriveDesignMockupDateAnswer(filesystemModifiedAt);
  if (!derived.available) return undefined;
  return { [questionId]: { value: derived.answerValue!, confidence: "medium", note: derived.note } };
}

export function previewArchiveSimilar(
  db: Database.Database,
  workspaceId: number,
  sourceItemId: string,
  reviewTemplate: ArchiveSimilarReviewTemplate,
): ArchiveSimilarPreviewResponse {
  const preset = assertValidTemplate(reviewTemplate);
  const sourceRow = getSourceRow(db, workspaceId, sourceItemId);
  const folderPath = folderOf(sourceRow.original_path);
  const candidates = getFolderCandidates(db, workspaceId, folderPath, sourceItemId);
  const source = { id: sourceItemId, originalPath: sourceRow.original_path, evidenceTypeId: reviewTemplate.evidenceTypeId };

  const eligible: ArchiveSimilarEligibleItem[] = [];
  const excluded: ArchiveSimilarExcludedItem[] = [];
  for (const c of candidates) {
    const result = preset.checkEligibility(c.input, source, reviewTemplate.answers);
    if (result.eligible) {
      eligible.push({
        itemId: c.input.id,
        filename: c.filename,
        originalPath: c.input.originalPath,
        reviewStatus: c.input.reviewStatus,
        evidenceTypeId: c.input.evidenceTypeId,
        derivedAnswers: derivedAnswersFor(preset, c.input.filesystemModifiedAt ?? null),
      });
    } else {
      excluded.push({ itemId: c.input.id, filename: c.filename, reasonCode: result.reasonCode as ArchiveSimilarReasonCode, reasonLabel: result.reasonLabel! });
    }
  }

  return {
    presetId: preset.id,
    sourceItem: { itemId: sourceItemId, filename: sourceRow.original_filename, originalPath: sourceRow.original_path },
    scope: { folderPath, evidenceTypeId: preset.evidenceTypeId, mediaType: "image" },
    templateSummary: reviewTemplate,
    derivedField: derivedFieldInfoFor(preset),
    eligible,
    excluded,
    eligibleCount: eligible.length,
    excludedCount: excluded.length,
    previewToken: computePreviewToken(sourceItemId, folderPath, candidates.map((c) => c.input.id)),
  };
}

function snapshotItemReviewState(db: Database.Database, itemId: string, relevantQuestionIds: string[]): ArchiveSimilarItemSnapshot {
  const row = db
    .prepare(
      `SELECT review_status, inclusion_decision, decided_at, evidence_type_id, evidence_type_registry_version,
              evidence_type_confidence, evidence_type_reason, evidence_type_source, evidence_type_confirmed_at, file_role
       FROM evidence_items WHERE id = ?`,
    )
    .get(itemId) as {
    review_status: string;
    inclusion_decision: string | null;
    decided_at: string | null;
    evidence_type_id: string | null;
    evidence_type_registry_version: string | null;
    evidence_type_confidence: string | null;
    evidence_type_reason: string | null;
    evidence_type_source: string | null;
    evidence_type_confirmed_at: string | null;
    file_role: string | null;
  };

  const answers: ArchiveSimilarItemSnapshot["answers"] = {};
  for (const questionId of relevantQuestionIds) {
    const a = db
      .prepare("SELECT value, source, confidence, note, answered_at FROM review_answers WHERE evidence_item_id = ? AND question_id = ?")
      .get(itemId, questionId) as { value: string; source: string; confidence: string | null; note: string | null; answered_at: string } | undefined;
    answers[questionId] = a
      ? { value: a.value, source: a.source, confidence: a.confidence as SuggestionConfidence | null, note: a.note, answeredAt: a.answered_at }
      : null;
  }

  return {
    reviewStatus: row.review_status as ReviewStatus,
    inclusionDecision: row.inclusion_decision as InclusionDecision | null,
    decidedAt: row.decided_at,
    evidenceTypeId: row.evidence_type_id,
    evidenceTypeRegistryVersion: row.evidence_type_registry_version,
    evidenceTypeConfidence: row.evidence_type_confidence as SuggestionConfidence | null,
    evidenceTypeReason: row.evidence_type_reason,
    evidenceTypeSource: row.evidence_type_source as "suggested" | "user" | null,
    evidenceTypeConfirmedAt: row.evidence_type_confirmed_at,
    fileRole: row.file_role,
    answers,
  };
}

/** Canonical JSON (sorted keys) so semantically-identical snapshots always hash the same, regardless of property insertion order — same technique web/reviewDraft.ts's isDraftDirty uses. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function computeItemFingerprint(snapshot: ArchiveSimilarItemSnapshot): string {
  return createHash("sha256").update(stableStringify(snapshot)).digest("hex");
}

function restoreItemReviewState(db: Database.Database, workspaceId: number, itemId: string, snapshot: ArchiveSimilarItemSnapshot): void {
  db.prepare(
    `UPDATE evidence_items SET
       review_status = ?, inclusion_decision = ?, decided_at = ?,
       evidence_type_id = ?, evidence_type_registry_version = ?, evidence_type_confidence = ?,
       evidence_type_reason = ?, evidence_type_source = ?, evidence_type_confirmed_at = ?, file_role = ?
     WHERE id = ? AND workspace_id = ?`,
  ).run(
    snapshot.reviewStatus,
    snapshot.inclusionDecision,
    snapshot.decidedAt,
    snapshot.evidenceTypeId,
    snapshot.evidenceTypeRegistryVersion,
    snapshot.evidenceTypeConfidence,
    snapshot.evidenceTypeReason,
    snapshot.evidenceTypeSource,
    snapshot.evidenceTypeConfirmedAt,
    snapshot.fileRole,
    itemId,
    workspaceId,
  );

  for (const [questionId, answer] of Object.entries(snapshot.answers)) {
    if (answer) {
      db.prepare(
        `INSERT INTO review_answers (evidence_item_id, question_id, value, source, confidence, note, answered_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(evidence_item_id, question_id) DO UPDATE SET
           value = excluded.value, source = excluded.source, confidence = excluded.confidence,
           note = excluded.note, answered_at = excluded.answered_at`,
      ).run(itemId, questionId, answer.value, answer.source, answer.confidence, answer.note, answer.answeredAt);
    } else {
      db.prepare("DELETE FROM review_answers WHERE evidence_item_id = ? AND question_id = ?").run(itemId, questionId);
    }
  }
  // Notes, no_related_evidence, and connections are deliberately never
  // touched by apply, so there is nothing to restore for them here.
}

/** The copied (non-derived) answers for one target, straight from the template — never includes a derived question, which `derivedAnswers` supplies separately. */
function copiedInterviewAnswers(preset: ArchiveSimilarPresetDefinition, template: ArchiveSimilarReviewTemplate): Record<string, DraftInterviewAnswer> {
  const result: Record<string, DraftInterviewAnswer> = {};
  for (const questionId of preset.copiedQuestionIds) {
    const answer = template.answers[questionId];
    if (answer) result[questionId] = { value: answer.value, confidence: answer.confidence, note: null };
  }
  return result;
}

function buildDraftPayload(
  preset: ArchiveSimilarPresetDefinition,
  template: ArchiveSimilarReviewTemplate,
  currentNotes: string,
  currentNoRelatedEvidence: boolean,
  derivedAnswers: Record<string, DraftInterviewAnswer>,
): ReviewDraftPayload {
  return {
    evidenceType: { typeId: template.evidenceTypeId, source: "user", confidence: null, reason: "Applied via Archive Similar bulk operation" },
    interviewAnswers: { ...copiedInterviewAnswers(preset, template), ...derivedAnswers },
    // Never touched by this feature — see docs/ADR_0004_ARCHIVE_SIMILAR.md "fields copied vs. never copied".
    connectionsToAdd: [],
    connectionIdsToRemove: [],
    noRelatedEvidence: currentNoRelatedEvidence,
    usefulnessOverride: { action: "none", score: null, band: null, note: null },
    notes: currentNotes,
    decisionAction: template.decisionAction,
  };
}

function resolveDateConfidence(requested: SuggestionConfidence | undefined): SuggestionConfidence {
  return requested && SUGGESTION_CONFIDENCES.includes(requested) ? requested : "medium";
}

export interface ApplyArchiveSimilarParams {
  sourceItemId: string;
  selectedItemIds: string[];
  reviewTemplate: ArchiveSimilarReviewTemplate;
  archiveCurrentItem: boolean;
  /** The source item's own complete, live Review Draft payload — see ArchiveSimilarApplyRequest's doc comment for why this can't just be reconstructed from the template. Required when archiveCurrentItem is true. */
  sourceItemPayload?: ReviewDraftPayload;
  idempotencyKey: string;
  initiatedBy?: string;
  /** Only meaningful for a preset with a derived field (Design Mockup) — see ArchiveSimilarApplyRequest.dateConfidence. */
  dateConfidence?: SuggestionConfidence;
}

interface OperationRow {
  id: number;
  requested_count: number;
  applied_count: number;
  skipped_count: number;
  failed_count: number;
  status: string;
}

function buildApplyResponseFromExistingOperation(db: Database.Database, operationId: number): ArchiveSimilarApplyResponse {
  const op = db.prepare("SELECT id, requested_count, applied_count, skipped_count, failed_count, status FROM bulk_review_operations WHERE id = ?").get(operationId) as OperationRow;
  const skippedRows = db
    .prepare("SELECT evidence_item_id, skip_reason_code FROM bulk_review_operation_items WHERE operation_id = ? AND result = 'skipped'")
    .all(operationId) as { evidence_item_id: string; skip_reason_code: string }[];
  return {
    operationId: op.id,
    requestedCount: op.requested_count,
    appliedCount: op.applied_count,
    skippedCount: op.skipped_count,
    failedCount: op.failed_count,
    skipped: skippedRows.map((r) => ({
      itemId: r.evidence_item_id,
      reasonCode: r.skip_reason_code as ArchiveSimilarReasonCode,
      reasonLabel: ARCHIVE_SIMILAR_REASON_LABELS[r.skip_reason_code as ArchiveSimilarReasonCode],
    })),
    status: op.status as BulkOperationStatus,
  };
}

/**
 * Applies the preset's review template to every still-eligible selected
 * item and archives them, plus the source item if requested. Never
 * trusts `selectedItemIds` — every one is re-run through the same
 * `preset.checkEligibility` `previewArchiveSimilar` used, against fresh
 * data, immediately before mutating anything. For a preset with a
 * derived field (Design Mockup), every target's derived answer is
 * likewise recomputed here from that item's *current*
 * `fs_modified_at` — the client's preview-time derived value is
 * never trusted or reused.
 */
export function applyArchiveSimilar(db: Database.Database, workspaceId: number, params: ApplyArchiveSimilarParams): ArchiveSimilarApplyResponse {
  const existingOp = db
    .prepare("SELECT id FROM bulk_review_operations WHERE workspace_id = ? AND idempotency_key = ?")
    .get(workspaceId, params.idempotencyKey) as { id: number } | undefined;
  if (existingOp) {
    return buildApplyResponseFromExistingOperation(db, existingOp.id);
  }

  const preset = assertValidTemplate(params.reviewTemplate);
  const relevantQuestionIds = relevantQuestionIdsFor(preset);
  const dateConfidence = resolveDateConfidence(params.dateConfidence);
  if (params.archiveCurrentItem && !params.sourceItemPayload) {
    throw new BulkReviewValidationError("sourceItemPayload is required when archiveCurrentItem is true");
  }
  const sourceRow = getSourceRow(db, workspaceId, params.sourceItemId);
  const folderPath = folderOf(sourceRow.original_path);
  const source = { id: params.sourceItemId, originalPath: sourceRow.original_path, evidenceTypeId: params.reviewTemplate.evidenceTypeId };

  const candidateMap = new Map(getFolderCandidates(db, workspaceId, folderPath, params.sourceItemId).map((c) => [c.input.id, c]));

  const toApply: string[] = [];
  const skipped: ArchiveSimilarSkippedItem[] = [];
  for (const itemId of params.selectedItemIds) {
    const candidate = candidateMap.get(itemId);
    if (!candidate) {
      skipped.push({ itemId, reasonCode: "ITEM_NOT_FOUND", reasonLabel: ARCHIVE_SIMILAR_REASON_LABELS.ITEM_NOT_FOUND });
      continue;
    }
    const result = preset.checkEligibility(candidate.input, source, params.reviewTemplate.answers);
    if (!result.eligible) {
      skipped.push({ itemId, reasonCode: result.reasonCode as ArchiveSimilarReasonCode, reasonLabel: result.reasonLabel! });
      continue;
    }
    toApply.push(itemId);
  }

  const requestedCount = params.selectedItemIds.length + (params.archiveCurrentItem ? 1 : 0);

  // The audit envelope row is inserted OUTSIDE the mutation transaction
  // (and committed immediately) so it survives even if the mutation
  // transaction below rolls back — a failed operation must still be
  // traceable, per the audit requirements.
  const insertOp = db
    .prepare(
      `INSERT INTO bulk_review_operations
         (workspace_id, operation_type, source_item_id, folder_path, evidence_type_id, review_template_json,
          status, idempotency_key, initiated_by, requested_count)
       VALUES (?, ?, ?, ?, ?, ?, 'in_progress', ?, ?, ?)`,
    )
    .run(
      workspaceId,
      preset.operationType,
      params.sourceItemId,
      folderPath,
      params.reviewTemplate.evidenceTypeId,
      JSON.stringify(params.reviewTemplate),
      params.idempotencyKey,
      params.initiatedBy ?? "user",
      requestedCount,
    );
  const operationId = Number(insertOp.lastInsertRowid);

  try {
    const applyMutations = db.transaction(() => {
      let appliedCount = 0;

      const applyToItem = (itemId: string, isSource: boolean, filesystemModifiedAt: string | null) => {
        const beforeState = snapshotItemReviewState(db, itemId, relevantQuestionIds);
        const derivedAnswerEntry = derivedAnswersFor(preset, filesystemModifiedAt);
        const derivedAnswers: Record<string, DraftInterviewAnswer> = {};
        if (derivedAnswerEntry) {
          for (const [questionId, answer] of Object.entries(derivedAnswerEntry)) {
            derivedAnswers[questionId] = { value: answer.value, confidence: dateConfidence, note: answer.note };
          }
        }

        let payload: ReviewDraftPayload;
        if (isSource) {
          // The source item's own live draft — preserves any unsaved
          // notes/connections/usefulness override exactly as the user
          // left them, which reconstructing a payload from DB-read
          // "current" values could never do (those unsaved values only
          // ever existed in the browser). For a preset with a derived
          // field, the source's OWN derived answer (from its OWN
          // filesystem timestamp) still overrides whatever the source
          // form's live draft held for that one question — never the
          // bulk template's value, and never blindly trusting the
          // user's own possibly-stale typed answer either, per "the
          // source form's date answer must never become the bulk
          // template." When the source's own date can't be derived,
          // its live draft answer for that question is left exactly as
          // the user entered it — that's the user's own explicit input
          // for their own item, not an invented or copied value.
          payload = params.sourceItemPayload!;
          if (Object.keys(derivedAnswers).length > 0) {
            payload = { ...payload, interviewAnswers: { ...payload.interviewAnswers, ...derivedAnswers } };
          }
        } else {
          const currentRow = db.prepare("SELECT notes, no_related_evidence FROM evidence_items WHERE id = ?").get(itemId) as {
            notes: string | null;
            no_related_evidence: number;
          };
          payload = buildDraftPayload(preset, params.reviewTemplate, currentRow.notes ?? "", Boolean(currentRow.no_related_evidence), derivedAnswers);
        }
        saveDraftWithTx(db, workspaceId, itemId, payload);
        const afterState = snapshotItemReviewState(db, itemId, relevantQuestionIds);
        db.prepare(
          `INSERT INTO bulk_review_operation_items
             (operation_id, evidence_item_id, is_source_item, result, before_state_json, after_state_json, item_version_before, item_version_after, applied_at)
           VALUES (?, ?, ?, 'applied', ?, ?, ?, ?, datetime('now'))`,
        ).run(operationId, itemId, isSource ? 1 : 0, JSON.stringify(beforeState), JSON.stringify(afterState), computeItemFingerprint(beforeState), computeItemFingerprint(afterState));
        appliedCount++;
      };

      for (const itemId of toApply) {
        const candidate = candidateMap.get(itemId)!;
        applyToItem(itemId, false, candidate.input.filesystemModifiedAt ?? null);
      }
      if (params.archiveCurrentItem) applyToItem(params.sourceItemId, true, sourceRow.fs_modified_at);

      for (const s of skipped) {
        db.prepare(
          "INSERT INTO bulk_review_operation_items (operation_id, evidence_item_id, is_source_item, result, skip_reason_code) VALUES (?, ?, 0, 'skipped', ?)",
        ).run(operationId, s.itemId, s.reasonCode);
      }

      return appliedCount;
    });

    const appliedCount = applyMutations();
    const status: BulkOperationStatus = skipped.length > 0 ? "partially_completed" : "completed";
    db.prepare(
      "UPDATE bulk_review_operations SET status = ?, completed_at = datetime('now'), applied_count = ?, skipped_count = ? WHERE id = ?",
    ).run(status, appliedCount, skipped.length, operationId);

    return { operationId, requestedCount, appliedCount, skippedCount: skipped.length, failedCount: 0, skipped, status };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    db.prepare("UPDATE bulk_review_operations SET status = 'failed', completed_at = datetime('now'), error_summary = ? WHERE id = ?").run(message, operationId);
    return { operationId, requestedCount, appliedCount: 0, skippedCount: skipped.length, failedCount: requestedCount - skipped.length, skipped, status: "failed" };
  }
}

interface BulkOperationItemRow {
  id: number;
  evidence_item_id: string;
  before_state_json: string;
  item_version_after: string;
}

function buildUndoResponseFromOperation(db: Database.Database, operationId: number): ArchiveSimilarUndoResponse {
  const op = db
    .prepare("SELECT restored_count, restore_skipped_count, undo_status FROM bulk_review_operations WHERE id = ?")
    .get(operationId) as { restored_count: number; restore_skipped_count: number; undo_status: string };
  const skippedRows = db
    .prepare("SELECT evidence_item_id, restore_skip_reason FROM bulk_review_operation_items WHERE operation_id = ? AND restore_result = 'skipped'")
    .all(operationId) as { evidence_item_id: string; restore_skip_reason: string }[];
  return {
    operationId,
    requestedCount: op.restored_count + op.restore_skipped_count,
    restoredCount: op.restored_count,
    skippedCount: op.restore_skipped_count,
    failedCount: 0,
    skipped: skippedRows.map((r) => ({
      itemId: r.evidence_item_id,
      reasonCode: r.restore_skip_reason as ArchiveSimilarReasonCode,
      reasonLabel: ARCHIVE_SIMILAR_REASON_LABELS[r.restore_skip_reason as ArchiveSimilarReasonCode],
    })),
    undoStatus: op.undo_status as BulkOperationUndoStatus,
  };
}

/**
 * Restores every item a bulk operation applied to its pre-operation
 * review state — for real, in the database, not a client-side-only
 * illusion. An item is only restored when its *current* state still
 * matches exactly what the bulk operation produced (compared via
 * content fingerprint, not a stored version counter, since evidence_items
 * has no generic row-version column); if a human changed it since, that
 * item is skipped and the newer manual work is preserved untouched.
 * Idempotent — undoing an already-undone operation just re-returns the
 * first outcome rather than re-running anything. Which questions count
 * toward the fingerprint/restore is derived from the *operation's own*
 * recorded evidence type (via the preset registry), not the questions
 * relevant today — so undoing an old operation is unaffected by any
 * later preset change.
 */
export function undoArchiveSimilar(db: Database.Database, workspaceId: number, operationId: number): ArchiveSimilarUndoResponse {
  const op = db.prepare("SELECT id, undone_at, evidence_type_id, operation_type FROM bulk_review_operations WHERE id = ? AND workspace_id = ?").get(operationId, workspaceId) as
    | { id: number; undone_at: string | null; evidence_type_id: string; operation_type: string }
    | undefined;
  if (!op) {
    throw new BulkOperationNotFoundError(`Bulk operation ${operationId} not found in this workspace`);
  }
  if (op.undone_at) {
    return buildUndoResponseFromOperation(db, operationId);
  }

  // Recovered by the operation's own recorded operation_type, not
  // re-derived from evidence_type_id alone — two presets
  // (design_mockup / design_mockup_earlier_logo_iteration) now share
  // one evidence type, so evidence_type_id alone can't identify which
  // one actually ran. Falls back to the first evidence-type match (both
  // design_mockup presets have identical copied/derived question ids,
  // so this fallback is always correct even if it picks "the wrong one").
  const preset = getArchiveSimilarPresetByOperationType(op.operation_type) ?? getArchiveSimilarPresetsForEvidenceType(op.evidence_type_id)[0] ?? null;
  const relevantQuestionIds = preset ? relevantQuestionIdsFor(preset) : [DESIGN_MOCKUP_QUESTION_IDS.creationDate];

  const items = db
    .prepare("SELECT id, evidence_item_id, before_state_json, item_version_after FROM bulk_review_operation_items WHERE operation_id = ? AND result = 'applied'")
    .all(operationId) as BulkOperationItemRow[];

  const restored: string[] = [];
  const skipped: ArchiveSimilarSkippedItem[] = [];

  const run = db.transaction(() => {
    for (const item of items) {
      const stillExists = db.prepare("SELECT id FROM evidence_items WHERE id = ? AND workspace_id = ?").get(item.evidence_item_id, workspaceId);
      if (!stillExists) {
        skipped.push({ itemId: item.evidence_item_id, reasonCode: "ITEM_NOT_FOUND", reasonLabel: ARCHIVE_SIMILAR_REASON_LABELS.ITEM_NOT_FOUND });
        db.prepare("UPDATE bulk_review_operation_items SET restore_result = 'skipped', restore_skip_reason = 'ITEM_NOT_FOUND', restored_at = datetime('now') WHERE id = ?").run(item.id);
        continue;
      }

      const currentFingerprint = computeItemFingerprint(snapshotItemReviewState(db, item.evidence_item_id, relevantQuestionIds));
      if (currentFingerprint !== item.item_version_after) {
        skipped.push({ itemId: item.evidence_item_id, reasonCode: "STATE_CHANGED_AFTER_PREVIEW", reasonLabel: ARCHIVE_SIMILAR_REASON_LABELS.STATE_CHANGED_AFTER_PREVIEW });
        db.prepare(
          "UPDATE bulk_review_operation_items SET restore_result = 'skipped', restore_skip_reason = 'STATE_CHANGED_AFTER_PREVIEW', restored_at = datetime('now') WHERE id = ?",
        ).run(item.id);
        continue;
      }

      const before = JSON.parse(item.before_state_json) as ArchiveSimilarItemSnapshot;
      restoreItemReviewState(db, workspaceId, item.evidence_item_id, before);
      restored.push(item.evidence_item_id);
      db.prepare("UPDATE bulk_review_operation_items SET restore_result = 'restored', restored_at = datetime('now') WHERE id = ?").run(item.id);
    }

    const undoStatus: BulkOperationUndoStatus = skipped.length === 0 ? "undone" : "partially_undone";
    db.prepare("UPDATE bulk_review_operations SET undone_at = datetime('now'), undo_status = ?, restored_count = ?, restore_skipped_count = ? WHERE id = ?").run(
      undoStatus,
      restored.length,
      skipped.length,
      operationId,
    );
    return undoStatus;
  });

  const undoStatus = run();

  return {
    operationId,
    requestedCount: items.length,
    restoredCount: restored.length,
    skippedCount: skipped.length,
    failedCount: 0,
    skipped,
    undoStatus,
  };
}
