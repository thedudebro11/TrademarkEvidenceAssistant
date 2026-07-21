import { describe, expect, it } from "vitest";
import { DESIGN_MOCKUP_EVIDENCE_TYPE_ID, DESIGN_MOCKUP_QUESTION_IDS, PRODUCT_MOCKUP_EVIDENCE_TYPE_ID, type ArchiveSimilarAnswerInput } from "./archiveSimilarEligibility.js";
import { EARLIER_LOGO_ITERATION_DEFAULT_CREATOR, getArchiveSimilarPresetByOperationType, getArchiveSimilarPresetsForEvidenceType, resolveArchiveSimilarPreset } from "./archiveSimilarPresets.js";

function unusedDesignAnswers(): Record<string, ArchiveSimilarAnswerInput> {
  return {
    [DESIGN_MOCKUP_QUESTION_IDS.internalConcept]: { value: "Yes", confidence: "high" },
    [DESIGN_MOCKUP_QUESTION_IDS.finalDesign]: { value: "No", confidence: "high" },
    [DESIGN_MOCKUP_QUESTION_IDS.creator]: { value: "Someone", confidence: "high" },
    [DESIGN_MOCKUP_QUESTION_IDS.publiclyReleased]: { value: "No", confidence: "high" },
    [DESIGN_MOCKUP_QUESTION_IDS.relatedPsd]: { value: "No", confidence: "high" },
    [DESIGN_MOCKUP_QUESTION_IDS.relatedFinalLogo]: { value: "No", confidence: "high" },
  };
}

function earlierLogoIterationAnswers(): Record<string, ArchiveSimilarAnswerInput> {
  return {
    [DESIGN_MOCKUP_QUESTION_IDS.internalConcept]: { value: "Yes", confidence: "high" },
    [DESIGN_MOCKUP_QUESTION_IDS.finalDesign]: { value: "No", confidence: "high" },
    [DESIGN_MOCKUP_QUESTION_IDS.publiclyReleased]: { value: "No", confidence: "high" },
    [DESIGN_MOCKUP_QUESTION_IDS.relatedPsd]: { value: "No", confidence: "high" },
    [DESIGN_MOCKUP_QUESTION_IDS.relatedFinalLogo]: { value: "Yes", confidence: "high" },
  };
}

describe("getArchiveSimilarPresetsForEvidenceType", () => {
  it("returns exactly one preset for product_mockup", () => {
    expect(getArchiveSimilarPresetsForEvidenceType(PRODUCT_MOCKUP_EVIDENCE_TYPE_ID).map((p) => p.id)).toEqual(["product_mockup"]);
  });

  it("returns both design_mockup presets, unused-design first", () => {
    expect(getArchiveSimilarPresetsForEvidenceType(DESIGN_MOCKUP_EVIDENCE_TYPE_ID).map((p) => p.id)).toEqual(["design_mockup", "design_mockup_earlier_logo_iteration"]);
  });

  it("returns an empty array for an unrelated evidence type", () => {
    expect(getArchiveSimilarPresetsForEvidenceType("final_logo")).toEqual([]);
  });
});

describe("resolveArchiveSimilarPreset", () => {
  it("resolves the unused-design preset when relatedFinalLogo = No", () => {
    const preset = resolveArchiveSimilarPreset(DESIGN_MOCKUP_EVIDENCE_TYPE_ID, unusedDesignAnswers(), "archive");
    expect(preset?.id).toBe("design_mockup");
  });

  it("resolves Earlier Logo Iterations when relatedFinalLogo = Yes", () => {
    const preset = resolveArchiveSimilarPreset(DESIGN_MOCKUP_EVIDENCE_TYPE_ID, earlierLogoIterationAnswers(), "archive");
    expect(preset?.id).toBe("design_mockup_earlier_logo_iteration");
  });

  it("returns null when no registered preset validates", () => {
    const answers = { ...unusedDesignAnswers(), [DESIGN_MOCKUP_QUESTION_IDS.finalDesign]: { value: "Yes", confidence: "high" as const } };
    expect(resolveArchiveSimilarPreset(DESIGN_MOCKUP_EVIDENCE_TYPE_ID, answers, "archive")).toBeNull();
  });

  it("returns null for an evidence type with no registered preset", () => {
    expect(resolveArchiveSimilarPreset("final_logo", {}, "archive")).toBeNull();
  });
});

describe("getArchiveSimilarPresetByOperationType", () => {
  it("recovers each preset by its own distinct operation type", () => {
    expect(getArchiveSimilarPresetByOperationType("BULK_ARCHIVE_SIMILAR")?.id).toBe("product_mockup");
    expect(getArchiveSimilarPresetByOperationType("BULK_ARCHIVE_SIMILAR_DESIGN_MOCKUPS")?.id).toBe("design_mockup");
    expect(getArchiveSimilarPresetByOperationType("ARCHIVE_SIMILAR_EARLIER_LOGO_ITERATIONS")?.id).toBe("design_mockup_earlier_logo_iteration");
  });

  it("returns null for an unknown operation type", () => {
    expect(getArchiveSimilarPresetByOperationType("SOMETHING_ELSE")).toBeNull();
  });
});

describe("EARLIER_LOGO_ITERATION_DEFAULT_CREATOR", () => {
  it("is defined once and matches the preset's own defaultCreator field", () => {
    const preset = getArchiveSimilarPresetsForEvidenceType(DESIGN_MOCKUP_EVIDENCE_TYPE_ID).find((p) => p.id === "design_mockup_earlier_logo_iteration")!;
    expect(preset.defaultCreator).toBe(EARLIER_LOGO_ITERATION_DEFAULT_CREATOR);
    expect(EARLIER_LOGO_ITERATION_DEFAULT_CREATOR).toBe("Oscar V & Michael M");
  });

  it("the unused-design preset has no defaultCreator", () => {
    const preset = getArchiveSimilarPresetsForEvidenceType(DESIGN_MOCKUP_EVIDENCE_TYPE_ID).find((p) => p.id === "design_mockup")!;
    expect(preset.defaultCreator).toBeUndefined();
  });
});
