import { describe, expect, it } from "vitest";
import {
  ARCHIVE_SIMILAR_REASON_LABELS,
  DESIGN_MOCKUP_EVIDENCE_TYPE_ID,
  DESIGN_MOCKUP_QUESTION_IDS,
  PRODUCT_MOCKUP_EVIDENCE_TYPE_ID,
  PRODUCT_MOCKUP_QUESTION_IDS,
  PROTECTED_CONNECTION_TYPES,
  folderOf,
  getArchiveSimilarEligibility,
  getDesignMockupArchiveSimilarEligibility,
  getDesignMockupProtectedConnection,
  getEarlierLogoIterationArchiveSimilarEligibility,
  getEarlierLogoIterationProtectedConnection,
  validateDesignMockupTemplate,
  validateEarlierLogoIterationTemplate,
  validateProductMockupTemplate,
  type ArchiveSimilarAnswerInput,
  type ArchiveSimilarCandidateInput,
  type ArchiveSimilarConnectionInfo,
  type ArchiveSimilarSourceInput,
} from "./archiveSimilarEligibility.js";

const source: ArchiveSimilarSourceInput = {
  id: "source-1",
  originalPath: "Mockups/All-Over Print Drawstring Bag/mockup_1.jpg",
  evidenceTypeId: "product_mockup",
};

function candidate(overrides: Partial<ArchiveSimilarCandidateInput> = {}): ArchiveSimilarCandidateInput {
  return {
    id: "candidate-1",
    originalPath: "Mockups/All-Over Print Drawstring Bag/mockup_2.jpg",
    extension: "jpg",
    reviewStatus: "unreviewed",
    inclusionDecision: null,
    evidenceTypeId: null,
    connectionTypes: [],
    ...overrides,
  };
}

describe("getArchiveSimilarEligibility — eligible cases", () => {
  it("1. an unreviewed Product Mockup image in the same folder qualifies", () => {
    const c = candidate({ evidenceTypeId: "product_mockup" });
    expect(getArchiveSimilarEligibility(c, source)).toEqual({ eligible: true, reasonCode: null, reasonLabel: null });
  });

  it("2. an unclassified image in the same folder as a confirmed Product Mockup source qualifies", () => {
    const c = candidate({ evidenceTypeId: null });
    expect(getArchiveSimilarEligibility(c, source).eligible).toBe(true);
  });
});

describe("getArchiveSimilarEligibility — exclusions", () => {
  it("3. the source item never appears as its own candidate", () => {
    const c = candidate({ id: source.id, originalPath: source.originalPath });
    const result = getArchiveSimilarEligibility(c, source);
    expect(result).toEqual({ eligible: false, reasonCode: "SOURCE_ITEM", reasonLabel: ARCHIVE_SIMILAR_REASON_LABELS.SOURCE_ITEM });
  });

  it("4. a file in a different folder does not qualify", () => {
    const c = candidate({ originalPath: "Mockups/Other Product/mockup.jpg" });
    expect(getArchiveSimilarEligibility(c, source).reasonCode).toBe("DIFFERENT_FOLDER");
  });

  it("5. a video does not qualify", () => {
    const c = candidate({ originalPath: "Mockups/All-Over Print Drawstring Bag/clip.mp4", extension: "mp4" });
    expect(getArchiveSimilarEligibility(c, source).reasonCode).toBe("UNSUPPORTED_MEDIA_TYPE");
  });

  it("6. an XCF file does not qualify as an eligible image", () => {
    const c = candidate({ originalPath: "Mockups/All-Over Print Drawstring Bag/source.xcf", extension: "xcf" });
    expect(getArchiveSimilarEligibility(c, source).reasonCode).toBe("UNSUPPORTED_MEDIA_TYPE");
  });

  it("7. a PDF/document does not qualify", () => {
    const c = candidate({ originalPath: "Mockups/All-Over Print Drawstring Bag/spec.pdf", extension: "pdf" });
    expect(getArchiveSimilarEligibility(c, source).reasonCode).toBe("UNSUPPORTED_MEDIA_TYPE");
  });

  it("8. an already-archived (excluded) item does not qualify", () => {
    const c = candidate({ reviewStatus: "excluded", inclusionDecision: "not_useful" });
    expect(getArchiveSimilarEligibility(c, source).reasonCode).toBe("ALREADY_ARCHIVED");
  });

  it("9. an already-included item does not qualify", () => {
    const c = candidate({ reviewStatus: "reviewed", inclusionDecision: "include" });
    expect(getArchiveSimilarEligibility(c, source).reasonCode).toBe("ALREADY_INCLUDED");
  });

  it("10. a Needs Follow-Up item does not qualify", () => {
    const c = candidate({ reviewStatus: "needs_follow_up" });
    expect(getArchiveSimilarEligibility(c, source).reasonCode).toBe("NEEDS_FOLLOW_UP");
  });

  it("11. a different confirmed evidence type does not qualify", () => {
    const c = candidate({ evidenceTypeId: "final_logo" });
    expect(getArchiveSimilarEligibility(c, source).reasonCode).toBe("DIFFERENT_CONFIRMED_EVIDENCE_TYPE");
  });

  it("12. a conflicting completed review ('maybe') does not qualify", () => {
    const c = candidate({ reviewStatus: "reviewed", inclusionDecision: "maybe" });
    expect(getArchiveSimilarEligibility(c, source).reasonCode).toBe("CONFLICTING_REVIEW");
  });

  it("13. a candidate already confirmed as Product Mockup with a compatible (unreviewed) status is eligible, per documented policy — only review status, not evidence-type confirmation, gates eligibility", () => {
    const c = candidate({ evidenceTypeId: "product_mockup", reviewStatus: "unreviewed" });
    expect(getArchiveSimilarEligibility(c, source).eligible).toBe(true);
  });

  it("14. a protected connection on the outbound side prevents eligibility", () => {
    const c = candidate({ connectionTypes: ["product_to_invoice"] });
    const result = getArchiveSimilarEligibility(c, source);
    expect(result.reasonCode).toBe("PROTECTED_CONNECTION");
    expect(result.details).toEqual({ connectionType: "product_to_invoice" });
  });

  it("15. a protected connection on the inbound side prevents eligibility (connectionTypes is direction-agnostic by construction)", () => {
    // getConnectionsForItem (server) flattens both outgoing and incoming
    // connections into one list before this function ever sees it, so
    // there is no separate "inbound" check here — this test documents
    // that assumption: any protected type in the list blocks eligibility
    // regardless of which side of the relationship produced it.
    const c = candidate({ connectionTypes: ["invoice_to_customer"] });
    expect(getArchiveSimilarEligibility(c, source).reasonCode).toBe("PROTECTED_CONNECTION");
  });

  it("16. a non-protected duplicate/source/design/related_to connection does not prevent eligibility", () => {
    const c = candidate({
      connectionTypes: ["duplicate_of", "duplicate_variant_of", "source_design_to_export", "export_to_product", "related_to", "video_to_event", "supports_date"],
    });
    expect(getArchiveSimilarEligibility(c, source).eligible).toBe(true);
  });

  it("17. every exclusion returns a stable reason code paired with its documented label", () => {
    const c = candidate({ reviewStatus: "excluded" });
    const result = getArchiveSimilarEligibility(c, source);
    expect(result.reasonCode).toBe("ALREADY_ARCHIVED");
    expect(result.reasonLabel).toBe(ARCHIVE_SIMILAR_REASON_LABELS.ALREADY_ARCHIVED);
  });
});

describe("PROTECTED_CONNECTION_TYPES — every allowlisted type actually blocks eligibility", () => {
  for (const type of PROTECTED_CONNECTION_TYPES) {
    it(`${type} protects a candidate from Archive Similar`, () => {
      const c = candidate({ connectionTypes: [type] });
      expect(getArchiveSimilarEligibility(c, source).reasonCode).toBe("PROTECTED_CONNECTION");
    });
  }
});

describe("folderOf", () => {
  it("returns the path minus the filename", () => {
    expect(folderOf("Mockups/Bag/mockup.jpg")).toBe("Mockups/Bag");
    expect(folderOf("mockup.jpg")).toBe("");
  });
});

describe("validateProductMockupTemplate", () => {
  const validAnswers = {
    [PRODUCT_MOCKUP_QUESTION_IDS.everProduced]: { value: "No", confidence: "high" as const },
    [PRODUCT_MOCKUP_QUESTION_IDS.matchingRecord]: { value: "no", confidence: "high" as const },
  };

  it("18. Product Mockup with No/High and No/High enables the feature", () => {
    const result = validateProductMockupTemplate({
      evidenceTypeId: PRODUCT_MOCKUP_EVIDENCE_TYPE_ID,
      answers: validAnswers,
      decisionAction: "archive",
    });
    expect(result).toEqual({ valid: true, reasonCode: null });
  });

  it("19. a Yes answer disables the feature", () => {
    const result = validateProductMockupTemplate({
      evidenceTypeId: PRODUCT_MOCKUP_EVIDENCE_TYPE_ID,
      answers: { ...validAnswers, [PRODUCT_MOCKUP_QUESTION_IDS.everProduced]: { value: "Yes", confidence: "high" } },
      decisionAction: "archive",
    });
    expect(result.valid).toBe(false);
    expect(result.reasonCode).toBe("INVALID_PRODUCT_MOCKUP_TEMPLATE");
  });

  it("20. Medium or Low confidence disables the feature", () => {
    const medium = validateProductMockupTemplate({
      evidenceTypeId: PRODUCT_MOCKUP_EVIDENCE_TYPE_ID,
      answers: { ...validAnswers, [PRODUCT_MOCKUP_QUESTION_IDS.matchingRecord]: { value: "no", confidence: "medium" } },
      decisionAction: "archive",
    });
    expect(medium.valid).toBe(false);
    const low = validateProductMockupTemplate({
      evidenceTypeId: PRODUCT_MOCKUP_EVIDENCE_TYPE_ID,
      answers: { ...validAnswers, [PRODUCT_MOCKUP_QUESTION_IDS.everProduced]: { value: "no", confidence: "low" } },
      decisionAction: "archive",
    });
    expect(low.valid).toBe(false);
  });

  it("21. a different evidence type disables the feature", () => {
    const result = validateProductMockupTemplate({ evidenceTypeId: "final_logo", answers: validAnswers, decisionAction: "archive" });
    expect(result.valid).toBe(false);
    expect(result.reasonCode).toBe("INVALID_PRODUCT_MOCKUP_TEMPLATE");
  });

  it("missing answers disable the feature", () => {
    const result = validateProductMockupTemplate({ evidenceTypeId: PRODUCT_MOCKUP_EVIDENCE_TYPE_ID, answers: {}, decisionAction: "archive" });
    expect(result.valid).toBe(false);
  });

  it("a decision other than archive disables the feature, even with a matching template", () => {
    const result = validateProductMockupTemplate({ evidenceTypeId: PRODUCT_MOCKUP_EVIDENCE_TYPE_ID, answers: validAnswers, decisionAction: "include" });
    expect(result.valid).toBe(false);
  });

  it("24. the backend rejects a forged non-Product-Mockup template even if decisionAction/answers otherwise look plausible", () => {
    const result = validateProductMockupTemplate({
      evidenceTypeId: "printful_invoice",
      answers: validAnswers,
      decisionAction: "archive",
    });
    expect(result.valid).toBe(false);
    expect(result.reasonCode).toBe("INVALID_PRODUCT_MOCKUP_TEMPLATE");
  });
});

// ---------------------------------------------------------------------
// Design Mockup preset — docs/ADR_0004_ARCHIVE_SIMILAR.md extension.
// ---------------------------------------------------------------------

function designMockupAnswers(overrides: Partial<Record<string, ArchiveSimilarAnswerInput>> = {}): Record<string, ArchiveSimilarAnswerInput> {
  return {
    [DESIGN_MOCKUP_QUESTION_IDS.internalConcept]: { value: "Yes", confidence: "high" },
    [DESIGN_MOCKUP_QUESTION_IDS.finalDesign]: { value: "No", confidence: "high" },
    [DESIGN_MOCKUP_QUESTION_IDS.creator]: { value: "Oscar V. & Michael M.", confidence: "high" },
    [DESIGN_MOCKUP_QUESTION_IDS.publiclyReleased]: { value: "No", confidence: "high" },
    [DESIGN_MOCKUP_QUESTION_IDS.relatedPsd]: { value: "No", confidence: "high" },
    [DESIGN_MOCKUP_QUESTION_IDS.relatedFinalLogo]: { value: "No", confidence: "high" },
    ...overrides,
  };
}

describe("validateDesignMockupTemplate", () => {
  it("1. a valid unused Design Mockup template enables Archive Similar", () => {
    const result = validateDesignMockupTemplate({ evidenceTypeId: DESIGN_MOCKUP_EVIDENCE_TYPE_ID, answers: designMockupAnswers(), decisionAction: "archive" });
    expect(result).toEqual({ valid: true, reasonCode: null });
  });

  it("2. final design = Yes disables the preset", () => {
    const answers = designMockupAnswers({ [DESIGN_MOCKUP_QUESTION_IDS.finalDesign]: { value: "Yes", confidence: "high" } });
    const result = validateDesignMockupTemplate({ evidenceTypeId: DESIGN_MOCKUP_EVIDENCE_TYPE_ID, answers, decisionAction: "archive" });
    expect(result.valid).toBe(false);
    expect(result.reasonCode).toBe("INVALID_DESIGN_MOCKUP_TEMPLATE");
  });

  it("3. released publicly = Yes disables the preset", () => {
    const answers = designMockupAnswers({ [DESIGN_MOCKUP_QUESTION_IDS.publiclyReleased]: { value: "Yes", confidence: "high" } });
    expect(validateDesignMockupTemplate({ evidenceTypeId: DESIGN_MOCKUP_EVIDENCE_TYPE_ID, answers, decisionAction: "archive" }).valid).toBe(false);
  });

  it("4. led to final logo = Yes disables the preset", () => {
    const answers = designMockupAnswers({ [DESIGN_MOCKUP_QUESTION_IDS.relatedFinalLogo]: { value: "Yes", confidence: "high" } });
    expect(validateDesignMockupTemplate({ evidenceTypeId: DESIGN_MOCKUP_EVIDENCE_TYPE_ID, answers, decisionAction: "archive" }).valid).toBe(false);
  });

  it("5. a non-archive decision disables the preset even with a matching template", () => {
    const result = validateDesignMockupTemplate({ evidenceTypeId: DESIGN_MOCKUP_EVIDENCE_TYPE_ID, answers: designMockupAnswers(), decisionAction: "include" });
    expect(result.valid).toBe(false);
  });

  it("6. a missing required shared answer disables the preset", () => {
    const answers = designMockupAnswers();
    delete answers[DESIGN_MOCKUP_QUESTION_IDS.creator];
    expect(validateDesignMockupTemplate({ evidenceTypeId: DESIGN_MOCKUP_EVIDENCE_TYPE_ID, answers, decisionAction: "archive" }).valid).toBe(false);
  });

  it("internal idea must be Yes at high confidence — a Design Mockup that was never internal-only isn't this preset's concept", () => {
    const answers = designMockupAnswers({ [DESIGN_MOCKUP_QUESTION_IDS.internalConcept]: { value: "No", confidence: "high" } });
    expect(validateDesignMockupTemplate({ evidenceTypeId: DESIGN_MOCKUP_EVIDENCE_TYPE_ID, answers, decisionAction: "archive" }).valid).toBe(false);
  });

  it("medium/low confidence on a required No answer disables the preset", () => {
    const answers = designMockupAnswers({ [DESIGN_MOCKUP_QUESTION_IDS.finalDesign]: { value: "No", confidence: "medium" } });
    expect(validateDesignMockupTemplate({ evidenceTypeId: DESIGN_MOCKUP_EVIDENCE_TYPE_ID, answers, decisionAction: "archive" }).valid).toBe(false);
  });

  it("8. a forged non-Design-Mockup evidence type is rejected even with otherwise-valid answers", () => {
    const result = validateDesignMockupTemplate({ evidenceTypeId: "product_mockup", answers: designMockupAnswers(), decisionAction: "archive" });
    expect(result.valid).toBe(false);
    expect(result.reasonCode).toBe("INVALID_DESIGN_MOCKUP_TEMPLATE");
  });

  it("the creation-date question is never required — it's derived per-item, not copied", () => {
    const answers = designMockupAnswers();
    expect(answers[DESIGN_MOCKUP_QUESTION_IDS.creationDate]).toBeUndefined();
    expect(validateDesignMockupTemplate({ evidenceTypeId: DESIGN_MOCKUP_EVIDENCE_TYPE_ID, answers, decisionAction: "archive" }).valid).toBe(true);
  });
});

const designMockupSource: ArchiveSimilarSourceInput = {
  id: "dm-source-1",
  originalPath: "Design Mockups/Concepts/concept_1.png",
  evidenceTypeId: DESIGN_MOCKUP_EVIDENCE_TYPE_ID,
};

function designMockupCandidate(overrides: Partial<ArchiveSimilarCandidateInput> = {}): ArchiveSimilarCandidateInput {
  return {
    id: "dm-candidate-1",
    originalPath: "Design Mockups/Concepts/concept_2.png",
    extension: "png",
    reviewStatus: "unreviewed",
    inclusionDecision: null,
    evidenceTypeId: null,
    connectionTypes: [],
    connections: [],
    filesystemModifiedAt: "2024-09-12T12:00:00.000Z",
    ...overrides,
  };
}

describe("getDesignMockupArchiveSimilarEligibility", () => {
  const answers = designMockupAnswers();

  it("24. a same-folder unreviewed Design Mockup image with a valid date qualifies", () => {
    const c = designMockupCandidate({ evidenceTypeId: DESIGN_MOCKUP_EVIDENCE_TYPE_ID });
    expect(getDesignMockupArchiveSimilarEligibility(c, designMockupSource, answers)).toEqual({ eligible: true, reasonCode: null, reasonLabel: null });
  });

  it("25. a same-folder unclassified image qualifies under the documented policy", () => {
    const c = designMockupCandidate({ evidenceTypeId: null });
    expect(getDesignMockupArchiveSimilarEligibility(c, designMockupSource, answers).eligible).toBe(true);
  });

  it("26. a different folder does not qualify", () => {
    const c = designMockupCandidate({ originalPath: "Design Mockups/Other/concept.png" });
    expect(getDesignMockupArchiveSimilarEligibility(c, designMockupSource, answers).reasonCode).toBe("DIFFERENT_FOLDER");
  });

  it("27. a confirmed Product Mockup does not qualify for the Design Mockup preset", () => {
    const c = designMockupCandidate({ evidenceTypeId: "product_mockup" });
    expect(getDesignMockupArchiveSimilarEligibility(c, designMockupSource, answers).reasonCode).toBe("DIFFERENT_CONFIRMED_EVIDENCE_TYPE");
  });

  it("28. an XCF file does not qualify as a target image", () => {
    const c = designMockupCandidate({ originalPath: "Design Mockups/Concepts/source.xcf", extension: "xcf" });
    expect(getDesignMockupArchiveSimilarEligibility(c, designMockupSource, answers).reasonCode).toBe("UNSUPPORTED_MEDIA_TYPE");
  });

  it("29. a PSD file does not qualify as a target image", () => {
    const c = designMockupCandidate({ originalPath: "Design Mockups/Concepts/source.psd", extension: "psd" });
    expect(getDesignMockupArchiveSimilarEligibility(c, designMockupSource, answers).reasonCode).toBe("UNSUPPORTED_MEDIA_TYPE");
  });

  it("30. video and PDF do not qualify", () => {
    expect(getDesignMockupArchiveSimilarEligibility(designMockupCandidate({ extension: "mp4" }), designMockupSource, answers).reasonCode).toBe("UNSUPPORTED_MEDIA_TYPE");
    expect(getDesignMockupArchiveSimilarEligibility(designMockupCandidate({ extension: "pdf" }), designMockupSource, answers).reasonCode).toBe("UNSUPPORTED_MEDIA_TYPE");
  });

  it("31. an Included item does not qualify", () => {
    const c = designMockupCandidate({ reviewStatus: "reviewed", inclusionDecision: "include" });
    expect(getDesignMockupArchiveSimilarEligibility(c, designMockupSource, answers).reasonCode).toBe("ALREADY_INCLUDED");
  });

  it("32. a Needs Follow-Up item does not qualify", () => {
    const c = designMockupCandidate({ reviewStatus: "needs_follow_up" });
    expect(getDesignMockupArchiveSimilarEligibility(c, designMockupSource, answers).reasonCode).toBe("NEEDS_FOLLOW_UP");
  });

  it("33. an already-archived item does not qualify", () => {
    const c = designMockupCandidate({ reviewStatus: "excluded" });
    expect(getDesignMockupArchiveSimilarEligibility(c, designMockupSource, answers).reasonCode).toBe("ALREADY_ARCHIVED");
  });

  it("34. a conflicting completed review does not qualify", () => {
    const c = designMockupCandidate({ reviewStatus: "reviewed", inclusionDecision: "maybe" });
    expect(getDesignMockupArchiveSimilarEligibility(c, designMockupSource, answers).reasonCode).toBe("CONFLICTING_REVIEW");
  });

  it("35. the source item never appears as its own candidate", () => {
    const c = designMockupCandidate({ id: designMockupSource.id, originalPath: designMockupSource.originalPath });
    expect(getDesignMockupArchiveSimilarEligibility(c, designMockupSource, answers).reasonCode).toBe("SOURCE_ITEM");
  });

  it("15/16. a missing or invalid filesystem date excludes the file with a specific reason code", () => {
    expect(getDesignMockupArchiveSimilarEligibility(designMockupCandidate({ filesystemModifiedAt: null }), designMockupSource, answers).reasonCode).toBe("MISSING_FILESYSTEM_DATE");
    expect(getDesignMockupArchiveSimilarEligibility(designMockupCandidate({ filesystemModifiedAt: "garbage" }), designMockupSource, answers).reasonCode).toBe("INVALID_FILESYSTEM_DATE");
  });

  it("a non-protected duplicate/timeline connection does not prevent eligibility", () => {
    const c = designMockupCandidate({
      connections: [
        { type: "duplicate_of", direction: "outgoing", otherItemEvidenceTypeId: null },
        { type: "video_to_event", direction: "incoming", otherItemEvidenceTypeId: null },
        { type: "related_to", direction: "outgoing", otherItemEvidenceTypeId: "design_mockup" },
      ],
    });
    expect(getDesignMockupArchiveSimilarEligibility(c, designMockupSource, answers).eligible).toBe(true);
  });
});

describe("getDesignMockupProtectedConnection", () => {
  const noAnswers = designMockupAnswers();
  const yesPsdAnswers = designMockupAnswers({ [DESIGN_MOCKUP_QUESTION_IDS.relatedPsd]: { value: "Yes", confidence: "high" } });

  it("36. an inbound protected connection (supports_commercial_use) excludes a file", () => {
    const connections: ArchiveSimilarConnectionInfo[] = [{ type: "supports_commercial_use", direction: "incoming", otherItemEvidenceTypeId: null }];
    expect(getDesignMockupProtectedConnection(connections, noAnswers)?.reasonCode).toBe("CONNECTED_TO_COMMERCIAL_USE");
  });

  it("37. an outbound protected connection (product_to_invoice) excludes a file", () => {
    const connections: ArchiveSimilarConnectionInfo[] = [{ type: "product_to_invoice", direction: "outgoing", otherItemEvidenceTypeId: null }];
    expect(getDesignMockupProtectedConnection(connections, noAnswers)?.reasonCode).toBe("CONNECTED_TO_COMMERCIAL_USE");
  });

  it("38. an outbound source_design_to_export relationship to a final_logo item excludes a file when the copied answer says 'No'", () => {
    const connections: ArchiveSimilarConnectionInfo[] = [{ type: "source_design_to_export", direction: "outgoing", otherItemEvidenceTypeId: "final_logo" }];
    expect(getDesignMockupProtectedConnection(connections, noAnswers)?.reasonCode).toBe("CONNECTED_TO_FINAL_LOGO");
  });

  it("does not protect a final_logo relationship when the copied answer already says 'Yes' (no contradiction)", () => {
    const yesLogoAnswers = designMockupAnswers({ [DESIGN_MOCKUP_QUESTION_IDS.relatedFinalLogo]: { value: "Yes", confidence: "high" } });
    const connections: ArchiveSimilarConnectionInfo[] = [{ type: "source_design_to_export", direction: "outgoing", otherItemEvidenceTypeId: "final_logo" }];
    expect(getDesignMockupProtectedConnection(connections, yesLogoAnswers)).toBeNull();
  });

  it("39. an inbound source_design_to_export relationship from a real PSD source excludes a file when the template says no source exists", () => {
    const connections: ArchiveSimilarConnectionInfo[] = [{ type: "source_design_to_export", direction: "incoming", otherItemEvidenceTypeId: "psd_source" }];
    expect(getDesignMockupProtectedConnection(connections, noAnswers)?.reasonCode).toBe("HAS_WORKING_SOURCE_FILE");
  });

  it("does not protect a working-source relationship when the template already says a source exists", () => {
    const connections: ArchiveSimilarConnectionInfo[] = [{ type: "source_design_to_export", direction: "incoming", otherItemEvidenceTypeId: "illustrator_source" }];
    expect(getDesignMockupProtectedConnection(connections, yesPsdAnswers)).toBeNull();
  });

  it("40a. an export_to_product relationship to a real product excludes a file", () => {
    const connections: ArchiveSimilarConnectionInfo[] = [{ type: "export_to_product", direction: "outgoing", otherItemEvidenceTypeId: "product_photo" }];
    expect(getDesignMockupProtectedConnection(connections, noAnswers)?.reasonCode).toBe("CONNECTED_TO_REAL_PRODUCT");
  });

  it("40b. a product_to_social_post / customer-photo relationship excludes a file (public release)", () => {
    expect(
      getDesignMockupProtectedConnection([{ type: "product_to_social_post", direction: "outgoing", otherItemEvidenceTypeId: null }], noAnswers)?.reasonCode,
    ).toBe("CONNECTED_TO_PUBLIC_RELEASE");
    expect(
      getDesignMockupProtectedConnection([{ type: "social_post_to_customer_photo", direction: "incoming", otherItemEvidenceTypeId: null }], noAnswers)?.reasonCode,
    ).toBe("CONNECTED_TO_PUBLIC_RELEASE");
  });

  it("a source_design_to_export relationship to an unrelated evidence type is not protected", () => {
    const connections: ArchiveSimilarConnectionInfo[] = [{ type: "source_design_to_export", direction: "outgoing", otherItemEvidenceTypeId: "design_mockup" }];
    expect(getDesignMockupProtectedConnection(connections, noAnswers)).toBeNull();
  });

  it("an export_to_product relationship to a non-product evidence type is not protected", () => {
    const connections: ArchiveSimilarConnectionInfo[] = [{ type: "export_to_product", direction: "outgoing", otherItemEvidenceTypeId: "final_logo" }];
    expect(getDesignMockupProtectedConnection(connections, noAnswers)).toBeNull();
  });
});

// ---------------------------------------------------------------------
// Earlier Logo Iterations preset — second Design Mockup preset.
// ---------------------------------------------------------------------

function earlierLogoIterationAnswers(overrides: Partial<Record<string, ArchiveSimilarAnswerInput>> = {}): Record<string, ArchiveSimilarAnswerInput> {
  return {
    [DESIGN_MOCKUP_QUESTION_IDS.internalConcept]: { value: "Yes", confidence: "high" },
    [DESIGN_MOCKUP_QUESTION_IDS.finalDesign]: { value: "No", confidence: "high" },
    [DESIGN_MOCKUP_QUESTION_IDS.publiclyReleased]: { value: "No", confidence: "high" },
    [DESIGN_MOCKUP_QUESTION_IDS.relatedPsd]: { value: "No", confidence: "high" },
    [DESIGN_MOCKUP_QUESTION_IDS.relatedFinalLogo]: { value: "Yes", confidence: "high" },
    ...overrides,
  };
}

describe("validateEarlierLogoIterationTemplate", () => {
  it("1. an earlier internal Design Mockup with led-to-final = Yes activates this preset", () => {
    const result = validateEarlierLogoIterationTemplate({ evidenceTypeId: DESIGN_MOCKUP_EVIDENCE_TYPE_ID, answers: earlierLogoIterationAnswers(), decisionAction: "archive" });
    expect(result).toEqual({ valid: true, reasonCode: null });
  });

  it("7. creator is never required — this preset auto-defaults it", () => {
    const answers = earlierLogoIterationAnswers();
    expect(answers[DESIGN_MOCKUP_QUESTION_IDS.creator]).toBeUndefined();
    expect(validateEarlierLogoIterationTemplate({ evidenceTypeId: DESIGN_MOCKUP_EVIDENCE_TYPE_ID, answers, decisionAction: "archive" }).valid).toBe(true);
  });

  it("4. final design = Yes disables the preset", () => {
    const answers = earlierLogoIterationAnswers({ [DESIGN_MOCKUP_QUESTION_IDS.finalDesign]: { value: "Yes", confidence: "high" } });
    expect(validateEarlierLogoIterationTemplate({ evidenceTypeId: DESIGN_MOCKUP_EVIDENCE_TYPE_ID, answers, decisionAction: "archive" }).valid).toBe(false);
  });

  it("5. released publicly = Yes disables the preset", () => {
    const answers = earlierLogoIterationAnswers({ [DESIGN_MOCKUP_QUESTION_IDS.publiclyReleased]: { value: "Yes", confidence: "high" } });
    expect(validateEarlierLogoIterationTemplate({ evidenceTypeId: DESIGN_MOCKUP_EVIDENCE_TYPE_ID, answers, decisionAction: "archive" }).valid).toBe(false);
  });

  it("led-to-final = No disables the preset (that's the unused-design preset's territory)", () => {
    const answers = earlierLogoIterationAnswers({ [DESIGN_MOCKUP_QUESTION_IDS.relatedFinalLogo]: { value: "No", confidence: "high" } });
    const result = validateEarlierLogoIterationTemplate({ evidenceTypeId: DESIGN_MOCKUP_EVIDENCE_TYPE_ID, answers, decisionAction: "archive" });
    expect(result.valid).toBe(false);
    expect(result.reasonCode).toBe("INVALID_EARLIER_LOGO_ITERATION_TEMPLATE");
  });

  it("2. the existing unused-design preset (led-to-final = No) still validates independently", () => {
    const unusedAnswers = {
      [DESIGN_MOCKUP_QUESTION_IDS.internalConcept]: { value: "Yes", confidence: "high" as const },
      [DESIGN_MOCKUP_QUESTION_IDS.finalDesign]: { value: "No", confidence: "high" as const },
      [DESIGN_MOCKUP_QUESTION_IDS.creator]: { value: "Someone", confidence: "high" as const },
      [DESIGN_MOCKUP_QUESTION_IDS.publiclyReleased]: { value: "No", confidence: "high" as const },
      [DESIGN_MOCKUP_QUESTION_IDS.relatedPsd]: { value: "No", confidence: "high" as const },
      [DESIGN_MOCKUP_QUESTION_IDS.relatedFinalLogo]: { value: "No", confidence: "high" as const },
    };
    expect(validateDesignMockupTemplate({ evidenceTypeId: DESIGN_MOCKUP_EVIDENCE_TYPE_ID, answers: unusedAnswers, decisionAction: "archive" }).valid).toBe(true);
    // The two are mutually exclusive: the same answers never validate against the other preset.
    expect(validateEarlierLogoIterationTemplate({ evidenceTypeId: DESIGN_MOCKUP_EVIDENCE_TYPE_ID, answers: unusedAnswers, decisionAction: "archive" }).valid).toBe(false);
  });

  it("missing source-file (relatedPsd) answer disables the preset", () => {
    const answers = earlierLogoIterationAnswers();
    delete answers[DESIGN_MOCKUP_QUESTION_IDS.relatedPsd];
    expect(validateEarlierLogoIterationTemplate({ evidenceTypeId: DESIGN_MOCKUP_EVIDENCE_TYPE_ID, answers, decisionAction: "archive" }).valid).toBe(false);
  });
});

const earlierLogoIterationSource: ArchiveSimilarSourceInput = {
  id: "eli-source-1",
  originalPath: "Design Mockups/Logo History/logo_v1.png",
  evidenceTypeId: DESIGN_MOCKUP_EVIDENCE_TYPE_ID,
};

function earlierLogoIterationCandidate(overrides: Partial<ArchiveSimilarCandidateInput> = {}): ArchiveSimilarCandidateInput {
  return {
    id: "eli-candidate-1",
    originalPath: "Design Mockups/Logo History/logo_v2.png",
    extension: "png",
    reviewStatus: "unreviewed",
    inclusionDecision: null,
    evidenceTypeId: null,
    connectionTypes: [],
    connections: [],
    filesystemModifiedAt: "2023-05-01T12:00:00.000Z",
    existingCreatorAnswer: null,
    ...overrides,
  };
}

describe("getEarlierLogoIterationArchiveSimilarEligibility", () => {
  const answers = earlierLogoIterationAnswers();

  it("qualifies a same-folder unreviewed Design Mockup image with a valid date and no existing creator answer", () => {
    const c = earlierLogoIterationCandidate();
    expect(getEarlierLogoIterationArchiveSimilarEligibility(c, earlierLogoIterationSource, answers)).toEqual({ eligible: true, reasonCode: null, reasonLabel: null });
  });

  it("6. an Included file is excluded", () => {
    const c = earlierLogoIterationCandidate({ reviewStatus: "reviewed", inclusionDecision: "include" });
    expect(getEarlierLogoIterationArchiveSimilarEligibility(c, earlierLogoIterationSource, answers).reasonCode).toBe("ALREADY_INCLUDED");
  });

  it("6. a Needs Follow-Up file is excluded", () => {
    const c = earlierLogoIterationCandidate({ reviewStatus: "needs_follow_up" });
    expect(getEarlierLogoIterationArchiveSimilarEligibility(c, earlierLogoIterationSource, answers).reasonCode).toBe("NEEDS_FOLLOW_UP");
  });

  it("10. a candidate with an existing non-blank creator answer is excluded as CONFLICTING_REVIEW", () => {
    const c = earlierLogoIterationCandidate({ existingCreatorAnswer: "A Different Person" });
    expect(getEarlierLogoIterationArchiveSimilarEligibility(c, earlierLogoIterationSource, answers).reasonCode).toBe("CONFLICTING_REVIEW");
  });

  it("a blank/whitespace-only existing creator answer does not block eligibility", () => {
    const c = earlierLogoIterationCandidate({ existingCreatorAnswer: "   " });
    expect(getEarlierLogoIterationArchiveSimilarEligibility(c, earlierLogoIterationSource, answers).eligible).toBe(true);
  });

  it("14. a missing filesystem date excludes the candidate", () => {
    const c = earlierLogoIterationCandidate({ filesystemModifiedAt: null });
    expect(getEarlierLogoIterationArchiveSimilarEligibility(c, earlierLogoIterationSource, answers).reasonCode).toBe("MISSING_FILESYSTEM_DATE");
  });

  it("14. an invalid filesystem date excludes the candidate", () => {
    const c = earlierLogoIterationCandidate({ filesystemModifiedAt: "not-a-date" });
    expect(getEarlierLogoIterationArchiveSimilarEligibility(c, earlierLogoIterationSource, answers).reasonCode).toBe("INVALID_FILESYSTEM_DATE");
  });

  it("17. a candidate with a real working-source-file connection is excluded when the copied answer says no working file exists", () => {
    const c = earlierLogoIterationCandidate({
      connections: [{ type: "source_design_to_export", direction: "incoming", otherItemEvidenceTypeId: "psd_source" }],
    });
    expect(getEarlierLogoIterationArchiveSimilarEligibility(c, earlierLogoIterationSource, answers).reasonCode).toBe("HAS_WORKING_SOURCE_FILE");
  });

  it("18. a connection showing the concept contributed to the final logo does NOT exclude it (case A)", () => {
    const c = earlierLogoIterationCandidate({
      connections: [{ type: "source_design_to_export", direction: "outgoing", otherItemEvidenceTypeId: "final_logo" }],
    });
    expect(getEarlierLogoIterationArchiveSimilarEligibility(c, earlierLogoIterationSource, answers).eligible).toBe(true);
  });

  it("19. a connection showing this file IS (a duplicate of) the exact adopted final logo excludes it (case B)", () => {
    const c = earlierLogoIterationCandidate({
      connections: [{ type: "duplicate_of", direction: "outgoing", otherItemEvidenceTypeId: "final_logo" }],
    });
    const result = getEarlierLogoIterationArchiveSimilarEligibility(c, earlierLogoIterationSource, answers);
    expect(result.reasonCode).toBe("IS_FINAL_ADOPTED_LOGO_FILE");
  });

  it("19b. duplicate_variant_of the final logo also excludes it", () => {
    const c = earlierLogoIterationCandidate({
      connections: [{ type: "duplicate_variant_of", direction: "incoming", otherItemEvidenceTypeId: "final_logo" }],
    });
    expect(getEarlierLogoIterationArchiveSimilarEligibility(c, earlierLogoIterationSource, answers).reasonCode).toBe("IS_FINAL_ADOPTED_LOGO_FILE");
  });

  it("20. a public/commercial-use connection excludes the file", () => {
    const c1 = earlierLogoIterationCandidate({ connections: [{ type: "supports_commercial_use", direction: "outgoing", otherItemEvidenceTypeId: null }] });
    expect(getEarlierLogoIterationArchiveSimilarEligibility(c1, earlierLogoIterationSource, answers).reasonCode).toBe("CONNECTED_TO_COMMERCIAL_USE");
    const c2 = earlierLogoIterationCandidate({ connections: [{ type: "product_to_social_post", direction: "outgoing", otherItemEvidenceTypeId: null }] });
    expect(getEarlierLogoIterationArchiveSimilarEligibility(c2, earlierLogoIterationSource, answers).reasonCode).toBe("CONNECTED_TO_PUBLIC_RELEASE");
  });

  it("a connection to a real product excludes the file", () => {
    const c = earlierLogoIterationCandidate({ connections: [{ type: "export_to_product", direction: "outgoing", otherItemEvidenceTypeId: "product_photo" }] });
    expect(getEarlierLogoIterationArchiveSimilarEligibility(c, earlierLogoIterationSource, answers).reasonCode).toBe("CONNECTED_TO_REAL_PRODUCT");
  });
});

describe("getEarlierLogoIterationProtectedConnection", () => {
  it("checks the final-adopted-logo-file rule before delegating to the shared Design Mockup policy", () => {
    const connections: ArchiveSimilarConnectionInfo[] = [{ type: "duplicate_of", direction: "outgoing", otherItemEvidenceTypeId: "final_logo" }];
    expect(getEarlierLogoIterationProtectedConnection(connections, earlierLogoIterationAnswers())?.reasonCode).toBe("IS_FINAL_ADOPTED_LOGO_FILE");
  });

  it("a non-duplicate connection to a final_logo item is not protected by the final-adopted-file rule (falls through to the shared policy, where relatedFinalLogo=Yes means CONNECTED_TO_FINAL_LOGO never fires either)", () => {
    const connections: ArchiveSimilarConnectionInfo[] = [{ type: "source_design_to_export", direction: "outgoing", otherItemEvidenceTypeId: "final_logo" }];
    expect(getEarlierLogoIterationProtectedConnection(connections, earlierLogoIterationAnswers())).toBeNull();
  });
});
