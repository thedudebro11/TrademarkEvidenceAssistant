import { describe, expect, it } from "vitest";
import {
  EVIDENCE_TYPE_REGISTRY,
  EVIDENCE_TYPE_REGISTRY_META,
  EVIDENCE_TYPE_CATEGORIES,
  getActiveEvidenceTypes,
  getEvidenceType,
  getEvidenceTypesByCategory,
  getInterviewForType,
  suggestEvidenceType,
} from "./evidenceTypeRegistry.js";

describe("evidence type registry integrity", () => {
  it("has no duplicate ids", () => {
    const ids = EVIDENCE_TYPE_REGISTRY.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every type belongs to a known category", () => {
    for (const type of EVIDENCE_TYPE_REGISTRY) {
      expect(EVIDENCE_TYPE_CATEGORIES).toContain(type.category);
    }
  });

  it("every type has at least one interview question", () => {
    for (const type of EVIDENCE_TYPE_REGISTRY) {
      expect(type.interview.length).toBeGreaterThan(0);
    }
  });

  it("every interview question has a non-empty text and reason", () => {
    for (const type of EVIDENCE_TYPE_REGISTRY) {
      for (const question of type.interview) {
        expect(question.text.trim().length).toBeGreaterThan(0);
        expect(question.reason.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("suggestedConnections only reference real registry ids", () => {
    const ids = new Set(EVIDENCE_TYPE_REGISTRY.map((t) => t.id));
    for (const type of EVIDENCE_TYPE_REGISTRY) {
      for (const targetId of type.suggestedConnections) {
        expect(ids.has(targetId)).toBe(true);
      }
    }
  });

  it("carries registry-level version metadata", () => {
    expect(EVIDENCE_TYPE_REGISTRY_META.version).toBe("1.0");
    expect(EVIDENCE_TYPE_REGISTRY_META.migrationNotes.length).toBeGreaterThan(0);
  });

  it("no type is deprecated in this first version", () => {
    expect(getActiveEvidenceTypes().length).toBe(EVIDENCE_TYPE_REGISTRY.length);
  });

  it("getEvidenceType returns null for an unknown id", () => {
    expect(getEvidenceType("not_a_real_type")).toBeNull();
  });

  it("getEvidenceTypesByCategory filters correctly", () => {
    const design = getEvidenceTypesByCategory("design");
    expect(design.length).toBeGreaterThan(0);
    expect(design.every((t) => t.category === "design")).toBe(true);
  });

  it("getInterviewForType returns an empty array for an unknown id, not a throw", () => {
    expect(getInterviewForType("not_a_real_type")).toEqual([]);
  });
});

describe("suggestEvidenceType (deterministic suggestion engine)", () => {
  it("suggests design_mockup for an edited image located beside PSD files, with matching reasons", () => {
    const result = suggestEvidenceType({
      filename: "logo_edit_v2.jpg",
      extension: "jpg",
      folderPath: "Design Files",
      width: 1200,
      height: 800,
      siblingExtensions: ["psd", "psd", "jpg"],
    });

    expect(result.typeId).toBe("design_mockup");
    expect(result.confidence).toBe("high");
    expect(result.reasons).toContain('Filename contains "edit"');
    expect(result.reasons).toContain("Located beside PSD files");
    expect(result.reasons).toContain("Referenced from a Design folder");
  });

  it("suggests psd_source purely from the .psd extension", () => {
    const result = suggestEvidenceType({
      filename: "brand_v1.psd",
      extension: "psd",
      folderPath: "Design Files",
      width: null,
      height: null,
      siblingExtensions: [],
    });
    expect(result.typeId).toBe("psd_source");
  });

  it("suggests printful_invoice for a PDF whose filename names both printful and invoice", () => {
    const result = suggestEvidenceType({
      filename: "printful_invoice_44821.pdf",
      extension: "pdf",
      folderPath: "Proof Files",
      width: null,
      height: null,
      siblingExtensions: [],
    });
    expect(result.typeId).toBe("printful_invoice");
  });

  it("falls back to miscellaneous with low confidence and an explanatory reason when nothing matches", () => {
    const result = suggestEvidenceType({
      filename: "IMG_00231498.dat",
      extension: "dat",
      folderPath: "",
      width: null,
      height: null,
      siblingExtensions: [],
    });
    expect(result.typeId).toBe("miscellaneous");
    expect(result.confidence).toBe("low");
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it("is deterministic — same input always produces the same output", () => {
    const input = {
      filename: "instagram_post_1.jpg",
      extension: "jpg",
      folderPath: "Extras (Images)",
      width: 1080,
      height: 1080,
      siblingExtensions: ["jpg", "jpg"],
    };
    const first = suggestEvidenceType(input);
    const second = suggestEvidenceType(input);
    expect(first).toEqual(second);
  });
});
