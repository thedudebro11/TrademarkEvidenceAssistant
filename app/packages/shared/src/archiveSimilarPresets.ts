import {
  DESIGN_MOCKUP_COPIED_QUESTION_IDS,
  DESIGN_MOCKUP_DERIVED_QUESTION_IDS,
  DESIGN_MOCKUP_EVIDENCE_TYPE_ID,
  DESIGN_MOCKUP_QUESTION_IDS,
  PRODUCT_MOCKUP_EVIDENCE_TYPE_ID,
  PRODUCT_MOCKUP_QUESTION_IDS,
  getArchiveSimilarEligibility,
  getDesignMockupArchiveSimilarEligibility,
  getEarlierLogoIterationArchiveSimilarEligibility,
  validateDesignMockupTemplate,
  validateEarlierLogoIterationTemplate,
  validateProductMockupTemplate,
  type ArchiveSimilarAnswerInput,
  type ArchiveSimilarCandidateInput,
  type ArchiveSimilarEligibilityResult,
  type ArchiveSimilarReasonCode,
  type ArchiveSimilarSourceInput,
  type ArchiveSimilarTemplateInput,
} from "./archiveSimilarEligibility.js";
import type { ReviewDecisionAction } from "./enums.js";

/**
 * The preset registry (docs/ADR_0004_ARCHIVE_SIMILAR.md's Design Mockup
 * extensions) — the one place that maps an evidence type id to the
 * whole bundle of behavior Archive Similar needs for it: template
 * validation, eligibility, which questions are copied vs. derived
 * per-item, an operation-type tag for the audit log, and the modal's
 * copy. The server (bulkReviewService.ts) and the web client
 * (ArchiveSimilarModal.tsx, ReviewQueue.tsx) both resolve a preset
 * through this file rather than hardcoding a second parallel switch —
 * this is the "one place defines what each preset means" contract for
 * the multi-preset architecture, per docs/ARCHITECTURE_CONSTITUTION.md #2.
 *
 * Each preset's own logic still lives in its own well-named function in
 * archiveSimilarEligibility.ts — this file only wires them together, it
 * doesn't reimplement them.
 *
 * Three presets are wired up. Two of them — `design_mockup` (unused
 * design) and `design_mockup_earlier_logo_iteration` — share the exact
 * same `evidenceTypeId` (`design_mockup`), so evidence-type id alone no
 * longer identifies a unique preset. `getArchiveSimilarPresetsForEvidenceType`
 * returns every preset registered for an evidence type (one for
 * `product_mockup`, two for `design_mockup`), and `resolveArchiveSimilarPreset`
 * is the actual disambiguation step: it tries each candidate's own
 * `validateTemplate` against the live answers and returns the first one
 * that validates. The two `design_mockup` presets are mutually
 * exclusive by construction (one requires `design_mockup_related_final_logo`
 * = "No", the other requires "Yes"), so at most one can ever validate
 * for a given answer set — resolution is always deterministic, never a
 * guess.
 */

export type ArchiveSimilarPresetId = "product_mockup" | "design_mockup" | "design_mockup_earlier_logo_iteration";

export interface ArchiveSimilarPresetDefinition {
  id: ArchiveSimilarPresetId;
  evidenceTypeId: string;
  /** Distinct `bulk_review_operations.operation_type` value for this preset's audit rows. */
  operationType: string;
  /** Questions copied verbatim from the source item's live template to every target. */
  copiedQuestionIds: readonly string[];
  /** Questions computed fresh per-item rather than copied (empty for Product Mockup). */
  derivedQuestionIds: readonly string[];
  /**
   * Subset of `copiedQuestionIds` that do NOT need a live answer for
   * this preset's button to become available — used for a question a
   * preset auto-defaults (Earlier Logo Iterations' `defaultCreator`)
   * rather than requiring the user to answer it first. Absent/empty for
   * presets with no such question (Product Mockup, the unused-design
   * Design Mockup preset).
   */
  optionalCopiedQuestionIds?: readonly string[];
  /** When set, this preset auto-prefills this question (currently always `design_mockup_creator`) with this exact value whenever the live/target answer is blank — defined once here so no UI or service file hardcodes the literal creator name. */
  defaultCreator?: string;
  validateTemplate: (input: ArchiveSimilarTemplateInput) => { valid: boolean; reasonCode: ArchiveSimilarReasonCode | null };
  /** The single eligibility check for this preset — common checks plus this preset's own protected-connection/derived-field rules. `templateAnswers` is required by the signature (Design Mockup's protected-connection policy needs it); Product Mockup's implementation simply ignores it. */
  checkEligibility: (
    file: ArchiveSimilarCandidateInput,
    currentReview: ArchiveSimilarSourceInput,
    templateAnswers: Record<string, ArchiveSimilarAnswerInput>,
  ) => ArchiveSimilarEligibilityResult;
  modalTitle: string;
  modalDescription: string;
  confirmLabel: (count: number) => string;
}

/** Single, central definition of the default creator value for the Earlier Logo Iterations preset — see `ArchiveSimilarPresetDefinition.defaultCreator`'s doc comment for why this must never be duplicated elsewhere. */
export const EARLIER_LOGO_ITERATION_DEFAULT_CREATOR = "Oscar V & Michael M";

export const ARCHIVE_SIMILAR_PRESETS: Record<ArchiveSimilarPresetId, ArchiveSimilarPresetDefinition> = {
  product_mockup: {
    id: "product_mockup",
    evidenceTypeId: PRODUCT_MOCKUP_EVIDENCE_TYPE_ID,
    operationType: "BULK_ARCHIVE_SIMILAR",
    copiedQuestionIds: Object.values(PRODUCT_MOCKUP_QUESTION_IDS),
    derivedQuestionIds: [],
    validateTemplate: (input) => validateProductMockupTemplate(input),
    checkEligibility: (file, currentReview) => getArchiveSimilarEligibility(file, currentReview),
    modalTitle: "Archive Similar Product Mockups",
    modalDescription: "Apply this concept-only Product Mockup review to eligible images in the current folder and archive them.",
    confirmLabel: (count) => `Apply Review & Archive ${count} Similar Files`,
  },
  design_mockup: {
    id: "design_mockup",
    evidenceTypeId: DESIGN_MOCKUP_EVIDENCE_TYPE_ID,
    operationType: "BULK_ARCHIVE_SIMILAR_DESIGN_MOCKUPS",
    copiedQuestionIds: DESIGN_MOCKUP_COPIED_QUESTION_IDS,
    derivedQuestionIds: DESIGN_MOCKUP_DERIVED_QUESTION_IDS,
    validateTemplate: (input) => validateDesignMockupTemplate(input),
    checkEligibility: (file, currentReview, templateAnswers) => getDesignMockupArchiveSimilarEligibility(file, currentReview, templateAnswers),
    modalTitle: "Archive Similar Design Mockups",
    modalDescription: "Apply the shared unused-design review to eligible Design Mockups in this folder. Each file will receive its own filesystem last-modified date.",
    confirmLabel: (count) => `Apply Review & Archive ${count} Design Mockups`,
  },
  design_mockup_earlier_logo_iteration: {
    id: "design_mockup_earlier_logo_iteration",
    evidenceTypeId: DESIGN_MOCKUP_EVIDENCE_TYPE_ID,
    operationType: "ARCHIVE_SIMILAR_EARLIER_LOGO_ITERATIONS",
    copiedQuestionIds: DESIGN_MOCKUP_COPIED_QUESTION_IDS,
    derivedQuestionIds: DESIGN_MOCKUP_DERIVED_QUESTION_IDS,
    optionalCopiedQuestionIds: [DESIGN_MOCKUP_QUESTION_IDS.creator],
    defaultCreator: EARLIER_LOGO_ITERATION_DEFAULT_CREATOR,
    validateTemplate: (input) => validateEarlierLogoIterationTemplate(input),
    checkEligibility: (file, currentReview, templateAnswers) => getEarlierLogoIterationArchiveSimilarEligibility(file, currentReview, templateAnswers),
    modalTitle: "Archive Similar Earlier Logo Iterations",
    modalDescription: "Archive eligible internal logo concepts that contributed to the final logo. Each file will receive its own creation date.",
    confirmLabel: (count) => `Apply Review & Archive ${count} Earlier Logo Iterations`,
  },
};

export function getArchiveSimilarPreset(presetId: ArchiveSimilarPresetId): ArchiveSimilarPresetDefinition {
  return ARCHIVE_SIMILAR_PRESETS[presetId];
}

/** Every preset registered for an evidence type — `[]` for anything with no Archive Similar preset at all, one entry for `product_mockup`, two for `design_mockup` (see this file's doc comment). */
export function getArchiveSimilarPresetsForEvidenceType(evidenceTypeId: string | null): ArchiveSimilarPresetDefinition[] {
  if (evidenceTypeId === PRODUCT_MOCKUP_EVIDENCE_TYPE_ID) return [ARCHIVE_SIMILAR_PRESETS.product_mockup];
  if (evidenceTypeId === DESIGN_MOCKUP_EVIDENCE_TYPE_ID) return [ARCHIVE_SIMILAR_PRESETS.design_mockup, ARCHIVE_SIMILAR_PRESETS.design_mockup_earlier_logo_iteration];
  return [];
}

/**
 * Resolves the exact preset a live (possibly unsaved) answer set
 * qualifies for, or `null` if it matches none. Tries each preset
 * registered for `evidenceTypeId` in turn, in the order
 * `getArchiveSimilarPresetsForEvidenceType` returns them, and returns
 * the first whose own `validateTemplate` accepts `answers`/`decisionAction`.
 * This is the single function both the server (rejecting a forged
 * request, and deciding which preset an apply/preview call actually
 * means) and the web client (button enablement, modal preset selection)
 * use — so which preset applies can never be decided two different ways.
 */
export function resolveArchiveSimilarPreset(
  evidenceTypeId: string | null,
  answers: Record<string, ArchiveSimilarAnswerInput>,
  decisionAction: ReviewDecisionAction | null,
): ArchiveSimilarPresetDefinition | null {
  for (const preset of getArchiveSimilarPresetsForEvidenceType(evidenceTypeId)) {
    if (preset.validateTemplate({ evidenceTypeId, answers, decisionAction }).valid) {
      return preset;
    }
  }
  return null;
}

/** Reverse lookup by a bulk operation's own recorded `operation_type` — used by Undo to recover exactly which preset produced a historical operation, since re-deriving it from the operation's `evidence_type_id` alone would be ambiguous now that two presets share `design_mockup`. */
export function getArchiveSimilarPresetByOperationType(operationType: string): ArchiveSimilarPresetDefinition | null {
  return Object.values(ARCHIVE_SIMILAR_PRESETS).find((p) => p.operationType === operationType) ?? null;
}
