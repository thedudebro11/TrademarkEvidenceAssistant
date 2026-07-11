import { describe, expect, it } from "vitest";
import { DISCLAIMER, findForbiddenLanguage, generateBinder } from "../binderEngine.js";
import { toExhibitCsv, toHtml, toJson, toMarkdown } from "../binderFormatters.js";
import type { BinderItemInput } from "../binderEngine.js";

function item(overrides: Partial<BinderItemInput> = {}): BinderItemInput {
  return {
    exportRelativePath: "05_PRODUCTS_AND_DESIGNS/Product_Photos/product_photo.jpg",
    originalFilename: "product_photo.jpg",
    fileRole: "product_photo",
    whatIsThisAnswer: "A photo of the shirt for sale.",
    realWorldDateAnswer: "September 2024, per the order confirmation",
    publiclyPostedAnswer: "",
    fsModifiedAt: "2024-09-20T00:00:00.000Z",
    usefulnessBand: "Strong",
    usefulnessScore: 80,
    reviewStatus: "reviewed",
    connectionTypes: [],
    sha256: "abc123",
    ...overrides,
  };
}

describe("findForbiddenLanguage", () => {
  it("detects each forbidden phrase", () => {
    expect(findForbiddenLanguage("this proves ownership of the mark")).toContain("proves ownership");
    expect(findForbiddenLanguage("this is conclusive evidence")).toContain("conclusive");
    expect(findForbiddenLanguage("USPTO approved this filing")).toContain("uspto approved");
  });

  it("returns an empty array for factual language", () => {
    expect(findForbiddenLanguage("this photo appears to show the mark and is connected to a sale")).toEqual([]);
  });

  it("the disclaimer itself contains no forbidden language", () => {
    expect(findForbiddenLanguage(DISCLAIMER)).toEqual([]);
  });
});

describe("generateBinder", () => {
  it("produces one exhibit per item, numbered sequentially and cited consistently", () => {
    const doc = generateBinder("Fatletic", [item(), item({ originalFilename: "logo.psd", fileRole: "logo_source" })], 0, 0);
    expect(doc.exhibits).toHaveLength(2);
    expect(doc.exhibits[0].exhibitNumber).toBe(1);
    expect(doc.exhibits[1].exhibitNumber).toBe(2);
    expect(doc.hashIndex).toHaveLength(2);
    expect(doc.hashIndex[0].exhibitRef).toBe("Exhibit 1");
  });

  it("cites the earliest user-documented date, not just the first item in the list", () => {
    const doc = generateBinder(
      "Fatletic",
      [item({ originalFilename: "later.jpg", realWorldDateAnswer: "2025-01-01" }), item({ originalFilename: "earlier.jpg", realWorldDateAnswer: "2024-01-01" })],
      0,
      0,
    );
    expect(doc.earliestEvidence[0]).toContain("earlier.jpg");
  });

  it("reports 'undetermined' honestly when no item has a user-documented date", () => {
    const doc = generateBinder("Fatletic", [item({ realWorldDateAnswer: "" })], 0, 0);
    expect(doc.earliestEvidence[0]).toContain("undetermined");
  });

  it("labels filesystem-only dates as such, never as proof of the event date", () => {
    const doc = generateBinder("Fatletic", [item({ realWorldDateAnswer: "" })], 0, 0);
    expect(doc.timeline[0].statement).toContain("not proof of the real-world event date");
  });

  it("flags items missing a date or role in the gaps section", () => {
    const doc = generateBinder("Fatletic", [item({ realWorldDateAnswer: "", fileRole: null })], 0, 0);
    expect(doc.gaps[0]).toContain("documented real-world date");
    expect(doc.gaps[0]).toContain("assigned file role");
  });

  it("reports follow-up count honestly, including zero", () => {
    const zero = generateBinder("Fatletic", [item()], 0, 0);
    expect(zero.followUp[0]).toContain("No items are currently marked Needs Follow-Up");
    const some = generateBinder("Fatletic", [item()], 3, 0);
    expect(some.followUp[0]).toContain("3 evidence item");
  });

  it("identifies continuous-use support only from an actual connection, never inferred", () => {
    const withConnection = generateBinder("Fatletic", [item({ connectionTypes: ["supports_continuous_use"] })], 0, 0);
    expect(withConnection.continuousUse[0]).toContain("supports continuous use");
    const without = generateBinder("Fatletic", [item()], 0, 0);
    expect(without.continuousUse[0]).toContain("No items");
  });

  it("contains no forbidden language across every section, for a realistic mixed binder", () => {
    const doc = generateBinder(
      "Fatletic",
      [
        item(),
        item({ originalFilename: "customer.jpg", fileRole: "customer_photo", realWorldDateAnswer: "" }),
        item({ originalFilename: "post.png", fileRole: "social_post_export", publiclyPostedAnswer: "yes" }),
        item({ originalFilename: "undated.jpg", realWorldDateAnswer: "", fsModifiedAt: null, fileRole: null }),
      ],
      2,
      5,
    );
    const allText = JSON.stringify(doc);
    expect(findForbiddenLanguage(allText)).toEqual([]);
  });
});

describe("output formatters contain no forbidden language and cite exhibits", () => {
  const doc = generateBinder(
    "Fatletic",
    [item(), item({ originalFilename: "customer.jpg", fileRole: "customer_photo" })],
    1,
    2,
  );

  it("Markdown", () => {
    const md = toMarkdown(doc);
    expect(findForbiddenLanguage(md)).toEqual([]);
    expect(md).toContain("Exhibit 1");
    expect(md).toContain(doc.disclaimer);
  });

  it("HTML", () => {
    const html = toHtml(doc);
    expect(findForbiddenLanguage(html)).toEqual([]);
    expect(html).toContain("<html>");
    expect(html).toContain("Exhibit 1");
  });

  it("JSON round-trips the exhibit count and contains no forbidden language", () => {
    const json = toJson(doc);
    expect(findForbiddenLanguage(json)).toEqual([]);
    expect(JSON.parse(json).exhibits).toHaveLength(2);
  });

  it("CSV has one data row per exhibit plus a header, and no forbidden language", () => {
    const csv = toExhibitCsv(doc);
    expect(findForbiddenLanguage(csv)).toEqual([]);
    const lines = csv.trim().split("\n");
    expect(lines).toHaveLength(3); // header + 2 exhibits
    expect(lines[0]).toContain("SHA-256");
  });

  it("CSV escapes a description containing a comma", () => {
    const withComma = generateBinder("Fatletic", [item({ whatIsThisAnswer: "A photo, taken at the event" })], 0, 0);
    const csv = toExhibitCsv(withComma);
    expect(csv).toContain('"A photo, taken at the event"');
  });
});
