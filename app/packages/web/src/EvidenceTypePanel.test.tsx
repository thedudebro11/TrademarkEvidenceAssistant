import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EvidenceTypePanel } from "./EvidenceTypePanel.js";
import type { EvidenceItemDetail } from "@trademark-evidence-assistant/shared";

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

const baseItem: EvidenceItemDetail = {
  id: "item-1",
  originalPath: "Design Files/logo_edit.jpg",
  originalFilename: "logo_edit.jpg",
  extension: "jpg",
  mimeType: "image/jpeg",
  fileSize: 100,
  sha256: "abc",
  discoveredAt: "2026-01-01T00:00:00.000Z",
  fsCreatedAt: null,
  fsModifiedAt: null,
  missingSince: null,
  reviewStatus: "unreviewed",
  inclusionDecision: null,
  notes: null,
  notesUpdatedAt: null,
  decidedAt: null,
  metadata: null,
  duplicates: [],
  fileRole: null,
  answers: [],
  connections: [],
  usefulness: { computed: { score: 0, band: "Undetermined", positiveFactors: [], missingElements: [] }, override: null, effective: { score: 0, band: "Undetermined", positiveFactors: [], missingElements: [] } },
  evidenceType: null,
  evidenceTypeSuggestion: {
    typeId: "design_mockup",
    confidence: "high",
    reasons: ['Filename contains "edit"', "Referenced from a Design folder"],
  },
  noRelatedEvidence: false,
};

describe("EvidenceTypePanel (controlled by the parent Review Draft)", () => {
  it("shows the suggested type with its confidence and reasons, unconfirmed", () => {
    render(<EvidenceTypePanel item={baseItem} draftEvidenceType={null} draftAnswers={{}} onConfirmType={() => {}} onAnswerChange={() => {}} />);
    expect(screen.getByText("Design Mockup", { selector: "strong" })).toBeTruthy();
    expect(screen.getByText(/high confidence/)).toBeTruthy();
    expect(screen.getByText('Filename contains "edit"')).toBeTruthy();
  });

  it("confirming the suggestion calls onConfirmType with source 'suggested' — no network call, purely a callback", () => {
    const onConfirmType = vi.fn();
    render(<EvidenceTypePanel item={baseItem} draftEvidenceType={null} draftAnswers={{}} onConfirmType={onConfirmType} onAnswerChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(onConfirmType).toHaveBeenCalledWith("design_mockup", "suggested", "high", 'Filename contains "edit"; Referenced from a Design folder');
  });

  it("picking a different type manually calls onConfirmType with source 'user'", () => {
    const onConfirmType = vi.fn();
    render(<EvidenceTypePanel item={baseItem} draftEvidenceType={null} draftAnswers={{}} onConfirmType={onConfirmType} onAnswerChange={() => {}} />);
    fireEvent.change(screen.getByLabelText(/Or choose the evidence type directly/), { target: { value: "final_logo" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm Evidence Type" }));
    expect(onConfirmType).toHaveBeenCalledWith("final_logo", "user", null, null);
  });

  it("once a type is confirmed in the draft (not yet saved to the server), renders that type's interview instead of the suggestion", () => {
    render(
      <EvidenceTypePanel
        item={baseItem}
        draftEvidenceType={{ typeId: "final_logo", source: "user", confidence: null, reason: null }}
        draftAnswers={{}}
        onConfirmType={() => {}}
        onAnswerChange={() => {}}
      />,
    );
    expect(screen.getByText("Final Logo")).toBeTruthy();
    expect(screen.getByText("Is this your official, adopted logo?")).toBeTruthy();
    expect(screen.queryByText(/We think this is a/)).toBeNull();
  });

  it("every keystroke in an interview answer calls onAnswerChange directly — no debounce, no network call", () => {
    const onAnswerChange = vi.fn();
    render(
      <EvidenceTypePanel
        item={baseItem}
        draftEvidenceType={{ typeId: "final_logo", source: "user", confidence: null, reason: null }}
        draftAnswers={{}}
        onConfirmType={() => {}}
        onAnswerChange={onAnswerChange}
      />,
    );
    fireEvent.change(screen.getByLabelText("Is this your official, adopted logo?"), { target: { value: "yes" } });
    expect(onAnswerChange).toHaveBeenCalledWith("final_logo_official", { value: "yes" });
  });

  it("an existing persisted answer (from item.answers) populates the row when the draft has no edit for it yet", () => {
    const itemWithAnswer: EvidenceItemDetail = {
      ...baseItem,
      answers: [{ questionId: "final_logo_official", value: "yes", source: "user", confidence: "high", note: "checked", answeredAt: "2026-01-01T00:00:00.000Z" }],
    };
    render(
      <EvidenceTypePanel
        item={itemWithAnswer}
        draftEvidenceType={{ typeId: "final_logo", source: "user", confidence: null, reason: null }}
        draftAnswers={{}}
        onConfirmType={() => {}}
        onAnswerChange={() => {}}
      />,
    );
    expect((screen.getByLabelText("Is this your official, adopted logo?") as HTMLInputElement).value).toBe("yes");
  });

  it("a draft edit takes precedence over the persisted answer for the same question", () => {
    const itemWithAnswer: EvidenceItemDetail = {
      ...baseItem,
      answers: [{ questionId: "final_logo_official", value: "yes", source: "user", confidence: null, note: null, answeredAt: "2026-01-01T00:00:00.000Z" }],
    };
    render(
      <EvidenceTypePanel
        item={itemWithAnswer}
        draftEvidenceType={{ typeId: "final_logo", source: "user", confidence: null, reason: null }}
        draftAnswers={{ final_logo_official: { value: "no", confidence: null, note: null } }}
        onConfirmType={() => {}}
        onAnswerChange={() => {}}
      />,
    );
    expect((screen.getByLabelText("Is this your official, adopted logo?") as HTMLInputElement).value).toBe("no");
  });
});

describe("EvidenceTypePanel — Extract Text (OCR-assisted interview fields)", () => {
  const printfulInvoiceItem: EvidenceItemDetail = {
    ...baseItem,
    extension: "jpg",
    mimeType: "image/jpeg",
  };
  const draftType = { typeId: "printful_invoice", source: "user" as const, confidence: null, reason: null };

  it("shows the Extract Text button for an image item with a confirmed type", () => {
    render(
      <EvidenceTypePanel item={printfulInvoiceItem} draftEvidenceType={draftType} draftAnswers={{}} onConfirmType={() => {}} onAnswerChange={() => {}} />,
    );
    expect(screen.getByRole("button", { name: "Extract Text From This Image" })).toBeTruthy();
  });

  it("does not show the button for a non-image evidence type (e.g. a PDF)", () => {
    const pdfItem: EvidenceItemDetail = { ...printfulInvoiceItem, extension: "pdf", mimeType: "application/pdf" };
    render(<EvidenceTypePanel item={pdfItem} draftEvidenceType={draftType} draftAnswers={{}} onConfirmType={() => {}} onAnswerChange={() => {}} />);
    expect(screen.queryByRole("button", { name: "Extract Text From This Image" })).toBeNull();
  });

  it("clicking Extract Text fetches the OCR endpoint for this item and shows a loading state, then the result", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ rawText: "Order #PF116824539 Feb 20, 2025", dateCandidates: ["Feb 20, 2025"], orderNumberCandidates: ["#PF116824539"] }),
      }),
    );
    render(
      <EvidenceTypePanel item={printfulInvoiceItem} draftEvidenceType={draftType} draftAnswers={{}} onConfirmType={() => {}} onAnswerChange={() => {}} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Extract Text From This Image" }));
    expect(screen.getByText(/Reading text from the image/)).toBeTruthy();

    await waitFor(() => expect(screen.getByText(/Extracted 1 date and 1 order number/)).toBeTruthy());
    expect(fetch).toHaveBeenCalledWith("/api/evidence-items/item-1/ocr");
  });

  it("shows a 'Fill from image' option only next to interview questions that look date/order-number related, and clicking one fills that exact question via onAnswerChange", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ rawText: "x", dateCandidates: ["Feb 20, 2025"], orderNumberCandidates: ["#PF116824539"] }),
      }),
    );
    const onAnswerChange = vi.fn();
    render(
      <EvidenceTypePanel
        item={printfulInvoiceItem}
        draftEvidenceType={draftType}
        draftAnswers={{}}
        onConfirmType={() => {}}
        onAnswerChange={onAnswerChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Extract Text From This Image" }));
    await waitFor(() => expect(screen.getByText(/Extracted 1 date/)).toBeTruthy());

    // The order-number question gets the extracted candidate as a fill option.
    fireEvent.click(screen.getByRole("button", { name: "#PF116824539" }));
    expect(onAnswerChange).toHaveBeenCalledWith("printful_invoice_order_number", { value: "#PF116824539" });

    // The products question has nothing date/order-shaped in its id or text — no fill chip offered.
    const productsRow = screen.getByText("What products are listed on this invoice?").closest("li")!;
    expect(productsRow.textContent).not.toContain("Fill from image");
  });

  it("nothing is ever filled in automatically — the answer only changes on an explicit click", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ rawText: "x", dateCandidates: ["Feb 20, 2025"], orderNumberCandidates: [] }),
      }),
    );
    const onAnswerChange = vi.fn();
    render(
      <EvidenceTypePanel
        item={printfulInvoiceItem}
        draftEvidenceType={draftType}
        draftAnswers={{}}
        onConfirmType={() => {}}
        onAnswerChange={onAnswerChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Extract Text From This Image" }));
    await waitFor(() => expect(screen.getByText(/Extracted 1 date/)).toBeTruthy());
    expect(onAnswerChange).not.toHaveBeenCalled();
  });

  it("shows an error message, not a crash, when extraction fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: "Text extraction only supports image files" }) }),
    );
    render(
      <EvidenceTypePanel item={printfulInvoiceItem} draftEvidenceType={draftType} draftAnswers={{}} onConfirmType={() => {}} onAnswerChange={() => {}} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Extract Text From This Image" }));
    await waitFor(() => expect(screen.getByText(/Could not extract text/)).toBeTruthy());
  });
});
