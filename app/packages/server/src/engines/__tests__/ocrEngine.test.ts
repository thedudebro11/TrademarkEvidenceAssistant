import { describe, expect, it } from "vitest";
import { extractCandidates, extractDateCandidates, extractOrderNumberCandidates } from "../ocrEngine.js";

const SAMPLE_PRINTFUL_ORDER_TEXT = `
Order #PF116824539 Feb 20, 2025, 03:16am
Order is fulfilled. Delivered on Feb 28, 2025.
Shipment #116824539-61108975
shipped on Feb 25 via FedEx Ground Home Delivery #772305581223
Delivered: Feb 28, 2025
Product Unisex Long Sleeve Tee | Bella + Canvas 3501 (Black Heather / XL)
`;

describe("ocrEngine (deterministic regex extraction from raw OCR text)", () => {
  it("extracts every month-name date candidate, deduplicated, in the order found", () => {
    const dates = extractDateCandidates(SAMPLE_PRINTFUL_ORDER_TEXT);
    expect(dates).toContain("Feb 20, 2025");
    expect(dates).toContain("Feb 28, 2025");
    // "Delivered on Feb 28, 2025." and "Delivered: Feb 28, 2025" both
    // contain the same date string — deduplicated, not listed twice.
    expect(dates.filter((d) => d === "Feb 28, 2025")).toHaveLength(1);
  });

  it("extracts numeric slash dates", () => {
    expect(extractDateCandidates("Invoice date: 02/20/2025")).toContain("02/20/2025");
  });

  it("extracts ISO dates", () => {
    expect(extractDateCandidates("scanned: 2025-02-20")).toContain("2025-02-20");
  });

  it("extracts order-number-shaped tokens (# followed by letters/digits)", () => {
    const orders = extractOrderNumberCandidates(SAMPLE_PRINTFUL_ORDER_TEXT);
    expect(orders).toContain("#PF116824539");
    // "Shipment #116824539-61108975" — the digit run stops at the
    // hyphen, so the shipment number's first segment is its own
    // candidate rather than the two halves being merged into one.
    expect(orders).toContain("#116824539");
  });

  it("does not fabricate a candidate when nothing matches — returns an empty array, not a guess", () => {
    expect(extractDateCandidates("no dates or numbers here")).toEqual([]);
    expect(extractOrderNumberCandidates("no dates or numbers here")).toEqual([]);
  });

  it("is deterministic — same input always produces the same output", () => {
    const first = extractCandidates(SAMPLE_PRINTFUL_ORDER_TEXT);
    const second = extractCandidates(SAMPLE_PRINTFUL_ORDER_TEXT);
    expect(first).toEqual(second);
  });

  it("extractCandidates bundles raw text with both candidate lists, changing nothing about the raw text itself", () => {
    const result = extractCandidates(SAMPLE_PRINTFUL_ORDER_TEXT);
    expect(result.rawText).toBe(SAMPLE_PRINTFUL_ORDER_TEXT);
    expect(result.dateCandidates.length).toBeGreaterThan(0);
    expect(result.orderNumberCandidates.length).toBeGreaterThan(0);
  });
});
