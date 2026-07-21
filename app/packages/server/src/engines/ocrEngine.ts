import type { OcrExtraction } from "@trademark-evidence-assistant/shared";

/**
 * Deterministic, rule-based extraction of likely order numbers, dates,
 * and (as of Evidence Intelligence Phase 1) other commerce identifiers
 * from raw OCR text. Pure functions — no OCR happens here (see
 * ocrService.ts for that); this only pattern-matches text that's
 * already been extracted. Every candidate is returned as-is, with
 * duplicates removed — nothing is ranked, guessed, or silently chosen
 * as "the" answer. Callers (analysisEngine.ts, the web UI) always show
 * every candidate and require an explicit accept, per this project's
 * "never auto-confirm a suggestion" rule.
 */

const MONTH_NAME_DATE = /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}\b/gi;
const NUMERIC_SLASH_DATE = /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g;
const ISO_DATE = /\b\d{4}-\d{2}-\d{2}\b/g;

/** Order-number-shaped tokens: a "#" followed by optional letters then digits (e.g. "#PF116824539", "#61108975"). */
const ORDER_NUMBER = /#[A-Za-z]{0,6}\d{4,}/g;

function uniqueInOrder(values: string[]): string[] {
  return Array.from(new Set(values.map((v) => v.trim()).filter(Boolean)));
}

export function extractDateCandidates(text: string): string[] {
  const matches = [
    ...(text.match(MONTH_NAME_DATE) ?? []),
    ...(text.match(NUMERIC_SLASH_DATE) ?? []),
    ...(text.match(ISO_DATE) ?? []),
  ];
  return uniqueInOrder(matches);
}

export function extractOrderNumberCandidates(text: string): string[] {
  return uniqueInOrder(text.match(ORDER_NUMBER) ?? []);
}

export function extractCandidates(rawText: string): OcrExtraction {
  return {
    rawText,
    dateCandidates: extractDateCandidates(rawText),
    orderNumberCandidates: extractOrderNumberCandidates(rawText),
  };
}

// --- Evidence Intelligence Phase 1: additional deterministic entity extractors ---
//
// Every extractor here follows the same rule: return every candidate
// found, never a single "chosen" value, and never fabricate a value
// that isn't actually present in the text. Keyword-proximity extractors
// (e.g. "find a date within N characters after the word 'Shipped'")
// are intentionally simple regex, not NLP — a miss is safer than a
// wrong guess given this app's non-negotiable "never invent an
// identifier" rule.

const PROXIMITY_WINDOW = 60;

/** Finds the first date-shaped substring within `window` characters after any occurrence of `keyword` (case-insensitive). Returns every such match, not just the first occurrence of the keyword. */
function extractDateNearKeyword(text: string, keywordPattern: RegExp, window = PROXIMITY_WINDOW): string[] {
  const found: string[] = [];
  const dateSearch = new RegExp(`(${MONTH_NAME_DATE.source})|(${NUMERIC_SLASH_DATE.source})|(${ISO_DATE.source})`, "gi");
  for (const keywordMatch of text.matchAll(new RegExp(keywordPattern, "gi"))) {
    const start = (keywordMatch.index ?? 0) + keywordMatch[0].length;
    const slice = text.slice(start, start + window);
    const dateMatch = slice.match(dateSearch);
    if (dateMatch?.[0]) found.push(dateMatch[0]);
  }
  return uniqueInOrder(found);
}

export function extractVisibleOrderDateCandidates(text: string): string[] {
  return extractDateNearKeyword(text, /order\s*date|date\s*placed|placed\s*on/g);
}
export function extractVisibleShipmentDateCandidates(text: string): string[] {
  return extractDateNearKeyword(text, /ship(?:ped)?\s*date|date\s*shipped|shipped\s*on/g);
}
export function extractVisibleDeliveryDateCandidates(text: string): string[] {
  return extractDateNearKeyword(text, /delivered\s*(?:on|date)?|delivery\s*date/g);
}
export function extractVisibleInvoiceDateCandidates(text: string): string[] {
  return extractDateNearKeyword(text, /invoice\s*date/g);
}

const TRACKING_UPS = /\b1Z[0-9A-Z]{16}\b/g;
const TRACKING_GENERIC_NEAR_KEYWORD = /(?:tracking)\s*(?:number|#|no\.?)?\s*[:#]?\s*([A-Z0-9]{10,30})/gi;

export function extractTrackingNumberCandidates(text: string): string[] {
  const ups = text.match(TRACKING_UPS) ?? [];
  const generic = [...text.matchAll(TRACKING_GENERIC_NEAR_KEYWORD)].map((m) => m[1]);
  return uniqueInOrder([...ups, ...generic]);
}

const SHIPMENT_NUMBER_NEAR_KEYWORD = /shipment\s*(?:number|#|no\.?)?\s*[:#]?\s*([A-Za-z0-9-]{4,30})/gi;
export function extractShipmentNumberCandidates(text: string): string[] {
  return uniqueInOrder([...text.matchAll(SHIPMENT_NUMBER_NEAR_KEYWORD)].map((m) => m[1]));
}

const INVOICE_NUMBER_NEAR_KEYWORD = /invoice\s*(?:number|#|no\.?)?\s*[:#]?\s*([A-Za-z0-9-]{3,30})/gi;
export function extractInvoiceNumberCandidates(text: string): string[] {
  return uniqueInOrder([...text.matchAll(INVOICE_NUMBER_NEAR_KEYWORD)].map((m) => m[1]));
}

const SKU_NEAR_KEYWORD = /\bSKU\s*[:#]?\s*([A-Za-z0-9-]{3,30})/gi;
export function extractSkuCandidates(text: string): string[] {
  return uniqueInOrder([...text.matchAll(SKU_NEAR_KEYWORD)].map((m) => m[1]));
}

const GARMENT_VOCAB = ["hoodie", "t-shirt", "tee shirt", "tee", "tank top", "tank", "shorts", "joggers", "sweatshirt", "jacket", "beanie", "hat", "socks", "leggings"];
export function extractGarmentTypeCandidates(text: string): string[] {
  const lower = text.toLowerCase();
  return uniqueInOrder(GARMENT_VOCAB.filter((g) => lower.includes(g)));
}

const COLOR_VOCAB = ["black", "white", "red", "blue", "navy", "gray", "grey", "green", "heather gray", "heather grey", "maroon", "orange", "yellow", "purple", "pink", "charcoal"];
export function extractColorCandidates(text: string): string[] {
  const lower = text.toLowerCase();
  return uniqueInOrder(COLOR_VOCAB.filter((c) => lower.includes(c)));
}

const SIZE_PATTERN = /\b(XXS|XS|S|M|L|XL|XXL|XXXL|2XL|3XL|4XL)\b/g;
export function extractSizeCandidates(text: string): string[] {
  return uniqueInOrder(text.match(SIZE_PATTERN) ?? []);
}

const QUANTITY_NEAR_KEYWORD = /\b(?:qty|quantity)\s*[:#]?\s*(\d{1,4})\b/gi;
export function extractQuantityCandidates(text: string): string[] {
  return uniqueInOrder([...text.matchAll(QUANTITY_NEAR_KEYWORD)].map((m) => m[1]));
}

const CURRENCY_AMOUNT = /\$\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?/g;
export function extractPriceCandidates(text: string): string[] {
  return uniqueInOrder(text.match(CURRENCY_AMOUNT) ?? []);
}

const TOTAL_NEAR_KEYWORD = /\btotal\b[^$\n]{0,20}(\$\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/gi;
export function extractTotalCandidates(text: string): string[] {
  return uniqueInOrder([...text.matchAll(TOTAL_NEAR_KEYWORD)].map((m) => m[1]));
}

const CARRIER_VOCAB = ["UPS", "USPS", "FedEx", "DHL"];
export function extractShippingCarrierCandidates(text: string): string[] {
  return uniqueInOrder(CARRIER_VOCAB.filter((c) => new RegExp(`\\b${c}\\b`, "i").test(text)));
}

const ORDER_STATUS_VOCAB = ["Fulfilled", "Shipped", "Delivered", "Processing", "Pending", "Draft", "Canceled", "Cancelled", "In Production"];
export function extractOrderStatusCandidates(text: string): string[] {
  return uniqueInOrder(ORDER_STATUS_VOCAB.filter((s) => new RegExp(`\\b${s}\\b`, "i").test(text)));
}

export function extractFatleticMarkCandidates(text: string): string[] {
  return uniqueInOrder((text.match(/fatletic/gi) ?? []).map((m) => m));
}
