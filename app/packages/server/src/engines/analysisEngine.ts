import type { ExtractedEntityType, DateAssertionSourceType, SuggestionConfidence, TimezoneStatus } from "@trademark-evidence-assistant/shared";
import { rankEvidenceTypeCandidates, type EvidenceTypeSuggestion } from "@trademark-evidence-assistant/shared";
import {
  extractColorCandidates,
  extractDateCandidates,
  extractFatleticMarkCandidates,
  extractGarmentTypeCandidates,
  extractInvoiceNumberCandidates,
  extractOrderNumberCandidates,
  extractOrderStatusCandidates,
  extractPriceCandidates,
  extractQuantityCandidates,
  extractShipmentNumberCandidates,
  extractShippingCarrierCandidates,
  extractSizeCandidates,
  extractSkuCandidates,
  extractTotalCandidates,
  extractTrackingNumberCandidates,
  extractVisibleDeliveryDateCandidates,
  extractVisibleInvoiceDateCandidates,
  extractVisibleOrderDateCandidates,
  extractVisibleShipmentDateCandidates,
} from "./ocrEngine.js";

/**
 * Deterministic Evidence Intelligence Phase 1 engine — rule-based only,
 * no AI provider involved (see analysisProvider.ts for that separate,
 * currently-unconfigured boundary). Bump `DETERMINISTIC_RULE_VERSION`
 * whenever the logic in this file changes in a way that could change a
 * result for the same input — analysisService.ts uses it to detect a
 * stale analysis run (docs comment on migration 0017).
 *
 * Every function here only ever *proposes*: nothing is written to any
 * confirmed field, and nothing invents a value that isn't actually
 * present in the input. A missing identifier is simply absent from the
 * output, never guessed.
 */
export const DETERMINISTIC_RULE_VERSION = "1";
export const METADATA_EXTRACTION_VERSION = "1";

export interface AnalysisEngineInput {
  originalFilename: string;
  originalPath: string;
  folderPath: string;
  extension: string;
  siblingExtensions: string[];
  width: number | null;
  height: number | null;
  exifDateTimeOriginal: string | null;
  exifCreateDate: string | null;
  filenameInferredDate: string | null;
  fsCreatedAt: string | null;
  fsModifiedAt: string | null;
  /** Raw OCR text, when this item has been OCR'd and text was found — `null` otherwise (never attempted, or nothing found). */
  ocrText: string | null;
}

export interface EngineEntity {
  entityType: ExtractedEntityType;
  rawText: string;
  normalizedValue: string | null;
  sourceLocation: string | null;
  extractionMethod: string;
  confidence: SuggestionConfidence;
}

export interface EngineDateAssertion {
  sourceType: DateAssertionSourceType;
  rawValue: string;
  normalizedValue: string | null;
  timezoneStatus: TimezoneStatus;
  sourceLocation: string | null;
  confidence: SuggestionConfidence;
  explanation: string;
}

export interface EngineAnswerSuggestion {
  questionId: string;
  /** Empty string + `unresolved: true` for a question this engine deliberately leaves for the user (e.g. "relationship to FATLETIC") — never a guessed value. */
  proposedValue: string;
  normalizedValue: string | null;
  confidence: SuggestionConfidence;
  rationale: string;
  supportingSignals: string[];
  sourceLocations: string[];
  unresolved: boolean;
}

export interface AnalysisEngineResult {
  evidenceTypeCandidates: EvidenceTypeSuggestion[];
  answerSuggestions: EngineAnswerSuggestion[];
  entities: EngineEntity[];
  dates: EngineDateAssertion[];
}

/** EXIF's "YYYY:MM:DD HH:MM:SS" to an ISO-shaped local string — a textual reformat only, never a timezone conversion (this app has no reliable EXIF timezone), so the calendar date/time shown never shifts. */
function exifToIsoLocal(exifValue: string): string | null {
  const m = exifValue.match(/^(\d{4}):(\d{2}):(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  return `${y}-${mo}-${d}T${h}:${mi}:${s}`;
}

function pushDate(
  dates: EngineDateAssertion[],
  sourceType: DateAssertionSourceType,
  rawValue: string | null,
  normalizedValue: string | null,
  timezoneStatus: TimezoneStatus,
  confidence: SuggestionConfidence,
  explanation: string,
  sourceLocation: string | null = null,
): void {
  if (!rawValue) return;
  dates.push({ sourceType, rawValue, normalizedValue, timezoneStatus, sourceLocation, confidence, explanation });
}

function buildDateAssertions(input: AnalysisEngineInput): EngineDateAssertion[] {
  const dates: EngineDateAssertion[] = [];

  pushDate(
    dates,
    "exif_date_time_original",
    input.exifDateTimeOriginal,
    input.exifDateTimeOriginal ? exifToIsoLocal(input.exifDateTimeOriginal) : null,
    "unknown",
    "high",
    "The camera's own recorded capture time, read directly from this file's EXIF data. No timezone is recorded in EXIF, so this is the camera's local clock time, not necessarily converted to any specific timezone.",
    "EXIF DateTimeOriginal",
  );
  pushDate(
    dates,
    "exif_create_date",
    input.exifCreateDate,
    input.exifCreateDate ? exifToIsoLocal(input.exifCreateDate) : null,
    "unknown",
    "high",
    "The file's EXIF CreateDate — usually the same moment as DateTimeOriginal, but recorded separately since some cameras/apps set them differently.",
    "EXIF CreateDate",
  );
  pushDate(
    dates,
    "filename_inferred",
    input.filenameInferredDate,
    input.filenameInferredDate,
    "not_applicable",
    "medium",
    "Parsed from a recognized camera-app filename pattern (e.g. IMG_20260717_...). A filename convention, not a file property — treated as a real but weaker signal than EXIF.",
    "filename",
  );
  pushDate(
    dates,
    "fs_created",
    input.fsCreatedAt,
    input.fsCreatedAt,
    "known",
    "low",
    "The filesystem's own file-creation timestamp — never proof of when a photo was taken or a document was authored. This changes whenever a file is copied, exported, or moved between drives.",
    "filesystem",
  );
  pushDate(
    dates,
    "fs_modified",
    input.fsModifiedAt,
    input.fsModifiedAt,
    "known",
    "low",
    "The filesystem's own last-modified timestamp — never proof of when a photo was taken. This is not the same claim as 'photo taken' and must never be labeled that way.",
    "filesystem",
  );

  if (input.ocrText) {
    for (const raw of extractVisibleOrderDateCandidates(input.ocrText)) {
      pushDate(dates, "visible_order_date", raw, raw, "unknown", "medium", 'A date found in the visible text near "Order Date" — read directly from the document, not inferred.', "OCR text");
    }
    for (const raw of extractVisibleShipmentDateCandidates(input.ocrText)) {
      pushDate(dates, "visible_shipment_date", raw, raw, "unknown", "medium", 'A date found in the visible text near "Shipped"/"Ship Date" — read directly from the document, not inferred.', "OCR text");
    }
    for (const raw of extractVisibleDeliveryDateCandidates(input.ocrText)) {
      pushDate(dates, "visible_delivery_date", raw, raw, "unknown", "medium", 'A date found in the visible text near "Delivered"/"Delivery Date" — read directly from the document, not inferred.', "OCR text");
    }
    for (const raw of extractVisibleInvoiceDateCandidates(input.ocrText)) {
      pushDate(dates, "visible_invoice_date", raw, raw, "unknown", "medium", 'A date found in the visible text near "Invoice Date" — read directly from the document, not inferred.', "OCR text");
    }
  }

  // Conflict detection (comparing calendar days across sources) is
  // deliberately not done here — analysisService.ts computes
  // `conflict_state` after persisting, since it needs to compare across
  // *all* of this run's date assertions together, not each one in
  // isolation as they're built.
  return dates;
}

function pushEntities(entities: EngineEntity[], entityType: ExtractedEntityType, values: string[], sourceLocation: string, extractionMethod: string, confidence: SuggestionConfidence): void {
  for (const raw of values) {
    entities.push({ entityType, rawText: raw, normalizedValue: raw.trim(), sourceLocation, extractionMethod, confidence });
  }
}

function buildEntities(input: AnalysisEngineInput): EngineEntity[] {
  const entities: EngineEntity[] = [];

  if (input.ocrText) {
    const text = input.ocrText;
    pushEntities(entities, "fatletic_mark", extractFatleticMarkCandidates(text), "OCR text", "ocr_text_match", "high");
    pushEntities(entities, "order_number", extractOrderNumberCandidates(text), "OCR text", "ocr_regex", "high");
    pushEntities(entities, "shipment_number", extractShipmentNumberCandidates(text), "OCR text", "ocr_regex", "high");
    pushEntities(entities, "tracking_number", extractTrackingNumberCandidates(text), "OCR text", "ocr_regex", "high");
    pushEntities(entities, "invoice_number", extractInvoiceNumberCandidates(text), "OCR text", "ocr_regex", "high");
    pushEntities(entities, "sku", extractSkuCandidates(text), "OCR text", "ocr_regex", "high");
    pushEntities(entities, "garment_type", extractGarmentTypeCandidates(text), "OCR text", "ocr_keyword", "medium");
    pushEntities(entities, "color", extractColorCandidates(text), "OCR text", "ocr_keyword", "low");
    pushEntities(entities, "size", extractSizeCandidates(text), "OCR text", "ocr_regex", "medium");
    pushEntities(entities, "quantity", extractQuantityCandidates(text), "OCR text", "ocr_regex", "medium");
    pushEntities(entities, "price", extractPriceCandidates(text), "OCR text", "ocr_regex", "medium");
    pushEntities(entities, "total", extractTotalCandidates(text), "OCR text", "ocr_regex", "medium");
    pushEntities(entities, "shipping_carrier", extractShippingCarrierCandidates(text), "OCR text", "ocr_keyword", "high");
    pushEntities(entities, "order_status", extractOrderStatusCandidates(text), "OCR text", "ocr_keyword", "medium");
  }

  // Filename-only FATLETIC mention — a real but weaker signal than
  // finding it in the document's own visible text.
  if (extractFatleticMarkCandidates(input.originalFilename).length > 0 && !entities.some((e) => e.entityType === "fatletic_mark")) {
    entities.push({ entityType: "fatletic_mark", rawText: input.originalFilename, normalizedValue: "FATLETIC", sourceLocation: "filename", extractionMethod: "filename_match", confidence: "medium" });
  }

  return entities;
}

/**
 * Evidence-type candidates, ranked. Starts from the existing
 * filename/folder heuristic (`rankEvidenceTypeCandidates`, capped below
 * High there since a folder/filename alone is a prior, not proof), then
 * layers in OCR-text-driven signals that *can* justify High — an exact
 * visible identifier or document-structure match is real evidence a
 * folder name never is. This is specifically what prevents a Printful
 * order-detail screenshot from being classified as Design Mockup merely
 * because product mockups appear in the image.
 */
function buildEvidenceTypeCandidates(input: AnalysisEngineInput, entities: EngineEntity[]): EvidenceTypeSuggestion[] {
  const base = rankEvidenceTypeCandidates({
    filename: input.originalFilename,
    extension: input.extension,
    folderPath: input.folderPath,
    width: input.width,
    height: input.height,
    siblingExtensions: input.siblingExtensions,
  });

  const byType = new Map<string, EvidenceTypeSuggestion>(base.map((c) => [c.typeId, c]));
  const boost = (typeId: string, reason: string, confidence: SuggestionConfidence = "high") => {
    const existing = byType.get(typeId);
    if (existing) {
      existing.reasons = [...existing.reasons, reason];
      if (confidence === "high" || existing.confidence === "low") existing.confidence = confidence;
    } else {
      byType.set(typeId, { typeId, confidence, reasons: [reason] });
    }
  };
  const suppress = (typeId: string) => byType.delete(typeId);

  if (input.ocrText) {
    const text = input.ocrText;
    const hasOrderNumber = entities.some((e) => e.entityType === "order_number");
    const hasTracking = entities.some((e) => e.entityType === "tracking_number");
    const hasShipment = entities.some((e) => e.entityType === "shipment_number");
    const hasInvoiceWord = /\binvoice\b/i.test(text);
    const hasDelivered = /\bdelivered\b/i.test(text);
    const hasShipped = /\bshipped\b/i.test(text);
    const hasOrderStructure = /\border\s*(number|#|status)\b/i.test(text) || /\bshipping\s*address\b/i.test(text);

    // Printful order-detail page: order-shaped visible identifiers and
    // document structure — this is the exact case that must never lose
    // to "product mockups appear in the screenshot".
    if (hasOrderNumber && hasOrderStructure) {
      boost("customer_order", "OCR text contains an order number and order-page structure (order status/shipping address)", "high");
      suppress("design_mockup"); // an order-detail page is never a design mockup, regardless of product thumbnails shown in it
    }
    if (hasInvoiceWord && (hasOrderNumber || /\btotal\b/i.test(text))) {
      boost("printful_invoice", 'OCR text contains "Invoice" alongside an order number or total', "high");
      suppress("design_mockup");
    }
    if (hasDelivered && (hasTracking || hasShipment)) {
      boost("shipping_confirmation", "OCR text confirms delivery alongside a tracking or shipment number", "high");
      suppress("design_mockup");
    } else if (hasShipped && (hasTracking || hasShipment)) {
      boost("shipping_confirmation", "OCR text confirms shipment alongside a tracking or shipment number", "high");
      suppress("design_mockup");
    }
  }

  const ranked = Array.from(byType.values());
  ranked.sort((a, b) => {
    const rank = { high: 2, medium: 1, low: 0 } as const;
    return rank[b.confidence] - rank[a.confidence] || b.reasons.length - a.reasons.length;
  });
  return ranked.length > 0 ? ranked : [{ typeId: "miscellaneous", confidence: "low", reasons: ["No strong signals were found."] }];
}

/**
 * The one deliberately-unresolved suggestion Phase 1 always generates
 * for a Customer Photos-context image — see the non-negotiable safety
 * rule: a folder or a person's appearance in a photo is never treated
 * as proof of who they are. `proposedValue` is empty and `unresolved`
 * is true; the UI must render this as a question to answer, never as a
 * pre-filled guess.
 */
function buildAnswerSuggestions(topCandidate: EvidenceTypeSuggestion | undefined): EngineAnswerSuggestion[] {
  const suggestions: EngineAnswerSuggestion[] = [];
  if (topCandidate && ["customer_photo", "lifestyle_photo", "product_photo"].includes(topCandidate.typeId)) {
    suggestions.push({
      questionId: "customer_photo_relationship",
      proposedValue: "",
      normalizedValue: null,
      confidence: "low",
      rationale: "A folder name or a person's appearance is never proof of their relationship to FATLETIC — only you can confirm this.",
      supportingSignals: [],
      sourceLocations: [],
      unresolved: true,
    });
  }
  return suggestions;
}

export function runDeterministicAnalysis(input: AnalysisEngineInput): AnalysisEngineResult {
  const entities = buildEntities(input);
  const dates = buildDateAssertions(input);
  const evidenceTypeCandidates = buildEvidenceTypeCandidates(input, entities);
  const answerSuggestions = buildAnswerSuggestions(evidenceTypeCandidates[0]);
  return { evidenceTypeCandidates, answerSuggestions, entities, dates };
}
