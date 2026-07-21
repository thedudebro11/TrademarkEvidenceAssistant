import { dirname, extname, basename } from "node:path";
import type Database from "better-sqlite3";
import { EVIDENCE_TYPE_REGISTRY_META } from "@trademark-evidence-assistant/shared";

/**
 * Evidence Intelligence Phase 2 — explainable confirmed-example
 * retrieval. This is deterministic nearest-neighbor-by-shared-signal
 * scoring over the user's own prior confirmed decisions, never a trained
 * model and never opaque: every retrieved exemplar carries the exact
 * list of signals that matched, a 0..1 influence score, and whether it
 * agrees or disagrees with the classification currently being proposed.
 * See analysisService.ts's doc comment for how this feeds back into
 * confidence (conservatively — never past "medium" on exemplar
 * corroboration alone, matching the same "folder is a prior, never
 * proof" ceiling the rest of Phase 1/2 classification obeys).
 *
 * The text-overlap signal deliberately never re-runs OCR for an
 * exemplar: `getExemplarTextSignal` (supplied by the caller) reads
 * whatever raw text that exemplar's own most recent extracted_entities
 * already recorded from a past analysis run, so retrieval over a large
 * confirmed pool stays cheap and uses only already-persisted, real
 * extraction results — never a fresh, opaque re-read of the file.
 */

const MAX_RETRIEVED_EXAMPLES = 3;
/** Below this score an exemplar isn't similar enough to be worth showing at all. */
const MIN_INFLUENCE_SCORE = 0.2;

export interface ExemplarQueryInput {
  itemId: string;
  originalFilename: string;
  folderPath: string;
  extension: string;
  mimeType: string;
  ocrText: string | null;
}

export interface RetrievedExample {
  exampleItemId: string;
  exampleEvidenceTypeId: string;
  matchedSignals: string[];
  influenceScore: number;
  agreement: "supports" | "contradicts";
}

interface ConfirmedExemplarRow {
  id: string;
  original_path: string;
  original_filename: string;
  extension: string;
  mime_type: string;
  evidence_type_id: string;
}

/**
 * The eligible confirmed-exemplar pool for this workspace, computed
 * live from current state every time (never a stored/cached flag, same
 * convention as `effectiveStatus`/`computeRunStaleness` elsewhere in
 * this codebase) — a confirmed value that was later undone by Undo, or
 * an item that's gone missing since, simply stops qualifying the next
 * time this runs, with no separate reconciliation step needed:
 *
 *  - "manually confirmed" / "not generated-but-unconfirmed": evidence_type_id
 *    is only ever set by confirmType()/saveDraftWithTx, an explicit user
 *    action — Evidence Intelligence's own suggestions live in a
 *    completely separate table (evidence_suggestions) and are never
 *    promoted here just by existing.
 *  - "not pending": review_status is a settled state, not 'unreviewed'
 *    or 'in_review'.
 *  - "not later undone": Undo (bulkReviewService.ts) restores the item's
 *    prior evidence_type_id/review_status snapshot in place — if that
 *    reverted the confirmation, this live query simply no longer sees it
 *    as confirmed; there is nothing to separately "detect."
 *  - "not marked erroneous": this app has no dedicated erroneous flag,
 *    so `needs_follow_up` (review_status) and `not_useful`
 *    (inclusion_decision) are treated as the closest existing signals
 *    that a human has flagged something about this item as not
 *    trustworthy as a positive example.
 *  - "compatible with the current evidence-type and question registry":
 *    evidence_type_registry_version must equal the registry's current
 *    version — a confirmation made under a since-changed registry isn't
 *    reused blind.
 *  - "still present and readable": missing_since IS NULL.
 */
function getEligibleExemplarPool(db: Database.Database, workspaceId: number, excludeItemId: string): ConfirmedExemplarRow[] {
  return db
    .prepare(
      `SELECT id, original_path, original_filename, extension, mime_type, evidence_type_id
         FROM evidence_items
        WHERE workspace_id = ?
          AND id != ?
          AND evidence_type_id IS NOT NULL
          AND evidence_type_registry_version = ?
          AND missing_since IS NULL
          AND review_status NOT IN ('unreviewed', 'in_review', 'needs_follow_up')
          AND (inclusion_decision IS NULL OR inclusion_decision != 'not_useful')`,
    )
    .all(workspaceId, excludeItemId, EVIDENCE_TYPE_REGISTRY_META.version) as ConfirmedExemplarRow[];
}

/** Strips digits/punctuation/extension so "IMG_20260717_020251" and "IMG_20260717_020312" both normalize toward the same "img" stem, without ever claiming the files are the same. */
function filenameStem(filename: string): string {
  return basename(filename, extname(filename))
    .toLowerCase()
    .replace(/[0-9]+/g, "")
    .replace(/[^a-z]+/g, " ")
    .trim();
}

/** Lowercased, deduplicated significant words (3+ letters, so "of"/"an" don't count as shared signal) from OCR text — a coarse but fully explainable bag-of-words overlap check, never a semantic/embedding comparison. */
function significantWords(text: string): Set<string> {
  return new Set((text.toLowerCase().match(/[a-z]{3,}/g) ?? []).filter((w) => w.length >= 3));
}

/**
 * Scores one confirmed exemplar against the item currently being
 * analyzed. Every point added to the score has a corresponding entry in
 * `matchedSignals` — the score is never a black box.
 */
function scoreExemplar(input: ExemplarQueryInput, candidate: ConfirmedExemplarRow, candidateOcrText: string | null): { score: number; signals: string[] } {
  const signals: string[] = [];
  let score = 0;

  const candidateFolder = dirname(candidate.original_path) === "." ? "" : dirname(candidate.original_path);
  if (candidateFolder && candidateFolder === input.folderPath) {
    signals.push(`Same folder: "${candidateFolder}"`);
    score += 0.35;
  }

  if (candidate.extension.toLowerCase() === input.extension.toLowerCase()) {
    signals.push(`Same file extension: .${input.extension}`);
    score += 0.1;
  }

  if (candidate.mime_type === input.mimeType) {
    signals.push(`Same MIME type: ${input.mimeType}`);
    score += 0.05;
  }

  const candidateStem = filenameStem(candidate.original_filename);
  const inputStem = filenameStem(input.originalFilename);
  if (candidateStem && inputStem) {
    const candidateWords = new Set(candidateStem.split(" ").filter(Boolean));
    const inputWords = new Set(inputStem.split(" ").filter(Boolean));
    const sharedWords = [...candidateWords].filter((w) => inputWords.has(w));
    if (sharedWords.length > 0) {
      signals.push(`Similar filename structure: shares "${sharedWords.join(", ")}"`);
      score += 0.15;
    }
  }

  if (input.ocrText && candidateOcrText) {
    const inputWords = significantWords(input.ocrText);
    const candidateWords = significantWords(candidateOcrText);
    const shared = [...inputWords].filter((w) => candidateWords.has(w));
    if (shared.length >= 3) {
      signals.push(`Shares ${shared.length} recognizable text terms in common (e.g. "${shared.slice(0, 3).join('", "')}")`);
      score += Math.min(0.35, shared.length * 0.03);
    }
  }

  return { score: Math.min(1, score), signals };
}

/**
 * Retrieves up to `MAX_RETRIEVED_EXAMPLES` confirmed exemplars most
 * similar to the item being analyzed, ranked by explainable signal
 * overlap — never a trained model, never opaque. `topCandidateTypeId` is
 * the evidence-type candidate this retrieval is being run to help
 * evaluate (usually the deterministic engine's own top pick); each
 * retrieved exemplar is marked 'supports' or 'contradicts' by simple
 * equality against it.
 */
export function retrieveConfirmedExamples(
  db: Database.Database,
  workspaceId: number,
  input: ExemplarQueryInput,
  topCandidateTypeId: string | null,
  getExemplarTextSignal: (itemId: string) => string | null,
): RetrievedExample[] {
  const pool = getEligibleExemplarPool(db, workspaceId, input.itemId);
  const scored = pool
    .map((candidate) => {
      const { score, signals } = scoreExemplar(input, candidate, getExemplarTextSignal(candidate.id));
      return { candidate, score, signals };
    })
    .filter((s) => s.score >= MIN_INFLUENCE_SCORE && s.signals.length > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RETRIEVED_EXAMPLES);

  return scored.map(({ candidate, score, signals }) => ({
    exampleItemId: candidate.id,
    exampleEvidenceTypeId: candidate.evidence_type_id,
    matchedSignals: signals,
    influenceScore: Math.round(score * 100) / 100,
    agreement: topCandidateTypeId !== null && candidate.evidence_type_id === topCandidateTypeId ? "supports" : "contradicts",
  }));
}
