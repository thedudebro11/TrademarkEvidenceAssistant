import { describe, expect, it } from "vitest";
import { runDeterministicAnalysis, type AnalysisEngineInput } from "../analysisEngine.js";

function baseInput(overrides: Partial<AnalysisEngineInput> = {}): AnalysisEngineInput {
  return {
    originalFilename: "file.jpg",
    originalPath: "Misc/file.jpg",
    folderPath: "Misc",
    extension: "jpg",
    siblingExtensions: [],
    width: null,
    height: null,
    exifDateTimeOriginal: null,
    exifCreateDate: null,
    filenameInferredDate: null,
    fsCreatedAt: null,
    fsModifiedAt: null,
    ocrText: null,
    ...overrides,
  };
}

describe("analysisEngine", () => {
  it("converts EXIF's colon-separated date to an ISO-shaped local string without any UTC/timezone shift", () => {
    const result = runDeterministicAnalysis(baseInput({ exifDateTimeOriginal: "2026:07:17 02:02:51" }));
    const exif = result.dates.find((d) => d.sourceType === "exif_date_time_original")!;
    expect(exif.normalizedValue).toBe("2026-07-17T02:02:51"); // exact same calendar date/time as the raw EXIF value — a textual reformat only
    expect(exif.timezoneStatus).toBe("unknown"); // EXIF has no timezone — never claimed as "known"
  });

  it("never fabricates a date assertion for a source that has no value", () => {
    const result = runDeterministicAnalysis(baseInput());
    expect(result.dates).toHaveLength(0); // no fallback to "today" or any synthesized value
  });

  it("labels fs_created and fs_modified with low confidence and an explicit 'never proof' explanation, distinct from EXIF", () => {
    const result = runDeterministicAnalysis(baseInput({ fsCreatedAt: "2026-01-01T00:00:00.000Z", fsModifiedAt: "2026-01-05T00:00:00.000Z", exifDateTimeOriginal: "2026:07:17 02:02:51" }));
    const fsCreated = result.dates.find((d) => d.sourceType === "fs_created")!;
    const fsModified = result.dates.find((d) => d.sourceType === "fs_modified")!;
    const exif = result.dates.find((d) => d.sourceType === "exif_date_time_original")!;
    expect(fsCreated.confidence).toBe("low");
    expect(fsModified.confidence).toBe("low");
    expect(exif.confidence).toBe("high");
    expect(fsCreated.rawValue).not.toBe(fsModified.rawValue); // never collapsed into one generic "evidence date"
  });

  it("extracts a visible order date only when it appears near an 'Order Date' keyword, not any date anywhere in the text", () => {
    const result = runDeterministicAnalysis(baseInput({ ocrText: "Some unrelated date: March 1, 2020. Order Date: April 2, 2026." }));
    const orderDates = result.dates.filter((d) => d.sourceType === "visible_order_date");
    expect(orderDates).toHaveLength(1);
    expect(orderDates[0].rawValue).toBe("April 2, 2026");
  });

  it("extracts the FATLETIC mark from OCR text at high confidence, and from filename-only at medium confidence", () => {
    const withOcr = runDeterministicAnalysis(baseInput({ ocrText: "FATLETIC Hoodie - Black" }));
    expect(withOcr.entities.find((e) => e.entityType === "fatletic_mark")?.confidence).toBe("high");

    const filenameOnly = runDeterministicAnalysis(baseInput({ originalFilename: "fatletic_photo.jpg" }));
    expect(filenameOnly.entities.find((e) => e.entityType === "fatletic_mark")?.confidence).toBe("medium");
  });

  it("caps every filename/folder-only evidence-type candidate below High confidence", () => {
    const result = runDeterministicAnalysis(
      baseInput({ originalFilename: "final_logo_edit.jpg", folderPath: "Design Files/Final", siblingExtensions: ["psd"], width: 100, height: 100 }),
    );
    expect(result.evidenceTypeCandidates.every((c) => c.confidence !== "high")).toBe(true);
  });

  it("an OCR-confirmed Printful order-detail page outranks and suppresses a filename/folder-based Design Mockup candidate", () => {
    const result = runDeterministicAnalysis(
      baseInput({
        originalFilename: "mockup_order.png",
        folderPath: "Design Files/Mockups",
        ocrText: "Order #PF445566778 Order Status: Fulfilled Shipping Address: 42 Wallaby Way",
      }),
    );
    expect(result.evidenceTypeCandidates[0].typeId).toBe("customer_order");
    expect(result.evidenceTypeCandidates[0].confidence).toBe("high");
    expect(result.evidenceTypeCandidates.some((c) => c.typeId === "design_mockup")).toBe(false);
  });

  describe("document-type precedence: customer_order vs shipping_confirmation vs invoice (Phase 2 fix)", () => {
    it("A. an order-detail page with order number, line items, shipping address, Delivered status, and a tracking number is primary customer_order — shipping_confirmation is only an alternative, and every identifier is still extracted", () => {
      const result = runDeterministicAnalysis(
        baseInput({
          originalFilename: "order.png",
          folderPath: "printful orders",
          ocrText:
            "Order #PF445566778 Order Status: Fulfilled Shipping Address: 42 Wallaby Way T-Shirt Black Size L $25.00 Delivered March 5, 2026 Tracking: 1Z999AA10123456784",
        }),
      );
      const [top, ...rest] = result.evidenceTypeCandidates;
      expect(top.typeId).toBe("customer_order");
      expect(top.confidence).toBe("high");
      expect(top.reasons.join(" ")).toContain("Primary document structure is a Printful order-detail page. Shipping and delivery information are statuses within that order record.");

      const shippingAlt = rest.find((c) => c.typeId === "shipping_confirmation");
      expect(shippingAlt).toBeTruthy();
      expect(shippingAlt!.confidence).toBe("medium"); // alternative, never tied with the primary

      expect(result.entities.some((e) => e.entityType === "order_number")).toBe(true);
      expect(result.entities.some((e) => e.entityType === "tracking_number")).toBe(true);
      expect(result.entities.some((e) => e.entityType === "order_status" && e.rawText === "Delivered")).toBe(true);
    });

    it("B. a standalone tracking/delivery notice with no order-detail structure is primary shipping_confirmation", () => {
      const result = runDeterministicAnalysis(
        baseInput({
          originalFilename: "notice.png",
          folderPath: "printful orders",
          ocrText: "Your package was Delivered on July 20, 2026. Carrier: UPS. Tracking: 1Z999AA10123456784",
        }),
      );
      expect(result.evidenceTypeCandidates[0].typeId).toBe("shipping_confirmation");
      expect(result.evidenceTypeCandidates[0].confidence).toBe("high");
      expect(result.evidenceTypeCandidates.some((c) => c.typeId === "customer_order")).toBe(false);
    });

    it("C. an explicit invoice heading with a total (and even delivery language) is primary the invoice type, never customer_order or shipping_confirmation", () => {
      const result = runDeterministicAnalysis(
        baseInput({
          originalFilename: "doc1.pdf",
          extension: "pdf",
          folderPath: "",
          ocrText: "Invoice #INV-2026-004 FATLETIC Hoodie x2 Total $89.00 Delivered July 18, 2026",
        }),
      );
      expect(result.evidenceTypeCandidates[0].typeId).toBe("printful_invoice");
      expect(result.evidenceTypeCandidates[0].confidence).toBe("high");
      expect(result.evidenceTypeCandidates.some((c) => c.typeId === "customer_order")).toBe(false);
      expect(result.evidenceTypeCandidates.some((c) => c.typeId === "shipping_confirmation")).toBe(false);
    });

    it("D. candidate ordering is guaranteed by an explicit confidence gap (high vs medium), not by which rule happens to run first or reasons.length — so it stays stable no matter how the internal rules are reordered later", () => {
      // Deliberately identical to test A's maximal-signal input: every
      // order-page signal AND every shipment/delivery signal present at
      // once, the exact case that used to tie at "high" and be decided
      // by source-code statement order.
      const result = runDeterministicAnalysis(
        baseInput({
          originalFilename: "order.png",
          folderPath: "printful orders",
          ocrText:
            "Order #PF700700700 Order Status: Fulfilled Shipping Address: 1 Main St Hoodie Black Size M $40.00 Shipped July 1, 2026 Shipment #SHP12345678",
        }),
      );
      const typeIds = result.evidenceTypeCandidates.map((c) => c.typeId);
      expect(typeIds[0]).toBe("customer_order");
      expect(typeIds).toContain("shipping_confirmation");
      const customerOrder = result.evidenceTypeCandidates.find((c) => c.typeId === "customer_order")!;
      const shippingConfirmation = result.evidenceTypeCandidates.find((c) => c.typeId === "shipping_confirmation")!;
      // The guarantee: these two are never equal, so the final sort's
      // confidence-first comparison alone fixes the order — nothing
      // about *when* each branch runs can change this result.
      expect(customerOrder.confidence).toBe("high");
      expect(shippingConfirmation.confidence).toBe("medium");
      expect(customerOrder.confidence).not.toBe(shippingConfirmation.confidence);
    });
  });

  it("a folder/filename-only 'product' vs 'mockup' signal still directionally distinguishes the two — a single weak signal like this is Low, per the confidence rubric ('folder alone')", () => {
    const productPhoto = runDeterministicAnalysis(baseInput({ originalFilename: "sticker_box.jpg", folderPath: "Product Photos" }));
    expect(productPhoto.evidenceTypeCandidates[0].typeId).toBe("product_photo");
    expect(productPhoto.evidenceTypeCandidates[0].confidence).toBe("low");

    const mockup = runDeterministicAnalysis(baseInput({ originalFilename: "hoodie_mockup.jpg", folderPath: "Mockups" }));
    expect(mockup.evidenceTypeCandidates[0].typeId).toBe("product_mockup");
  });

  it("generates an unresolved (never guessed) relationship-to-FATLETIC suggestion only when the top candidate is a customer/lifestyle/product photo type", () => {
    const customerPhoto = runDeterministicAnalysis(baseInput({ originalFilename: "customer.jpg", folderPath: "Customer Photos" }));
    const relationship = customerPhoto.answerSuggestions.find((a) => a.questionId === "customer_photo_relationship");
    expect(relationship?.unresolved).toBe(true);
    expect(relationship?.proposedValue).toBe("");

    const invoice = runDeterministicAnalysis(baseInput({ originalFilename: "invoice.pdf", extension: "pdf", ocrText: "Invoice #INV-100 Total $50.00" }));
    expect(invoice.answerSuggestions.find((a) => a.questionId === "customer_photo_relationship")).toBeUndefined();
  });
});
