import { describe, expect, it } from "vitest";
import { deriveEvidenceItemId } from "../evidenceItemId.js";

describe("deriveEvidenceItemId", () => {
  it("is deterministic for the same workspace + path", () => {
    const id1 = deriveEvidenceItemId(1, "Proof Files/proof.pdf");
    const id2 = deriveEvidenceItemId(1, "Proof Files/proof.pdf");
    expect(id1).toBe(id2);
  });

  it("differs by workspace", () => {
    const id1 = deriveEvidenceItemId(1, "photo.jpg");
    const id2 = deriveEvidenceItemId(2, "photo.jpg");
    expect(id1).not.toBe(id2);
  });

  it("differs by path", () => {
    const id1 = deriveEvidenceItemId(1, "a.jpg");
    const id2 = deriveEvidenceItemId(1, "b.jpg");
    expect(id1).not.toBe(id2);
  });

  it("does not depend on file content (stable across rescans of edited-in-place files)", () => {
    // Same id regardless of what the file's bytes are — identity is
    // path-based, not content-based, so review data stays attached.
    const id1 = deriveEvidenceItemId(1, "logo.psd");
    const id2 = deriveEvidenceItemId(1, "logo.psd");
    expect(id1).toBe(id2);
  });
});
