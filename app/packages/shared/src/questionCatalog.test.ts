import { describe, expect, it } from "vitest";
import { getQuestionsForRole } from "./questionCatalog.js";

describe("getQuestionsForRole", () => {
  it("returns only universal questions when no role is assigned", () => {
    const questions = getQuestionsForRole(null);
    expect(questions).toHaveLength(7);
    expect(questions.every((q) => q.id.startsWith("universal_"))).toBe(true);
  });

  it("adds image questions for an image-category role", () => {
    const questions = getQuestionsForRole("product_photo");
    expect(questions.filter((q) => q.id.startsWith("universal_"))).toHaveLength(7);
    expect(questions.filter((q) => q.id.startsWith("image_"))).toHaveLength(7);
  });

  it("adds invoice/order questions for printful_invoice", () => {
    const questions = getQuestionsForRole("printful_invoice");
    expect(questions.some((q) => q.id === "invoice_order_number")).toBe(true);
  });

  it("adds invoice/order questions for print_vendor_proof (Phase 0 decision 5)", () => {
    const questions = getQuestionsForRole("print_vendor_proof");
    expect(questions.some((q) => q.id === "invoice_order_number")).toBe(true);
  });

  it("adds design-file questions for logo_source", () => {
    const questions = getQuestionsForRole("logo_source");
    expect(questions.some((q) => q.id === "design_printed_or_sold")).toBe(true);
  });

  it("adds video questions for video", () => {
    const questions = getQuestionsForRole("video");
    expect(questions.some((q) => q.id === "video_timestamps")).toBe(true);
  });

  it("falls back to universal-only for roles with no defined category (spec 06 doesn't cover them)", () => {
    const questions = getQuestionsForRole("message");
    expect(questions).toHaveLength(7);
  });

  it("never includes a duplicate 'include in trademark package' question (already covered by Phase 3 decision buttons)", () => {
    const allRoles = getQuestionsForRole("product_photo");
    expect(allRoles.some((q) => q.text.toLowerCase().includes("include in trademark package"))).toBe(false);
  });

  it("has no duplicate question ids within any single role's set", () => {
    const questions = getQuestionsForRole("product_photo");
    const ids = questions.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
