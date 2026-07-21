import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ArchiveSimilarApplyResponse, ArchiveSimilarPreviewResponse, ArchiveSimilarReviewTemplate, ReviewDraftPayload } from "@trademark-evidence-assistant/shared";
import { ArchiveSimilarModal } from "./ArchiveSimilarModal.js";

const reviewTemplate: ArchiveSimilarReviewTemplate = {
  evidenceTypeId: "product_mockup",
  answers: {
    product_mockup_ever_produced: { value: "No", confidence: "high" },
    product_mockup_matching_record: { value: "No", confidence: "high" },
  },
  decisionAction: "archive",
};

const sourceItemPayload: ReviewDraftPayload = {
  evidenceType: { typeId: "product_mockup", source: "user", confidence: null, reason: null },
  interviewAnswers: {},
  connectionsToAdd: [],
  connectionIdsToRemove: [],
  noRelatedEvidence: false,
  usefulnessOverride: { action: "none", score: null, band: null, note: null },
  notes: "",
  decisionAction: "archive",
};

const previewResponse: ArchiveSimilarPreviewResponse = {
  presetId: "product_mockup",
  sourceItem: { itemId: "source-1", filename: "mockup_source.jpg", originalPath: "Mockups/Bag/mockup_source.jpg" },
  scope: { folderPath: "Mockups/Bag", evidenceTypeId: "product_mockup", mediaType: "image" },
  templateSummary: reviewTemplate,
  derivedField: null,
  eligible: [
    { itemId: "eligible-1", filename: "mockup_2.jpg", originalPath: "Mockups/Bag/mockup_2.jpg", reviewStatus: "unreviewed", evidenceTypeId: null },
    { itemId: "eligible-2", filename: "mockup_3.jpg", originalPath: "Mockups/Bag/mockup_3.jpg", reviewStatus: "unreviewed", evidenceTypeId: "product_mockup" },
  ],
  excluded: [{ itemId: "excluded-1", filename: "invoice.pdf", reasonCode: "UNSUPPORTED_MEDIA_TYPE", reasonLabel: "Not a supported image file" }],
  eligibleCount: 2,
  excludedCount: 1,
  previewToken: "token-1",
};

function mockFetch(overrides: { apply?: (body: unknown) => unknown } = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes("/archive-similar/preview")) {
        return Promise.resolve({ ok: true, status: 200, json: async () => previewResponse });
      }
      if (url.includes("/archive-similar/apply")) {
        const body = overrides.apply
          ? overrides.apply(JSON.parse(String(init?.body)))
          : { operationId: 1, requestedCount: 2, appliedCount: 2, skippedCount: 0, failedCount: 0, skipped: [], status: "completed" };
        return Promise.resolve({ ok: true, status: 200, json: async () => body });
      }
      throw new Error(`Unmocked fetch: ${url}`);
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

async function renderModal(props: Partial<React.ComponentProps<typeof ArchiveSimilarModal>> = {}) {
  const onApplied = props.onApplied ?? vi.fn();
  const onClose = props.onClose ?? vi.fn();
  const utils = render(
    <ArchiveSimilarModal
      open
      sourceItemId="source-1"
      reviewTemplate={reviewTemplate}
      sourceItemPayload={sourceItemPayload}
      onClose={onClose}
      onApplied={onApplied}
      {...props}
    />,
  );
  await waitFor(() => expect(screen.getByText("mockup_2.jpg")).toBeTruthy());
  return { ...utils, onApplied, onClose };
}

describe("ArchiveSimilarModal — 69/70/71. availability, template display, and counts", () => {
  it("renders nothing when closed", () => {
    mockFetch();
    render(<ArchiveSimilarModal open={false} sourceItemId="source-1" reviewTemplate={reviewTemplate} sourceItemPayload={sourceItemPayload} onClose={() => {}} onApplied={() => {}} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("displays the exact template values, eligible count, and excluded count", async () => {
    mockFetch();
    await renderModal();
    expect(screen.getByRole("dialog", { name: "Archive Similar Product Mockups" })).toBeTruthy();
    // Both answers render as "No — high confidence" — one <dd> each.
    expect(screen.getAllByText(/No — high confidence/)).toHaveLength(2);
    expect(screen.getByText("Excluded / not evidence of commercial use")).toBeTruthy();

    const summary = screen.getByText("Review to apply").closest("section") as HTMLElement;
    expect(within(summary).getByText("2")).toBeTruthy();
    expect(within(summary).getByText("1")).toBeTruthy();
  });
});

describe("ArchiveSimilarModal — 72/73/74. selection", () => {
  it("defaults every eligible file to selected, and excluded files are never selectable", async () => {
    mockFetch();
    await renderModal();
    const list = screen.getByRole("group", { name: "Select files to archive" });
    const checkboxes = within(list).getAllByRole("checkbox") as HTMLInputElement[];
    expect(checkboxes.every((c) => c.checked)).toBe(true);
    expect(within(list).queryByText("invoice.pdf")).toBeNull(); // never rendered inside the selectable list
    // The excluded file only exists inside the collapsed <details> — jsdom
    // keeps closed <details> content in the DOM (unlike real hidden
    // content), so its presence isn't itself proof of visibility; a closed
    // <details> is the actual "not selectable/not shown" signal here.
    const excludedDetails = document.querySelector("details.archive-similar-modal__excluded") as HTMLDetailsElement;
    expect(excludedDetails.open).toBe(false);
  });

  it("Select all / Deselect all and the confirm button count track selection exactly", async () => {
    mockFetch();
    await renderModal();
    expect(screen.getByRole("button", { name: "Apply Review & Archive 2 Similar Files" })).toBeTruthy();

    const list = screen.getByRole("group", { name: "Select files to archive" });
    const firstCheckbox = within(list).getAllByRole("checkbox")[0];
    fireEvent.click(firstCheckbox);
    expect(screen.getByRole("button", { name: "Apply Review & Archive 1 Similar Files" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Deselect all" }));
    expect(screen.getByRole("button", { name: "Apply Review & Archive 0 Similar Files" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Select all eligible" }));
    expect(screen.getByRole("button", { name: "Apply Review & Archive 2 Similar Files" })).toBeTruthy();
  });

  it("shows excluded files with their reason once the collapsible section is opened", async () => {
    mockFetch();
    await renderModal();
    fireEvent.click(screen.getByText("Protected or excluded files (1)"));
    expect(screen.getByText("invoice.pdf")).toBeTruthy();
    expect(screen.getByText("Not a supported image file")).toBeTruthy();
  });
});

describe("ArchiveSimilarModal — 74/75. confirmation disable rules and loading state", () => {
  it("disables Confirm when nothing is selected and 'archive current file' is unchecked", async () => {
    mockFetch();
    await renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Deselect all" }));
    fireEvent.click(screen.getByLabelText("Also save and archive the current file"));
    expect((screen.getByRole("button", { name: /Apply Review & Archive/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps Confirm enabled when nothing is selected but 'archive current file' stays checked", async () => {
    mockFetch();
    await renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Deselect all" }));
    expect((screen.getByRole("button", { name: "Apply Review & Archive 0 Similar Files" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows a loading label and disables Cancel/Close while applying, preventing double submission", async () => {
    mockFetch();
    const onApplied = vi.fn();
    await renderModal({ onApplied });
    const confirmButton = screen.getByRole("button", { name: "Apply Review & Archive 2 Similar Files" });
    fireEvent.click(confirmButton);
    fireEvent.click(confirmButton); // second, rapid click
    await waitFor(() => expect(onApplied).toHaveBeenCalledTimes(1));
  });
});

describe("ArchiveSimilarModal — apply payload and callback", () => {
  it("submits the selected ids, the review template, and the archiveCurrentItem flag, then calls onApplied with the result and archivedSource", async () => {
    let sentBody: unknown = null;
    mockFetch({
      apply: (body) => {
        sentBody = body;
        return { operationId: 42, requestedCount: 3, appliedCount: 3, skippedCount: 0, failedCount: 0, skipped: [], status: "completed" };
      },
    });
    const onApplied = vi.fn();
    await renderModal({ onApplied });

    fireEvent.click(screen.getByRole("button", { name: "Apply Review & Archive 2 Similar Files" }));
    await waitFor(() => expect(onApplied).toHaveBeenCalled());

    expect(sentBody).toMatchObject({
      selectedItemIds: expect.arrayContaining(["eligible-1", "eligible-2"]),
      reviewTemplate,
      archiveCurrentItem: true,
      sourceItemPayload,
    });
    expect(onApplied).toHaveBeenCalledWith(expect.objectContaining({ operationId: 42, status: "completed" }), true);
  });

  it("omits sourceItemPayload from the request when 'archive current file' is unchecked", async () => {
    let sentBody: unknown = null;
    mockFetch({
      apply: (body) => {
        sentBody = body;
        return { operationId: 43, requestedCount: 2, appliedCount: 2, skippedCount: 0, failedCount: 0, skipped: [], status: "completed" };
      },
    });
    await renderModal();
    fireEvent.click(screen.getByLabelText("Also save and archive the current file"));
    fireEvent.click(screen.getByRole("button", { name: "Apply Review & Archive 2 Similar Files" }));
    await waitFor(() => expect(sentBody).not.toBeNull());
    expect((sentBody as { archiveCurrentItem: boolean }).archiveCurrentItem).toBe(false);
    expect((sentBody as { sourceItemPayload?: unknown }).sourceItemPayload).toBeUndefined();
  });
});

describe("ArchiveSimilarModal — accessibility", () => {
  it("Escape closes the dialog when not applying", async () => {
    mockFetch();
    const onClose = vi.fn();
    await renderModal({ onClose });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("has no eligible files message when the preview returns zero eligible candidates", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.includes("/preview")) {
          return Promise.resolve({ ok: true, status: 200, json: async () => ({ ...previewResponse, eligible: [], eligibleCount: 0 }) });
        }
        throw new Error("apply should not be called");
      }),
    );
    render(<ArchiveSimilarModal open sourceItemId="source-1" reviewTemplate={reviewTemplate} sourceItemPayload={sourceItemPayload} onClose={() => {}} onApplied={() => {}} />);
    await waitFor(() => expect(screen.getByText("No other eligible files were found.")).toBeTruthy());
  });
});

// ---------------------------------------------------------------------
// 64/65/66/67. Design Mockup preset.
// ---------------------------------------------------------------------

const designMockupReviewTemplate: ArchiveSimilarReviewTemplate = {
  evidenceTypeId: "design_mockup",
  answers: {
    design_mockup_internal_concept: { value: "Yes", confidence: "high" },
    design_mockup_final_design: { value: "No", confidence: "high" },
    design_mockup_creator: { value: "Oscar V. & Michael M.", confidence: "high" },
    design_mockup_publicly_released: { value: "No", confidence: "high" },
    design_mockup_related_psd: { value: "No", confidence: "high" },
    design_mockup_related_final_logo: { value: "No", confidence: "high" },
  },
  decisionAction: "archive",
};

const designMockupSourcePayload: ReviewDraftPayload = {
  evidenceType: { typeId: "design_mockup", source: "user", confidence: null, reason: null },
  interviewAnswers: {},
  connectionsToAdd: [],
  connectionIdsToRemove: [],
  noRelatedEvidence: false,
  usefulnessOverride: { action: "none", score: null, band: null, note: null },
  notes: "",
  decisionAction: "archive",
};

const designMockupPreviewResponse: ArchiveSimilarPreviewResponse = {
  presetId: "design_mockup",
  sourceItem: { itemId: "dm-source-1", filename: "concept.png", originalPath: "Design Mockups/Concepts/concept.png" },
  scope: { folderPath: "Design Mockups/Concepts", evidenceTypeId: "design_mockup", mediaType: "image" },
  templateSummary: designMockupReviewTemplate,
  derivedField: { questionId: "design_mockup_creation_date", source: "filesystem_last_modified", defaultConfidence: "medium" },
  eligible: [
    {
      itemId: "dm-1",
      filename: "0_0 (1).png",
      originalPath: "Design Mockups/Concepts/0_0 (1).png",
      reviewStatus: "unreviewed",
      evidenceTypeId: null,
      derivedAnswers: { design_mockup_creation_date: { value: "9/12/2024", confidence: "medium", note: "Auto-filled from this file's filesystem last-modified date. This date may not represent the original design creation date." } },
    },
    {
      itemId: "dm-2",
      filename: "0_2.png",
      originalPath: "Design Mockups/Concepts/0_2.png",
      reviewStatus: "unreviewed",
      evidenceTypeId: null,
      derivedAnswers: { design_mockup_creation_date: { value: "10/3/2024", confidence: "medium", note: "Auto-filled from this file's filesystem last-modified date. This date may not represent the original design creation date." } },
    },
  ],
  excluded: [{ itemId: "dm-missing-date", filename: "no_date.png", reasonCode: "MISSING_FILESYSTEM_DATE", reasonLabel: "No usable filesystem last-modified date is available. Review this file manually." }],
  eligibleCount: 2,
  excludedCount: 1,
  previewToken: "dm-token-1",
};

function mockDesignMockupFetch(overrides: { apply?: (body: unknown) => unknown } = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes("/archive-similar/preview")) {
        return Promise.resolve({ ok: true, status: 200, json: async () => designMockupPreviewResponse });
      }
      if (url.includes("/archive-similar/apply")) {
        const body = overrides.apply
          ? overrides.apply(JSON.parse(String(init?.body)))
          : { operationId: 2, requestedCount: 2, appliedCount: 2, skippedCount: 0, failedCount: 0, skipped: [], status: "completed" };
        return Promise.resolve({ ok: true, status: 200, json: async () => body });
      }
      throw new Error(`Unmocked fetch: ${url}`);
    }),
  );
}

describe("ArchiveSimilarModal — Design Mockup preset", () => {
  it("64. renders the Design Mockup title and description, distinct from Product Mockup's", async () => {
    mockDesignMockupFetch();
    render(
      <ArchiveSimilarModal
        open
        sourceItemId="dm-source-1"
        reviewTemplate={designMockupReviewTemplate}
        sourceItemPayload={designMockupSourcePayload}
        onClose={() => {}}
        onApplied={() => {}}
      />,
    );
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Archive Similar Design Mockups" })).toBeTruthy());
    expect(screen.getByText(/Each file will receive its own filesystem last-modified date/)).toBeTruthy();
  });

  it("65. eligible files each show their own unique derived date", async () => {
    mockDesignMockupFetch();
    render(
      <ArchiveSimilarModal
        open
        sourceItemId="dm-source-1"
        reviewTemplate={designMockupReviewTemplate}
        sourceItemPayload={designMockupSourcePayload}
        onClose={() => {}}
        onApplied={() => {}}
      />,
    );
    await waitFor(() => expect(screen.getByText("0_0 (1).png")).toBeTruthy());
    expect(screen.getByText("9/12/2024")).toBeTruthy();
    expect(screen.getByText("10/3/2024")).toBeTruthy();
  });

  it("66. a missing-date file appears in the excluded section with a clear reason", async () => {
    mockDesignMockupFetch();
    render(
      <ArchiveSimilarModal
        open
        sourceItemId="dm-source-1"
        reviewTemplate={designMockupReviewTemplate}
        sourceItemPayload={designMockupSourcePayload}
        onClose={() => {}}
        onApplied={() => {}}
      />,
    );
    await waitFor(() => expect(screen.getByText("Protected or excluded files (1)")).toBeTruthy());
    fireEvent.click(screen.getByText("Protected or excluded files (1)"));
    expect(screen.getByText("no_date.png")).toBeTruthy();
    expect(screen.getByText(/No usable filesystem last-modified date/)).toBeTruthy();
  });

  it("67/21. the date-confidence selector defaults to Medium and its value is sent in the apply request", async () => {
    let sentBody: unknown = null;
    mockDesignMockupFetch({
      apply: (body) => {
        sentBody = body;
        return { operationId: 3, requestedCount: 2, appliedCount: 2, skippedCount: 0, failedCount: 0, skipped: [], status: "completed" };
      },
    });
    render(
      <ArchiveSimilarModal
        open
        sourceItemId="dm-source-1"
        reviewTemplate={designMockupReviewTemplate}
        sourceItemPayload={designMockupSourcePayload}
        onClose={() => {}}
        onApplied={() => {}}
      />,
    );
    await waitFor(() => expect(screen.getByText("0_0 (1).png")).toBeTruthy());
    const select = screen.getByLabelText("Confidence in filesystem dates") as HTMLSelectElement;
    expect(select.value).toBe("medium");

    fireEvent.change(select, { target: { value: "high" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply Review & Archive 2 Design Mockups" }));
    await waitFor(() => expect(sentBody).not.toBeNull());
    expect((sentBody as { dateConfidence?: string }).dateConfidence).toBe("high");
  });

  it("70. Product Mockup's modal never shows the date-confidence selector or per-item dates", async () => {
    mockFetch();
    await renderModal();
    expect(screen.queryByLabelText("Confidence in filesystem dates")).toBeNull();
  });
});

// ---------------------------------------------------------------------
// Earlier Logo Iterations preset.
// ---------------------------------------------------------------------

const earlierLogoIterationReviewTemplate: ArchiveSimilarReviewTemplate = {
  evidenceTypeId: "design_mockup",
  answers: {
    design_mockup_internal_concept: { value: "Yes", confidence: "high" },
    design_mockup_final_design: { value: "No", confidence: "high" },
    design_mockup_publicly_released: { value: "No", confidence: "high" },
    design_mockup_related_psd: { value: "No", confidence: "high" },
    design_mockup_related_final_logo: { value: "Yes", confidence: "high" },
  },
  decisionAction: "archive",
};

const earlierLogoIterationSourcePayload: ReviewDraftPayload = {
  evidenceType: { typeId: "design_mockup", source: "user", confidence: null, reason: null },
  interviewAnswers: {},
  connectionsToAdd: [],
  connectionIdsToRemove: [],
  noRelatedEvidence: false,
  usefulnessOverride: { action: "none", score: null, band: null, note: null },
  notes: "",
  decisionAction: "archive",
};

const earlierLogoIterationPreviewResponse: ArchiveSimilarPreviewResponse = {
  presetId: "design_mockup_earlier_logo_iteration",
  sourceItem: { itemId: "eli-source-1", filename: "logo_v1.png", originalPath: "Design Mockups/Logo History/logo_v1.png" },
  scope: { folderPath: "Design Mockups/Logo History", evidenceTypeId: "design_mockup", mediaType: "image" },
  templateSummary: earlierLogoIterationReviewTemplate,
  derivedField: { questionId: "design_mockup_creation_date", source: "filesystem_last_modified", defaultConfidence: "medium" },
  eligible: [
    {
      itemId: "eli-1",
      filename: "logo_v2.png",
      originalPath: "Design Mockups/Logo History/logo_v2.png",
      reviewStatus: "unreviewed",
      evidenceTypeId: null,
      derivedAnswers: { design_mockup_creation_date: { value: "2/1/2023", confidence: "medium", note: "note" } },
    },
  ],
  excluded: [],
  eligibleCount: 1,
  excludedCount: 0,
  previewToken: "eli-token-1",
};

function mockEarlierLogoIterationFetch(overrides: { apply?: (body: unknown) => unknown } = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes("/archive-similar/preview")) {
        return Promise.resolve({ ok: true, status: 200, json: async () => earlierLogoIterationPreviewResponse });
      }
      if (url.includes("/archive-similar/apply")) {
        const body = overrides.apply
          ? overrides.apply(JSON.parse(String(init?.body)))
          : { operationId: 4, requestedCount: 1, appliedCount: 1, skippedCount: 0, failedCount: 0, skipped: [], status: "completed" };
        return Promise.resolve({ ok: true, status: 200, json: async () => body });
      }
      throw new Error(`Unmocked fetch: ${url}`);
    }),
  );
}

describe("ArchiveSimilarModal — Earlier Logo Iterations preset", () => {
  it("renders the Earlier Logo Iterations title, distinct from both other presets", async () => {
    mockEarlierLogoIterationFetch();
    render(
      <ArchiveSimilarModal
        open
        sourceItemId="eli-source-1"
        reviewTemplate={earlierLogoIterationReviewTemplate}
        sourceItemPayload={earlierLogoIterationSourcePayload}
        onClose={() => {}}
        onApplied={() => {}}
      />,
    );
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Archive Similar Earlier Logo Iterations" })).toBeTruthy());
  });

  it("9. the creator field defaults to 'Oscar V & Michael M' and is editable, and 8. the edited value is sent for every target", async () => {
    let sentBody: unknown = null;
    mockEarlierLogoIterationFetch({
      apply: (body) => {
        sentBody = body;
        return { operationId: 5, requestedCount: 1, appliedCount: 1, skippedCount: 0, failedCount: 0, skipped: [], status: "completed" };
      },
    });
    render(
      <ArchiveSimilarModal
        open
        sourceItemId="eli-source-1"
        reviewTemplate={earlierLogoIterationReviewTemplate}
        sourceItemPayload={earlierLogoIterationSourcePayload}
        onClose={() => {}}
        onApplied={() => {}}
      />,
    );
    await waitFor(() => expect(screen.getByText("logo_v2.png")).toBeTruthy());
    const creatorInput = screen.getByLabelText("Who created this design?") as HTMLInputElement;
    expect(creatorInput.value).toBe("Oscar V & Michael M");

    fireEvent.change(creatorInput, { target: { value: "A Different Name" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply Review & Archive 1 Earlier Logo Iterations" }));
    await waitFor(() => expect(sentBody).not.toBeNull());
    expect((sentBody as { reviewTemplate: ArchiveSimilarReviewTemplate }).reviewTemplate.answers.design_mockup_creator).toEqual({ value: "A Different Name", confidence: "high" });
    expect((sentBody as { sourceItemPayload?: ReviewDraftPayload }).sourceItemPayload?.interviewAnswers.design_mockup_creator).toEqual({
      value: "A Different Name",
      confidence: "high",
      note: null,
    });
  });

  it("does not overwrite an existing non-blank source creator answer — it's shown, not replaced", async () => {
    mockEarlierLogoIterationFetch();
    const templateWithCreator: ArchiveSimilarReviewTemplate = {
      ...earlierLogoIterationReviewTemplate,
      answers: { ...earlierLogoIterationReviewTemplate.answers, design_mockup_creator: { value: "Existing Name", confidence: "high" } },
    };
    render(
      <ArchiveSimilarModal
        open
        sourceItemId="eli-source-1"
        reviewTemplate={templateWithCreator}
        sourceItemPayload={earlierLogoIterationSourcePayload}
        onClose={() => {}}
        onApplied={() => {}}
      />,
    );
    await waitFor(() => expect(screen.getByText("logo_v2.png")).toBeTruthy());
    const creatorInput = screen.getByLabelText("Who created this design?") as HTMLInputElement;
    expect(creatorInput.value).toBe("Existing Name");
  });

  it("65. each eligible file shows its own unique derived date", async () => {
    mockEarlierLogoIterationFetch();
    render(
      <ArchiveSimilarModal
        open
        sourceItemId="eli-source-1"
        reviewTemplate={earlierLogoIterationReviewTemplate}
        sourceItemPayload={earlierLogoIterationSourcePayload}
        onClose={() => {}}
        onApplied={() => {}}
      />,
    );
    await waitFor(() => expect(screen.getByText("2/1/2023")).toBeTruthy());
  });
});
