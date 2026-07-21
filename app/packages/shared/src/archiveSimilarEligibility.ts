import type { ConnectionType, InclusionDecision, ReviewDecisionAction, ReviewStatus, SuggestionConfidence } from "./enums.js";
import { getPreviewKind } from "./previewKind.js";
import { deriveDesignMockupDateAnswer } from "./filesystemDate.js";

/**
 * "Archive Similar" (docs/ADR_0004_ARCHIVE_SIMILAR.md, extended for
 * Design Mockup) — a bulk-review preset that lets the user apply one
 * item's review answers to other eligible, unreviewed images in the
 * same folder and archive them together. Two presets are wired up:
 * Product Mockup (v1) and Design Mockup (this extension). The shape
 * here is deliberately generic (a `context.presetEvidenceTypeId` rather
 * than a hardcoded check) so a preset can be added without changing
 * this function's signature — see archiveSimilarPresets.ts for the
 * registry that ties a preset id to its template validation, per-item
 * derived fields, and protected-connection policy.
 *
 * This module is the single source of truth for "is this file eligible
 * to be archived alongside the current one" — the server (preview/apply
 * routes) and the web client (button enablement, live modal state) both
 * import it, so they can never disagree about who qualifies
 * (docs/ARCHITECTURE_CONSTITUTION.md #2, "business rules exist exactly
 * once"). The server re-runs this same check immediately before
 * mutating anything and never trusts a client-supplied candidate list.
 */

export const PRODUCT_MOCKUP_EVIDENCE_TYPE_ID = "product_mockup";

export const PRODUCT_MOCKUP_QUESTION_IDS = {
  everProduced: "product_mockup_ever_produced",
  matchingRecord: "product_mockup_matching_record",
} as const;

export const DESIGN_MOCKUP_EVIDENCE_TYPE_ID = "design_mockup";

/** Exact ids from shared/evidenceTypeRegistry.ts's `design_mockup` entry — never re-derived from question wording. */
export const DESIGN_MOCKUP_QUESTION_IDS = {
  internalConcept: "design_mockup_internal_concept",
  finalDesign: "design_mockup_final_design",
  creator: "design_mockup_creator",
  publiclyReleased: "design_mockup_publicly_released",
  /** Deliberately never a "copied" question — see PER_ITEM_DERIVED constants below. Every other id here IS copied verbatim from the source template. */
  creationDate: "design_mockup_creation_date",
  relatedPsd: "design_mockup_related_psd",
  relatedFinalLogo: "design_mockup_related_final_logo",
} as const;

/** Questions copied verbatim from the source item's live template to every target — everything in the Design Mockup interview except the derived creation-date question. */
export const DESIGN_MOCKUP_COPIED_QUESTION_IDS: readonly string[] = [
  DESIGN_MOCKUP_QUESTION_IDS.internalConcept,
  DESIGN_MOCKUP_QUESTION_IDS.finalDesign,
  DESIGN_MOCKUP_QUESTION_IDS.creator,
  DESIGN_MOCKUP_QUESTION_IDS.publiclyReleased,
  DESIGN_MOCKUP_QUESTION_IDS.relatedPsd,
  DESIGN_MOCKUP_QUESTION_IDS.relatedFinalLogo,
];

/** Questions computed per-item rather than copied — exactly one, for this preset. */
export const DESIGN_MOCKUP_DERIVED_QUESTION_IDS: readonly string[] = [DESIGN_MOCKUP_QUESTION_IDS.creationDate];

/** Evidence types that represent a real, physical or sellable good — used by the `export_to_product` protected-connection rule below. */
const PRODUCT_LIKE_EVIDENCE_TYPE_IDS = new Set(["product_mockup", "product_photo", "lifestyle_photo", "packaging", "hang_tag", "label"]);

/** Evidence types that represent a real working source file — used by the `source_design_to_export` / HAS_WORKING_SOURCE_FILE rule below. */
const SOURCE_FILE_EVIDENCE_TYPE_IDS = new Set(["psd_source", "illustrator_source", "svg_source"]);

/**
 * Existing `ConnectionType` values (shared/enums.ts) treated as
 * "protected" for Archive Similar — a candidate carrying any of these,
 * in either direction, is never eligible, regardless of its review
 * status. No new connection types are introduced for this feature; this
 * is an explicit allowlist over the existing enum, not a name/keyword
 * search, per each type's actual documented semantics:
 *
 * - product_to_invoice: connects a product to an invoice — proof of a
 *   real commercial transaction/order for that item.
 * - invoice_to_shipment: proof the order was actually fulfilled/shipped.
 * - invoice_to_customer: proof of a real customer relationship/order.
 * - product_to_social_post: connects a product to a public post —
 *   functionally a product listing/public offering for sale.
 * - social_post_to_customer_photo: connects a public post to an actual
 *   customer's photo of the product — strong evidence the physical
 *   product reached a real customer.
 * - customer_photo_to_message: connects a customer photo to a customer
 *   communication — a real customer interaction.
 * - supports_commercial_use: is, by definition, commercial-use evidence.
 * - supports_continuous_use: is, by definition, continuous-use evidence.
 *
 * Deliberately NOT protected: `source_design_to_export` and
 * `export_to_product` (generic design-chain lineage, not proof of a
 * real-world sale), `video_to_event`/`supports_date` (generic
 * timeline/date support), `duplicate_of`/`duplicate_variant_of` (exact
 * or near-duplicate markers), and `related_to` (the fully generic,
 * default connection type with no defined commercial-use meaning at
 * all) — per the rule that generic relationships must not silently
 * protect a candidate unless their actual semantics indicate stronger
 * commercial-use evidence.
 */
export const PROTECTED_CONNECTION_TYPES: readonly ConnectionType[] = [
  "product_to_invoice",
  "invoice_to_shipment",
  "invoice_to_customer",
  "product_to_social_post",
  "social_post_to_customer_photo",
  "customer_photo_to_message",
  "supports_commercial_use",
  "supports_continuous_use",
];

export const ARCHIVE_SIMILAR_REASON_CODES = [
  "SOURCE_ITEM",
  "DIFFERENT_FOLDER",
  "UNSUPPORTED_MEDIA_TYPE",
  "ALREADY_ARCHIVED",
  "ALREADY_INCLUDED",
  "NEEDS_FOLLOW_UP",
  "CONFLICTING_REVIEW",
  "DIFFERENT_CONFIRMED_EVIDENCE_TYPE",
  "PROTECTED_CONNECTION",
  "ITEM_NOT_FOUND",
  "STATE_CHANGED_AFTER_PREVIEW",
  "PERMISSION_DENIED",
  "INVALID_PRODUCT_MOCKUP_TEMPLATE",
  "INVALID_DESIGN_MOCKUP_TEMPLATE",
  "MISSING_FILESYSTEM_DATE",
  "INVALID_FILESYSTEM_DATE",
  "CONNECTED_TO_FINAL_LOGO",
  "CONNECTED_TO_REAL_PRODUCT",
  "CONNECTED_TO_PUBLIC_RELEASE",
  "CONNECTED_TO_COMMERCIAL_USE",
  "HAS_WORKING_SOURCE_FILE",
  "INVALID_EARLIER_LOGO_ITERATION_TEMPLATE",
  "IS_FINAL_ADOPTED_LOGO_FILE",
] as const;
export type ArchiveSimilarReasonCode = (typeof ARCHIVE_SIMILAR_REASON_CODES)[number];

/** Human-readable labels for each reason code — used by both the excluded-files list and audit records, so the two can never describe the same code differently. */
export const ARCHIVE_SIMILAR_REASON_LABELS: Record<ArchiveSimilarReasonCode, string> = {
  SOURCE_ITEM: "This is the file you're currently reviewing",
  DIFFERENT_FOLDER: "In a different folder",
  UNSUPPORTED_MEDIA_TYPE: "Not a supported image file",
  ALREADY_ARCHIVED: "Already archived",
  ALREADY_INCLUDED: "Already included",
  NEEDS_FOLLOW_UP: "Marked Needs Follow-Up",
  CONFLICTING_REVIEW: "Already reviewed with conflicting answers",
  DIFFERENT_CONFIRMED_EVIDENCE_TYPE: "Different confirmed evidence type",
  PROTECTED_CONNECTION: "Connected to commercial-use evidence",
  ITEM_NOT_FOUND: "This file could no longer be found",
  STATE_CHANGED_AFTER_PREVIEW: "Its evidence changed after this preview was generated",
  PERMISSION_DENIED: "You don't have permission to modify this file",
  INVALID_PRODUCT_MOCKUP_TEMPLATE: "The current review doesn't match the concept-only Product Mockup template",
  INVALID_DESIGN_MOCKUP_TEMPLATE: "The current review doesn't match the unused-design Design Mockup template",
  MISSING_FILESYSTEM_DATE: "No usable filesystem last-modified date is available. Review this file manually.",
  INVALID_FILESYSTEM_DATE: "This file's filesystem last-modified date could not be read. Review this file manually.",
  CONNECTED_TO_FINAL_LOGO: "Connected to the final logo you actually use",
  CONNECTED_TO_REAL_PRODUCT: "Connected to a real product",
  CONNECTED_TO_PUBLIC_RELEASE: "Connected to a public release",
  CONNECTED_TO_COMMERCIAL_USE: "Connected to commercial-use evidence",
  HAS_WORKING_SOURCE_FILE: "Has a working source file connected",
  INVALID_EARLIER_LOGO_ITERATION_TEMPLATE: "The current review doesn't match the Earlier Logo Iterations template",
  IS_FINAL_ADOPTED_LOGO_FILE: "This is (a duplicate of) the final adopted logo file itself",
};

export interface ArchiveSimilarEligibilityResult {
  eligible: boolean;
  reasonCode: ArchiveSimilarReasonCode | null;
  reasonLabel: string | null;
  details?: Record<string, unknown>;
}

function eligibilityOk(): ArchiveSimilarEligibilityResult {
  return { eligible: true, reasonCode: null, reasonLabel: null };
}

function eligibilityFail(reasonCode: ArchiveSimilarReasonCode, details?: Record<string, unknown>): ArchiveSimilarEligibilityResult {
  return { eligible: false, reasonCode, reasonLabel: ARCHIVE_SIMILAR_REASON_LABELS[reasonCode], details };
}

/** `dirname` without a Node dependency — this module runs in the browser too. Paths are always forward-slash-normalized by the scanner. */
export function folderOf(originalPath: string): string {
  const idx = originalPath.lastIndexOf("/");
  return idx === -1 ? "" : originalPath.slice(0, idx);
}

/** One connection touching a candidate, with enough context (direction + the *other* item's confirmed evidence type) for a preset's protected-connection policy to reason about real-world semantics rather than just the bare connection type. */
export interface ArchiveSimilarConnectionInfo {
  type: ConnectionType;
  direction: "outgoing" | "incoming";
  otherItemEvidenceTypeId: string | null;
}

export interface ArchiveSimilarCandidateInput {
  id: string;
  originalPath: string;
  extension: string;
  reviewStatus: ReviewStatus;
  inclusionDecision: InclusionDecision | null;
  evidenceTypeId: string | null;
  /** Every connection type touching this item, from both directions (outgoing and incoming) — a protecting relationship counts regardless of which side the candidate is on. Consumed by the Product Mockup preset's flat allowlist check. */
  connectionTypes: ConnectionType[];
  /** The same connections as `connectionTypes`, but with direction and the other item's evidence type attached — consumed by presets (Design Mockup) whose protected-connection policy depends on more than the bare type. Optional so existing Product Mockup call sites/tests are unaffected; defaults to `[]` when a preset that needs it reads an input that omitted it. */
  connections?: ArchiveSimilarConnectionInfo[];
  /** This candidate's own `fs_modified_at` (ISO timestamp) — only consumed by presets with a filesystem-date-derived question (Design Mockup). */
  filesystemModifiedAt?: string | null;
  /** This candidate's own existing `design_mockup_creator` answer, if any — only consumed by the Earlier Logo Iterations preset, whose auto-prefilled creator value must never silently overwrite a value a human already entered on this specific file. */
  existingCreatorAnswer?: string | null;
}

export interface ArchiveSimilarSourceInput {
  id: string;
  originalPath: string;
  evidenceTypeId: string | null;
}

export interface ArchiveSimilarContext {
  /** The evidence type this bulk-review preset applies to. Only "product_mockup" is wired up in v1; the parameter exists so a future preset doesn't require changing this function's signature. */
  presetEvidenceTypeId: string;
}

const DEFAULT_CONTEXT: ArchiveSimilarContext = { presetEvidenceTypeId: PRODUCT_MOCKUP_EVIDENCE_TYPE_ID };

/**
 * The checks every preset shares, regardless of which evidence type it
 * targets: source-item exclusion, folder scope, media type, review
 * status, and confirmed-evidence-type match. Returns a failure result
 * for the first applicable reason (e.g. an already-archived item in a
 * different folder reports DIFFERENT_FOLDER, not ALREADY_ARCHIVED,
 * since folder scope is checked first), or `null` when every common
 * check passes and a preset-specific check (protected connections, a
 * derived-field validity check) should run next.
 */
function checkCommonEligibility(
  file: ArchiveSimilarCandidateInput,
  currentReview: ArchiveSimilarSourceInput,
  context: ArchiveSimilarContext,
): ArchiveSimilarEligibilityResult | null {
  if (file.id === currentReview.id) {
    return eligibilityFail("SOURCE_ITEM");
  }
  if (folderOf(file.originalPath) !== folderOf(currentReview.originalPath)) {
    return eligibilityFail("DIFFERENT_FOLDER");
  }
  if (getPreviewKind(file.extension) !== "image") {
    return eligibilityFail("UNSUPPORTED_MEDIA_TYPE", { extension: file.extension });
  }
  if (file.reviewStatus === "excluded") {
    return eligibilityFail("ALREADY_ARCHIVED");
  }
  if (file.reviewStatus === "reviewed" && file.inclusionDecision === "include") {
    return eligibilityFail("ALREADY_INCLUDED");
  }
  if (file.reviewStatus === "needs_follow_up") {
    return eligibilityFail("NEEDS_FOLLOW_UP");
  }
  // Anything else that isn't "unreviewed" (e.g. "reviewed"/"maybe", or
  // the reserved "in_review" status) is a completed or in-progress
  // review this operation must not silently overwrite.
  if (file.reviewStatus !== "unreviewed") {
    return eligibilityFail("CONFLICTING_REVIEW", { reviewStatus: file.reviewStatus, inclusionDecision: file.inclusionDecision });
  }
  if (file.evidenceTypeId !== null && file.evidenceTypeId !== context.presetEvidenceTypeId) {
    return eligibilityFail("DIFFERENT_CONFIRMED_EVIDENCE_TYPE", { evidenceTypeId: file.evidenceTypeId });
  }
  return null;
}

/**
 * Whether `file` qualifies as a Product Mockup Archive Similar target
 * for the item currently being reviewed (`currentReview`). Pure and
 * deterministic — no image AI, embeddings, filename guessing, or fuzzy
 * matching, per the "similar" definition for version one. Unchanged
 * from v1: kept as its own function (rather than folded into a generic
 * preset dispatcher) so every existing caller/test keeps compiling and
 * behaving identically.
 */
export function getArchiveSimilarEligibility(
  file: ArchiveSimilarCandidateInput,
  currentReview: ArchiveSimilarSourceInput,
  context: ArchiveSimilarContext = DEFAULT_CONTEXT,
): ArchiveSimilarEligibilityResult {
  const common = checkCommonEligibility(file, currentReview, context);
  if (common) return common;
  const protectedType = file.connectionTypes.find((t) => PROTECTED_CONNECTION_TYPES.includes(t));
  if (protectedType) {
    return eligibilityFail("PROTECTED_CONNECTION", { connectionType: protectedType });
  }
  return eligibilityOk();
}

const DESIGN_MOCKUP_CONTEXT: ArchiveSimilarContext = { presetEvidenceTypeId: DESIGN_MOCKUP_EVIDENCE_TYPE_ID };

/**
 * Design-Mockup-specific protected-connection policy (see the module
 * doc comment on why this can't reuse Product Mockup's flat allowlist).
 * Every real ConnectionType is reasoned about by its actual documented
 * semantics (specs/07_CONNECTIONS.md), never by fuzzy name matching:
 *
 * - `supports_commercial_use` / `supports_continuous_use`: is, by
 *   definition, commercial/continuous-use evidence.
 * - `product_to_invoice` / `invoice_to_shipment` / `invoice_to_customer`:
 *   proof of a real transaction, fulfillment, or customer relationship
 *   — the same commercial-use signal Product Mockup already protects.
 * - `product_to_social_post` / `social_post_to_customer_photo` /
 *   `customer_photo_to_message`: a public post, a real customer's photo
 *   of it, or a real customer conversation about it — public release.
 * - `export_to_product`, with this candidate as the *source* and the
 *   *target* a product-like evidence type (product_mockup, product_photo,
 *   lifestyle_photo, packaging, hang_tag, label): this design became a
 *   real product.
 * - `source_design_to_export`, with this candidate as the *source* and
 *   the *target* confirmed as `final_logo`: this concept led to the
 *   final logo — checked only when it would actually conflict with the
 *   copied "Did this concept lead to the final logo you actually use?"
 *   answer (i.e. that answer is "No"), per the requirement that this
 *   exclusion fire only on a real contradiction.
 * - `source_design_to_export`, with this candidate as the *target* and
 *   the *source* a real source-file evidence type (psd_source,
 *   illustrator_source, svg_source): a working source file really does
 *   exist for this design — checked only when the copied "Is there a
 *   working PSD file behind this design?" answer is "No".
 *
 * Deliberately not protected here (same reasoning as Product Mockup):
 * `video_to_event`, `supports_date`, `duplicate_of`,
 * `duplicate_variant_of`, `related_to`, and any `source_design_to_export`
 * / `export_to_product` relationship whose other endpoint doesn't match
 * one of the specific evidence-type checks above.
 */
export function getDesignMockupProtectedConnection(
  connections: ArchiveSimilarConnectionInfo[],
  templateAnswers: Record<string, ArchiveSimilarAnswerInput>,
): { reasonCode: ArchiveSimilarReasonCode; connectionType: ConnectionType } | null {
  for (const c of connections) {
    switch (c.type) {
      case "supports_commercial_use":
      case "supports_continuous_use":
      case "product_to_invoice":
      case "invoice_to_shipment":
      case "invoice_to_customer":
        return { reasonCode: "CONNECTED_TO_COMMERCIAL_USE", connectionType: c.type };
      case "product_to_social_post":
      case "social_post_to_customer_photo":
      case "customer_photo_to_message":
        return { reasonCode: "CONNECTED_TO_PUBLIC_RELEASE", connectionType: c.type };
      case "export_to_product":
        if (c.direction === "outgoing" && c.otherItemEvidenceTypeId !== null && PRODUCT_LIKE_EVIDENCE_TYPE_IDS.has(c.otherItemEvidenceTypeId)) {
          return { reasonCode: "CONNECTED_TO_REAL_PRODUCT", connectionType: c.type };
        }
        break;
      case "source_design_to_export": {
        const finalLogoAnswer = templateAnswers[DESIGN_MOCKUP_QUESTION_IDS.relatedFinalLogo];
        if (c.direction === "outgoing" && c.otherItemEvidenceTypeId === "final_logo" && finalLogoAnswer && isNoAnswer(finalLogoAnswer.value)) {
          return { reasonCode: "CONNECTED_TO_FINAL_LOGO", connectionType: c.type };
        }
        const psdAnswer = templateAnswers[DESIGN_MOCKUP_QUESTION_IDS.relatedPsd];
        if (
          c.direction === "incoming" &&
          c.otherItemEvidenceTypeId !== null &&
          SOURCE_FILE_EVIDENCE_TYPE_IDS.has(c.otherItemEvidenceTypeId) &&
          psdAnswer &&
          isNoAnswer(psdAnswer.value)
        ) {
          return { reasonCode: "HAS_WORKING_SOURCE_FILE", connectionType: c.type };
        }
        break;
      }
      default:
        break;
    }
  }
  return null;
}

/**
 * Whether `file` qualifies as a Design Mockup Archive Similar target.
 * Runs the same common checks as Product Mockup (folder/media/status/
 * evidence-type), then this preset's own protected-connection policy,
 * then requires a valid, derivable filesystem last-modified date — a
 * Design Mockup with no usable date is excluded rather than silently
 * given an invented, copied, or fallback date.
 */
export function getDesignMockupArchiveSimilarEligibility(
  file: ArchiveSimilarCandidateInput,
  currentReview: ArchiveSimilarSourceInput,
  templateAnswers: Record<string, ArchiveSimilarAnswerInput>,
): ArchiveSimilarEligibilityResult {
  const common = checkCommonEligibility(file, currentReview, DESIGN_MOCKUP_CONTEXT);
  if (common) return common;

  const protectedConnection = getDesignMockupProtectedConnection(file.connections ?? [], templateAnswers);
  if (protectedConnection) {
    return eligibilityFail(protectedConnection.reasonCode, { connectionType: protectedConnection.connectionType });
  }

  const derivedDate = deriveDesignMockupDateAnswer(file.filesystemModifiedAt ?? null);
  if (!derivedDate.available) {
    return eligibilityFail(derivedDate.reasonCode!);
  }

  return eligibilityOk();
}

/** One answer as the live form/draft holds it — matches web/reviewDraft.ts's DraftInterviewAnswer shape without importing the web package. */
export interface ArchiveSimilarAnswerInput {
  value: string;
  confidence: SuggestionConfidence | null;
}

export interface ArchiveSimilarTemplateInput {
  evidenceTypeId: string | null;
  answers: Record<string, ArchiveSimilarAnswerInput>;
  /** The decision the user is about to apply (or has already applied) to the current item — must be "archive" for this preset. */
  decisionAction: ReviewDecisionAction | null;
}

/** A stored answer value counts as "No" regardless of capitalization or surrounding whitespace — review_answers.value is a free-text field (no enum in the schema), so this is a deliberate, documented normalization rather than a strict equality check. Exported for reuse by archiveSimilarPresets.ts and the Design Mockup protected-connection policy above. */
export function isNoAnswer(value: string): boolean {
  return value.trim().toLowerCase() === "no";
}

/** Same normalization as `isNoAnswer`, for the literal word "yes". */
export function isYesAnswer(value: string): boolean {
  return value.trim().toLowerCase() === "yes";
}

export function isHighConfidence(confidence: SuggestionConfidence | null): boolean {
  return confidence === "high";
}

/**
 * Whether a review (live draft state or saved item state — the caller
 * decides which to pass in) matches the exact concept-only Product
 * Mockup template Archive Similar requires. Used both to enable/disable
 * the button (against live, possibly-unsaved form state) and, on the
 * server, to reject a forged non-Product-Mockup template.
 */
export function validateProductMockupTemplate(
  input: ArchiveSimilarTemplateInput,
  context: ArchiveSimilarContext = DEFAULT_CONTEXT,
): { valid: boolean; reasonCode: "INVALID_PRODUCT_MOCKUP_TEMPLATE" | null } {
  if (input.evidenceTypeId !== context.presetEvidenceTypeId) {
    return { valid: false, reasonCode: "INVALID_PRODUCT_MOCKUP_TEMPLATE" };
  }
  const everProduced = input.answers[PRODUCT_MOCKUP_QUESTION_IDS.everProduced];
  const matchingRecord = input.answers[PRODUCT_MOCKUP_QUESTION_IDS.matchingRecord];
  if (!everProduced || !matchingRecord) {
    return { valid: false, reasonCode: "INVALID_PRODUCT_MOCKUP_TEMPLATE" };
  }
  if (!isNoAnswer(everProduced.value) || !isHighConfidence(everProduced.confidence)) {
    return { valid: false, reasonCode: "INVALID_PRODUCT_MOCKUP_TEMPLATE" };
  }
  if (!isNoAnswer(matchingRecord.value) || !isHighConfidence(matchingRecord.confidence)) {
    return { valid: false, reasonCode: "INVALID_PRODUCT_MOCKUP_TEMPLATE" };
  }
  if (input.decisionAction !== "archive") {
    return { valid: false, reasonCode: "INVALID_PRODUCT_MOCKUP_TEMPLATE" };
  }
  return { valid: true, reasonCode: null };
}

/**
 * Whether a review matches the exact unused-design Design Mockup
 * template this preset requires: every non-date question in the
 * interview answered, an internal/unreleased concept ("Was this an
 * early, internal idea..." = Yes), and every real-use signal the
 * registry asks about answered "No" at high confidence (became the
 * final design, released publicly, led to the final logo actually
 * used) — the same "only apply this preset to evidence that's
 * genuinely archiveable" guarantee validateProductMockupTemplate makes
 * for Product Mockup. The creation-date question is deliberately never
 * checked here: it's the one question this preset derives per-item
 * rather than copies, so the source item's own (possibly empty)
 * answer to it is irrelevant to whether the template is valid.
 *
 * "Who created this design?" (a free-text question with no "correct"
 * value) only needs to be *answered* — the registry doesn't mark any
 * question as strictly required, so "every question needed to
 * meaningfully describe an unused design" is this function's own
 * documented interpretation, matching the ADR's existing precedent for
 * `isNoAnswer`.
 */
export function validateDesignMockupTemplate(input: ArchiveSimilarTemplateInput): { valid: boolean; reasonCode: "INVALID_DESIGN_MOCKUP_TEMPLATE" | null } {
  const fail = { valid: false, reasonCode: "INVALID_DESIGN_MOCKUP_TEMPLATE" as const };
  if (input.evidenceTypeId !== DESIGN_MOCKUP_EVIDENCE_TYPE_ID) {
    return fail;
  }
  const internalConcept = input.answers[DESIGN_MOCKUP_QUESTION_IDS.internalConcept];
  const finalDesign = input.answers[DESIGN_MOCKUP_QUESTION_IDS.finalDesign];
  const creator = input.answers[DESIGN_MOCKUP_QUESTION_IDS.creator];
  const publiclyReleased = input.answers[DESIGN_MOCKUP_QUESTION_IDS.publiclyReleased];
  const relatedPsd = input.answers[DESIGN_MOCKUP_QUESTION_IDS.relatedPsd];
  const relatedFinalLogo = input.answers[DESIGN_MOCKUP_QUESTION_IDS.relatedFinalLogo];
  if (!internalConcept || !finalDesign || !creator || !publiclyReleased || !relatedPsd || !relatedFinalLogo) {
    return fail;
  }
  if (!creator.value.trim()) {
    return fail;
  }
  if (!isYesAnswer(internalConcept.value) || !isHighConfidence(internalConcept.confidence)) {
    return fail;
  }
  if (!isNoAnswer(finalDesign.value) || !isHighConfidence(finalDesign.confidence)) {
    return fail;
  }
  if (!isNoAnswer(publiclyReleased.value) || !isHighConfidence(publiclyReleased.confidence)) {
    return fail;
  }
  if (!isNoAnswer(relatedFinalLogo.value) || !isHighConfidence(relatedFinalLogo.confidence)) {
    return fail;
  }
  if (input.decisionAction !== "archive") {
    return fail;
  }
  return { valid: true, reasonCode: null };
}

// ---------------------------------------------------------------------
// Earlier Logo Iterations — a second Design Mockup preset (same
// evidence type id, `design_mockup`) for internal predecessor concepts
// that did NOT become the final adopted file but DID contribute to it.
// Distinguished from the unused-design preset above purely by the
// `relatedFinalLogo` answer: "No" there, "Yes" here — the two are
// mutually exclusive by construction, so a template can never validate
// against both (see archiveSimilarPresets.ts's `resolveArchiveSimilarPreset`,
// which tries each design_mockup preset in turn and uses whichever one
// actually validates).
// ---------------------------------------------------------------------

/**
 * Whether a review matches the Earlier Logo Iterations template: an
 * internal, unreleased concept that did NOT become the final adopted
 * file but DID lead to it. Unlike `validateDesignMockupTemplate`,
 * `design_mockup_creator` is deliberately never required here — this
 * preset auto-prefills a default creator, so a blank creator answer
 * must not block the button from ever appearing (see
 * archiveSimilarPresets.ts's `defaultCreator` /
 * `optionalCopiedQuestionIds`). `design_mockup_related_psd` still must
 * be *answered* (any value) — "is there a working PSD" has no sensible
 * default, so the user must resolve it themselves before this preset
 * activates, exactly as the unused-design preset already requires.
 */
export function validateEarlierLogoIterationTemplate(
  input: ArchiveSimilarTemplateInput,
): { valid: boolean; reasonCode: "INVALID_EARLIER_LOGO_ITERATION_TEMPLATE" | null } {
  const fail = { valid: false, reasonCode: "INVALID_EARLIER_LOGO_ITERATION_TEMPLATE" as const };
  if (input.evidenceTypeId !== DESIGN_MOCKUP_EVIDENCE_TYPE_ID) {
    return fail;
  }
  const internalConcept = input.answers[DESIGN_MOCKUP_QUESTION_IDS.internalConcept];
  const finalDesign = input.answers[DESIGN_MOCKUP_QUESTION_IDS.finalDesign];
  const publiclyReleased = input.answers[DESIGN_MOCKUP_QUESTION_IDS.publiclyReleased];
  const relatedPsd = input.answers[DESIGN_MOCKUP_QUESTION_IDS.relatedPsd];
  const relatedFinalLogo = input.answers[DESIGN_MOCKUP_QUESTION_IDS.relatedFinalLogo];
  if (!internalConcept || !finalDesign || !publiclyReleased || !relatedPsd || !relatedFinalLogo) {
    return fail;
  }
  if (!isYesAnswer(internalConcept.value) || !isHighConfidence(internalConcept.confidence)) {
    return fail;
  }
  if (!isNoAnswer(finalDesign.value) || !isHighConfidence(finalDesign.confidence)) {
    return fail;
  }
  if (!isNoAnswer(publiclyReleased.value) || !isHighConfidence(publiclyReleased.confidence)) {
    return fail;
  }
  if (!isYesAnswer(relatedFinalLogo.value) || !isHighConfidence(relatedFinalLogo.confidence)) {
    return fail;
  }
  if (input.decisionAction !== "archive") {
    return fail;
  }
  return { valid: true, reasonCode: null };
}

/**
 * Earlier Logo Iterations' protected-connection policy. Layers one
 * preset-specific rule on top of the exact same
 * `getDesignMockupProtectedConnection` the unused-design preset uses:
 *
 * - A `duplicate_of`/`duplicate_variant_of` connection to an item
 *   confirmed as `final_logo` means this candidate *is* (a copy of) the
 *   exact adopted file, not merely a predecessor of it — excluded as
 *   `IS_FINAL_ADOPTED_LOGO_FILE`. This is the "B" case the preset spec
 *   requires distinguishing from "A" (contributed to the final logo).
 * - Every other rule (commercial use, public release, real product,
 *   working-source-file) is identical to the unused-design preset's
 *   policy, reused as-is. Notably, `getDesignMockupProtectedConnection`'s
 *   CONNECTED_TO_FINAL_LOGO rule (a `source_design_to_export` link to a
 *   confirmed `final_logo`) only fires when the copied
 *   `relatedFinalLogo` answer is "No" — for this preset that answer is
 *   always "Yes", so that rule can never fire here. A connection merely
 *   showing "this concept contributed to the final logo" (case "A")
 *   therefore never excludes a candidate, exactly as required.
 */
export function getEarlierLogoIterationProtectedConnection(
  connections: ArchiveSimilarConnectionInfo[],
  templateAnswers: Record<string, ArchiveSimilarAnswerInput>,
): { reasonCode: ArchiveSimilarReasonCode; connectionType: ConnectionType } | null {
  for (const c of connections) {
    if ((c.type === "duplicate_of" || c.type === "duplicate_variant_of") && c.otherItemEvidenceTypeId === "final_logo") {
      return { reasonCode: "IS_FINAL_ADOPTED_LOGO_FILE", connectionType: c.type };
    }
  }
  return getDesignMockupProtectedConnection(connections, templateAnswers);
}

/**
 * Whether `file` qualifies as an Earlier Logo Iterations target. Same
 * common checks as the unused-design preset (folder/media/status/
 * evidence-type — both target the `design_mockup` evidence type), plus
 * one check the unused-design preset doesn't need: this preset
 * auto-defaults the creator answer, so a candidate that already carries
 * its own non-blank, human-entered creator answer is left alone rather
 * than silently overwritten — excluded as `CONFLICTING_REVIEW` instead.
 * ("Conflicting" here means "an opinion already exists," not "the
 * values differ" — the eligibility check runs before the operator has
 * necessarily finalized which creator value this operation will apply,
 * so any pre-existing answer is treated as a real prior review to
 * preserve, not compared against a not-yet-decided value.)
 */
export function getEarlierLogoIterationArchiveSimilarEligibility(
  file: ArchiveSimilarCandidateInput,
  currentReview: ArchiveSimilarSourceInput,
  templateAnswers: Record<string, ArchiveSimilarAnswerInput>,
): ArchiveSimilarEligibilityResult {
  const common = checkCommonEligibility(file, currentReview, DESIGN_MOCKUP_CONTEXT);
  if (common) return common;

  if (file.existingCreatorAnswer && file.existingCreatorAnswer.trim()) {
    return eligibilityFail("CONFLICTING_REVIEW", { reason: "existing_creator_answer" });
  }

  const protectedConnection = getEarlierLogoIterationProtectedConnection(file.connections ?? [], templateAnswers);
  if (protectedConnection) {
    return eligibilityFail(protectedConnection.reasonCode, { connectionType: protectedConnection.connectionType });
  }

  const derivedDate = deriveDesignMockupDateAnswer(file.filesystemModifiedAt ?? null);
  if (!derivedDate.available) {
    return eligibilityFail(derivedDate.reasonCode!);
  }

  return eligibilityOk();
}
