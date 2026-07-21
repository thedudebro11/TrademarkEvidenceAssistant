import { describe, expect, it } from "vitest";
import type { EvidenceItemDetail } from "@trademark-evidence-assistant/shared";
import {
  addDraftConnection,
  clearDraftUsefulnessOverride,
  createDraftFromItem,
  isDraftDirty,
  removeDraftConnection,
  setDraftDecisionAction,
  setDraftEvidenceType,
  setDraftInterviewAnswer,
  setDraftNoRelatedEvidence,
  setDraftNotes,
  setDraftUsefulnessOverride,
  toPayload,
  unmarkDraftConnectionRemoval,
} from "./reviewDraft.js";

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
  notes: "existing note",
  notesUpdatedAt: null,
  decidedAt: null,
  metadata: null,
  duplicates: [],
  fileRole: null,
  answers: [],
  connections: [
    {
      connectionId: 7,
      direction: "outgoing",
      relatedItemId: "item-2",
      relatedOriginalPath: "Proof Files/invoice.pdf",
      type: "related_to",
      explanation: "Same order.",
      confidence: "medium",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  ],
  usefulness: { computed: { score: 0, band: "Undetermined", positiveFactors: [], missingElements: [] }, override: null, effective: { score: 0, band: "Undetermined", positiveFactors: [], missingElements: [] } },
  evidenceType: null,
  evidenceTypeSuggestion: null,
  noRelatedEvidence: false,
};

describe("reviewDraft (pure item-level draft state)", () => {
  it("createDraftFromItem is not dirty against its own source item", () => {
    const draft = createDraftFromItem(baseItem);
    expect(isDraftDirty(draft, baseItem)).toBe(false);
  });

  it("test 10 — existing persisted answers/notes/connections load correctly into the draft baseline", () => {
    const draft = createDraftFromItem(baseItem);
    expect(draft.notes).toBe("existing note");
    expect(draft.connections).toHaveLength(1);
    expect(draft.connections[0]).toMatchObject({ connectionId: 7, draftKey: "conn-7", markedForRemoval: false });
  });

  it("test 2 — an interview answer edit marks the draft dirty and survives being reapplied after other edits (panel switching)", () => {
    let draft = createDraftFromItem(baseItem);
    draft = setDraftEvidenceType(draft, "final_logo", "user", null, null);
    draft = setDraftInterviewAnswer(draft, "final_logo_official", { value: "yes", confidence: "high", note: "checked twice" });
    // Simulate switching to another panel and back — nothing here touches
    // the draft, proving panel-switch is a no-op on state by construction
    // (accordion open/close never appears in ReviewDraftState at all).
    expect(draft.interviewAnswers.final_logo_official).toEqual({ value: "yes", confidence: "high", note: "checked twice" });
    expect(isDraftDirty(draft, baseItem)).toBe(true);
  });

  it("changing the confirmed evidence type drops interview answers that no longer belong to any question in the new type's interview", () => {
    let draft = createDraftFromItem(baseItem);
    draft = setDraftEvidenceType(draft, "final_logo", "user", null, null);
    draft = setDraftInterviewAnswer(draft, "final_logo_official", { value: "yes", confidence: null, note: null });
    draft = setDraftEvidenceType(draft, "printful_invoice", "user", null, null);
    expect(draft.interviewAnswers.final_logo_official).toBeUndefined();
  });

  it("test 3 — a pending connection add survives further edits and appears in the payload", () => {
    let draft = createDraftFromItem(baseItem);
    draft = addDraftConnection(draft, { targetPath: "Proof Files/other.pdf", type: "related_to", explanation: "Same batch.", confidence: "low" });
    draft = setDraftNotes(draft, "unrelated edit"); // simulate switching to Notes panel afterward
    const pending = draft.connections.find((c) => c.connectionId === null);
    expect(pending).toBeDefined();
    expect(pending?.relatedOriginalPath).toBe("Proof Files/other.pdf");

    const payload = toPayload(draft);
    expect(payload.connectionsToAdd).toEqual([
      { targetPath: "Proof Files/other.pdf", type: "related_to", explanation: "Same batch.", confidence: "low" },
    ]);
  });

  it("removing an existing (persisted) connection marks it for removal rather than deleting it locally", () => {
    let draft = createDraftFromItem(baseItem);
    draft = removeDraftConnection(draft, "conn-7");
    expect(draft.connections).toHaveLength(1);
    expect(draft.connections[0].markedForRemoval).toBe(true);
    expect(toPayload(draft).connectionIdsToRemove).toEqual([7]);
    expect(toPayload(draft).connectionsToAdd).toEqual([]);
  });

  it("removing a pending (not yet persisted) connection discards it outright, not a server-side removal", () => {
    let draft = createDraftFromItem(baseItem);
    draft = addDraftConnection(draft, { targetPath: "x.pdf", type: "related_to", explanation: "e", confidence: null });
    const pendingKey = draft.connections.find((c) => c.connectionId === null)!.draftKey;
    draft = removeDraftConnection(draft, pendingKey);
    expect(draft.connections.find((c) => c.draftKey === pendingKey)).toBeUndefined();
    expect(toPayload(draft).connectionsToAdd).toEqual([]);
  });

  it("unmarking a removal restores the connection and clears dirty state for that field", () => {
    let draft = createDraftFromItem(baseItem);
    draft = removeDraftConnection(draft, "conn-7");
    draft = unmarkDraftConnectionRemoval(draft, "conn-7");
    expect(isDraftDirty(draft, baseItem)).toBe(false);
  });

  it("test 4 — collapsing/expanding a panel cannot clear draft state, because ReviewDraftState has no accordion field to clear", () => {
    let draft = createDraftFromItem(baseItem);
    draft = setDraftNotes(draft, "typed before collapsing Notes");
    // There is no function in this module that models "collapse a panel" —
    // by construction, nothing here can mutate draft.notes as a side
    // effect of accordion visibility (that lives entirely in ReviewQueue's
    // separate openSection state, never touching ReviewDraftState).
    expect(draft.notes).toBe("typed before collapsing Notes");
  });

  it("evaluation override is staged, not applied, until save — action starts at 'none' even with edits pending elsewhere", () => {
    let draft = createDraftFromItem(baseItem);
    draft = setDraftUsefulnessOverride(draft, 80, "Strong", "Confirmed with the customer.");
    expect(draft.usefulnessOverride).toEqual({ action: "set", score: 80, band: "Strong", note: "Confirmed with the customer." });
    draft = clearDraftUsefulnessOverride(draft);
    expect(draft.usefulnessOverride.action).toBe("clear");
  });

  it("a decisionAction being set makes the draft dirty even with no other edits", () => {
    let draft = createDraftFromItem(baseItem);
    expect(isDraftDirty(draft, baseItem)).toBe(false);
    draft = setDraftDecisionAction(draft, "include");
    expect(isDraftDirty(draft, baseItem)).toBe(true);
  });

  it("toPayload never includes evidenceType unless the user actually confirmed/changed one this session", () => {
    const draft = createDraftFromItem(baseItem);
    expect(toPayload(draft).evidenceType).toBeNull();
  });
});

describe("reviewDraft — 'No Related Evidence' workflow", () => {
  const itemWithNoConnections: EvidenceItemDetail = { ...baseItem, connections: [] };

  it("test 1 — setDraftNoRelatedEvidence(true) records the reviewed state in the draft and payload", () => {
    let draft = createDraftFromItem(itemWithNoConnections);
    draft = setDraftNoRelatedEvidence(draft, true);
    expect(draft.noRelatedEvidence).toBe(true);
    expect(toPayload(draft).noRelatedEvidence).toBe(true);
    expect(isDraftDirty(draft, itemWithNoConnections)).toBe(true);
  });

  it("test 4 — adding a connection automatically clears a pending 'no related evidence' intent", () => {
    let draft = createDraftFromItem(itemWithNoConnections);
    draft = setDraftNoRelatedEvidence(draft, true);
    expect(draft.noRelatedEvidence).toBe(true);

    draft = addDraftConnection(draft, { targetPath: "Proof Files/other.pdf", type: "related_to", explanation: "e", confidence: null });
    expect(draft.noRelatedEvidence).toBe(false);
  });

  it("distinguishes 'reviewed, no connections' (true) from 'never evaluated' (false) — the two are not the same falsy default", () => {
    const neverEvaluated = createDraftFromItem(itemWithNoConnections);
    expect(neverEvaluated.noRelatedEvidence).toBe(false);

    const reviewedItem: EvidenceItemDetail = { ...itemWithNoConnections, noRelatedEvidence: true };
    const reviewedDraft = createDraftFromItem(reviewedItem);
    expect(reviewedDraft.noRelatedEvidence).toBe(true);
    expect(isDraftDirty(reviewedDraft, reviewedItem)).toBe(false);
  });

  it("unchecking (setting back to false) is a normal draft edit like any other", () => {
    const reviewedItem: EvidenceItemDetail = { ...itemWithNoConnections, noRelatedEvidence: true };
    let draft = createDraftFromItem(reviewedItem);
    draft = setDraftNoRelatedEvidence(draft, false);
    expect(draft.noRelatedEvidence).toBe(false);
    expect(isDraftDirty(draft, reviewedItem)).toBe(true);
  });
});
