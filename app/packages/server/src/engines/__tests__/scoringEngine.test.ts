import { describe, expect, it } from "vitest";
import { computeUsefulness } from "../scoringEngine.js";
import type { ReviewAnswer } from "@trademark-evidence-assistant/shared";

function answer(questionId: string, value: string): ReviewAnswer {
  return { questionId, value, source: "user", confidence: null, note: null, answeredAt: "2026-01-01T00:00:00.000Z" };
}

describe("computeUsefulness", () => {
  it("is Undetermined with no answers at all", () => {
    const result = computeUsefulness({ answers: [], fileRole: null, hasDuplicates: false, hasNotes: false, connectionTypes: [] });
    expect(result.band).toBe("Undetermined");
  });

  it("is deterministic — same input always produces the same output", () => {
    const input = {
      answers: [answer("universal_commerce_link", "Yes, sold on Instagram")],
      fileRole: "product_photo" as const,
      hasDuplicates: false,
      hasNotes: false,
      connectionTypes: [],
    };
    const first = computeUsefulness(input);
    const second = computeUsefulness(input);
    expect(first).toEqual(second);
  });

  it("scores strongly for a well-documented commerce item", () => {
    const result = computeUsefulness({
      answers: [
        answer("universal_commerce_link", "Yes, this was sold to a customer"),
        answer("universal_mark_visible", "Yes, clearly visible on the shirt"),
        answer("universal_real_product", "Yes"),
        answer("universal_real_world_date", "September 2024, per the order confirmation email"),
      ],
      fileRole: "product_photo",
      hasDuplicates: false,
      hasNotes: false,
      connectionTypes: ["product_to_invoice", "supports_commercial_use"],
    });
    expect(result.score).toBeGreaterThanOrEqual(70);
    expect(result.band).toBe("Strong");
    expect(result.positiveFactors.length).toBeGreaterThan(0);
  });

  it("scores low when the mark isn't visible and there's no commerce link", () => {
    const result = computeUsefulness({
      answers: [
        answer("universal_commerce_link", "No"),
        answer("universal_mark_visible", "No, mark is cropped out"),
      ],
      fileRole: null,
      hasDuplicates: false,
      hasNotes: false,
      connectionTypes: [],
    });
    expect(result.band).toBe("None");
    expect(result.missingElements.join(" ")).toContain("commercial use");
  });

  it("never produces a score outside 0-100", () => {
    const worstCase = computeUsefulness({
      answers: [answer("universal_commerce_link", "no"), answer("universal_mark_visible", "no")],
      fileRole: "logo_source",
      hasDuplicates: true,
      hasNotes: false,
      connectionTypes: [],
    });
    expect(worstCase.score).toBeGreaterThanOrEqual(0);
    expect(worstCase.score).toBeLessThanOrEqual(100);
  });

  it("penalizes an unexplained exact duplicate", () => {
    const withoutContext = computeUsefulness({
      answers: [],
      fileRole: null,
      hasDuplicates: true,
      hasNotes: false,
      connectionTypes: [],
    });
    expect(withoutContext.missingElements.some((m) => m.includes("exact duplicate"))).toBe(true);
  });

  it("does not penalize a duplicate that has its own added context", () => {
    const withContext = computeUsefulness({
      answers: [answer("universal_what_is_this", "This is the version I printed on the second batch")],
      fileRole: null,
      hasDuplicates: true,
      hasNotes: false,
      connectionTypes: [],
    });
    expect(withContext.missingElements.some((m) => m.includes("exact duplicate"))).toBe(false);
  });

  it("flags a design source file with no commerce connection as possibly conceptual-only", () => {
    const result = computeUsefulness({
      answers: [],
      fileRole: "logo_source",
      hasDuplicates: false,
      hasNotes: false,
      connectionTypes: [],
    });
    expect(result.missingElements.some((m) => m.includes("conceptual-only"))).toBe(true);
  });

  it("gives credit for a commerce-document file role", () => {
    const result = computeUsefulness({
      answers: [],
      fileRole: "printful_invoice",
      hasDuplicates: false,
      hasNotes: false,
      connectionTypes: [],
    });
    expect(result.positiveFactors.some((f) => f.includes("commerce document"))).toBe(true);
  });

  it("never labels anything legally sufficient (spec 08)", () => {
    const result = computeUsefulness({
      answers: [
        answer("universal_commerce_link", "yes"),
        answer("universal_mark_visible", "yes"),
        answer("universal_real_product", "yes"),
        answer("universal_real_world_date", "confirmed via invoice"),
      ],
      fileRole: "printful_invoice",
      hasDuplicates: false,
      hasNotes: false,
      connectionTypes: ["supports_continuous_use", "supports_commercial_use"],
    });
    const allText = [...result.positiveFactors, ...result.missingElements, result.band].join(" ").toLowerCase();
    expect(allText).not.toContain("legally sufficient");
    expect(allText).not.toContain("proves");
    expect(allText).not.toContain("guarantees");
  });
});
