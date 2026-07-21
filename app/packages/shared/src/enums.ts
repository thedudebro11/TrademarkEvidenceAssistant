/**
 * Enumerations shared between server and web, sourced from
 * specs/03_EVIDENCE_ITEM_MODEL.md and specs/07_CONNECTIONS.md, plus
 * Phase 0 decisions recorded in docs/QUESTIONS.md.
 */

export const REVIEW_STATUSES = [
  "unreviewed",
  "in_review",
  "reviewed",
  "needs_follow_up",
  "excluded",
] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const EVIDENCE_CATEGORIES = [
  "trademark_core",
  "trademark_supporting",
  "business_history",
  "archive_only",
  "unknown",
] as const;
export type EvidenceCategory = (typeof EVIDENCE_CATEGORIES)[number];

/**
 * File roles from spec 03. `print_vendor_proof` was added per Phase 0
 * decision 5 — proof-style PDFs (e.g. numeric-ID print vendor exports)
 * suggest this role rather than being assumed to be an invoice or order.
 */
export const FILE_ROLES = [
  "product_photo",
  "customer_photo",
  "marketing_photo",
  "social_post_export",
  "printful_invoice",
  "printful_order",
  "shipping_record",
  "payment_record",
  "message",
  "logo_source",
  "logo_export",
  "product_design",
  "packaging",
  "specimen_candidate",
  "video",
  "document",
  "duplicate",
  "print_vendor_proof",
  "unknown",
] as const;
export type FileRole = (typeof FILE_ROLES)[number];

/**
 * Connection types from spec 07. `duplicate_variant_of` was added per
 * Phase 0 decision 6 for near-duplicate media (e.g. re-encoded video)
 * that SHA-256 exact-match duplicate detection will not catch.
 */
export const CONNECTION_TYPES = [
  "source_design_to_export",
  "export_to_product",
  "product_to_invoice",
  "invoice_to_shipment",
  "invoice_to_customer",
  "product_to_social_post",
  "social_post_to_customer_photo",
  "customer_photo_to_message",
  "video_to_event",
  "supports_date",
  "duplicate_of",
  "duplicate_variant_of",
  "related_to",
  "supports_commercial_use",
  "supports_continuous_use",
] as const;
export type ConnectionType = (typeof CONNECTION_TYPES)[number];

/**
 * Confidence attached to a deterministic role suggestion (folder name /
 * filename / extension based), per Phase 0 decision 4. Suggestions are
 * never stored as the final role — only as input to a user confirmation.
 */
export const SUGGESTION_CONFIDENCES = ["low", "medium", "high"] as const;
export type SuggestionConfidence = (typeof SUGGESTION_CONFIDENCES)[number];

export const USEFULNESS_BANDS = [
  "Strong",
  "Moderate",
  "Weak",
  "None",
  "Undetermined",
] as const;
export type UsefulnessBand = (typeof USEFULNESS_BANDS)[number];

/**
 * Lifecycle of a HEIC/HEIF item's generated inline preview
 * (docs/ADR_0005_HEIC_PREVIEWS.md). Never describes the original file
 * itself — only the derived, browser-viewable image generated from it.
 */
export const HEIC_PREVIEW_STATUSES = [
  "not_requested",
  "queued",
  "generating",
  "ready",
  "failed",
  "unsupported_backend",
  "source_missing",
  "stale",
] as const;
export type HeicPreviewStatus = (typeof HEIC_PREVIEW_STATUSES)[number];

/**
 * The decoder backends `heicPreviewService.ts` knows how to invoke
 * (`packages/server/src/engines/heicDecoders/`). `libheif-js` is the
 * only one ever used automatically — `imagemagick` is retained solely
 * as a manually-selectable "Retry with Alternate Decoder" option after
 * its HEIC delegate was found to produce visually corrupted output for
 * a real evidence file (docs/ADR_0005_HEIC_PREVIEWS.md).
 */
export const HEIC_DECODER_IDS = ["libheif-js", "imagemagick"] as const;
export type HeicDecoderId = (typeof HEIC_DECODER_IDS)[number];

/** Whether a heic_previews row was produced by the app's automatic preferred-decoder policy, or by an explicit user "Retry with Alternate Decoder" action. */
export const HEIC_DECODER_SELECTIONS = ["auto", "manual"] as const;
export type HeicDecoderSelection = (typeof HEIC_DECODER_SELECTIONS)[number];

/**
 * The stored, final inclusion classification (spec 03's review_status
 * distinguishes reviewed/needs_follow_up/excluded, but not Include vs.
 * Maybe within "reviewed" — this fills that gap). Never set directly by
 * a "follow_up" decision — see ReviewDecisionAction.
 */
export const INCLUSION_DECISIONS = ["include", "maybe", "not_useful"] as const;
export type InclusionDecision = (typeof INCLUSION_DECISIONS)[number];

/**
 * The four review actions from spec 05 ("Include / Maybe / Follow-Up /
 * Not Useful"), labeled "Include, Maybe, Needs Follow-Up, Archive" in
 * docs/USER_JOURNEY.md's UI copy — same workflow, different button text
 * for the fourth action. See migration 0003_review.sql for the full
 * reconciliation note.
 */
export const REVIEW_DECISION_ACTIONS = ["include", "maybe", "follow_up", "archive"] as const;
export type ReviewDecisionAction = (typeof REVIEW_DECISION_ACTIONS)[number];
