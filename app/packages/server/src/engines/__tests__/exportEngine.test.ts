import { describe, expect, it } from "vitest";
import { folderForRole, generateSafeFilename } from "../exportEngine.js";

describe("folderForRole", () => {
  it("maps commerce document roles into 02_PRINTFUL subfolders", () => {
    expect(folderForRole("printful_invoice", "")).toEqual(["02_PRINTFUL", "Invoices"]);
    expect(folderForRole("printful_order", "")).toEqual(["02_PRINTFUL", "Orders"]);
    expect(folderForRole("shipping_record", "")).toEqual(["02_PRINTFUL", "Shipments"]);
  });

  it("routes print_vendor_proof (Phase 0 decision 5) alongside orders", () => {
    expect(folderForRole("print_vendor_proof", "")).toEqual(["02_PRINTFUL", "Orders"]);
  });

  it("routes social posts to Instagram when the platform answer says so, else Other", () => {
    expect(folderForRole("social_post_export", "Posted to Instagram")).toEqual(["03_SOCIAL_MEDIA", "Instagram"]);
    expect(folderForRole("social_post_export", "Posted to Facebook")).toEqual(["03_SOCIAL_MEDIA", "Other"]);
    expect(folderForRole("social_post_export", "")).toEqual(["03_SOCIAL_MEDIA", "Other"]);
  });

  it("falls back to 08_SUPPORTING_DOCUMENTS for unknown/null roles", () => {
    expect(folderForRole(null, "")).toEqual(["08_SUPPORTING_DOCUMENTS"]);
    expect(folderForRole("unknown", "")).toEqual(["08_SUPPORTING_DOCUMENTS"]);
  });

  it("never assigns the same role to two different folders across calls (deterministic)", () => {
    expect(folderForRole("logo_source", "")).toEqual(folderForRole("logo_source", ""));
  });
});

describe("generateSafeFilename", () => {
  it("passes through an already-safe filename unchanged", () => {
    const used = new Set<string>();
    expect(generateSafeFilename("product_photo.jpg", used)).toBe("product_photo.jpg");
  });

  it("strips filesystem-unsafe characters", () => {
    const used = new Set<string>();
    expect(generateSafeFilename('bad:name?"<>|.jpg', used)).toBe("bad_name_____.jpg");
  });

  it("resolves a collision by appending a counter before the extension", () => {
    const used = new Set<string>(["photo.jpg"]);
    expect(generateSafeFilename("photo.jpg", used)).toBe("photo (2).jpg");
  });

  it("resolves multiple sequential collisions correctly", () => {
    const used = new Set<string>(["photo.jpg", "photo (2).jpg"]);
    expect(generateSafeFilename("photo.jpg", used)).toBe("photo (3).jpg");
  });

  it("mutates the provided used-names set so a caller iterating multiple files gets correct results", () => {
    const used = new Set<string>();
    const first = generateSafeFilename("a.jpg", used);
    const second = generateSafeFilename("a.jpg", used);
    expect(first).toBe("a.jpg");
    expect(second).toBe("a (2).jpg");
    expect(used.has("a.jpg")).toBe(true);
    expect(used.has("a (2).jpg")).toBe(true);
  });

  it("falls back to a placeholder name for an empty/entirely-unsafe filename", () => {
    const used = new Set<string>();
    expect(generateSafeFilename("", used)).toBe("unnamed_file");
  });
});
