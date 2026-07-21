import {
  getInterviewForType,
  type ConnectionType,
  type DraftConnectionAdd,
  type DraftEvidenceType,
  type DraftInterviewAnswer,
  type DraftUsefulnessOverride,
  type EvidenceItemDetail,
  type ReviewDecisionAction,
  type ReviewDraftPayload,
  type SuggestionConfidence,
  type UsefulnessBand,
} from "@trademark-evidence-assistant/shared";

/**
 * Pure, item-level Review Draft state — owned by ReviewQueue.tsx (per
 * the "one item-level ReviewDraft state owned by the parent" requirement),
 * not by any individual accordion panel. Every function here returns a
 * new state object; ReviewQueue wires these into a useReducer so
 * switching panels (which just changes which accordion section is
 * rendered) can never discard anything — the draft lives above the
 * accordion, not inside it.
 *
 * No network calls happen anywhere in this file. Persistence only
 * happens via `toPayload()` + a single PUT .../draft call triggered by
 * Save & Next or a decision button in ReviewQueue.tsx.
 */

export interface DraftConnectionView {
  /** Stable identity for this row regardless of persisted/pending status — `conn-<id>` for existing, `pending-<n>` for not-yet-saved adds. */
  draftKey: string;
  connectionId: number | null;
  direction: "outgoing" | "incoming" | "new";
  relatedOriginalPath: string;
  type: ConnectionType;
  explanation: string;
  confidence: SuggestionConfidence | null;
  markedForRemoval: boolean;
}

export interface ReviewDraftState {
  itemId: string;
  evidenceType: DraftEvidenceType | null;
  interviewAnswers: Record<string, DraftInterviewAnswer>;
  connections: DraftConnectionView[];
  usefulnessOverride: DraftUsefulnessOverride;
  notes: string;
  decisionAction: ReviewDecisionAction | null;
  /** "No related evidence" checkbox intent — see the "No Related Evidence" workflow. Mutually exclusive with `connections` having any non-removed entries; addDraftConnection enforces this locally for instant feedback. */
  noRelatedEvidence: boolean;
  pendingSeq: number;
}

const EMPTY_OVERRIDE: DraftUsefulnessOverride = { action: "none", score: null, band: null, note: null };

export function createDraftFromItem(item: EvidenceItemDetail): ReviewDraftState {
  return {
    itemId: item.id,
    evidenceType: null,
    interviewAnswers: {},
    connections: item.connections.map((c) => ({
      draftKey: `conn-${c.connectionId}`,
      connectionId: c.connectionId,
      direction: c.direction,
      relatedOriginalPath: c.relatedOriginalPath,
      type: c.type,
      explanation: c.explanation,
      confidence: c.confidence,
      markedForRemoval: false,
    })),
    usefulnessOverride: EMPTY_OVERRIDE,
    notes: item.notes ?? "",
    decisionAction: null,
    noRelatedEvidence: item.noRelatedEvidence,
    pendingSeq: 0,
  };
}

/** Valid interview question ids for a type, used to drop stale answers when the confirmed type changes mid-draft. */
function interviewQuestionIds(typeId: string): Set<string> {
  return new Set(getInterviewForType(typeId).map((q) => q.id));
}

export function setDraftEvidenceType(
  draft: ReviewDraftState,
  typeId: string,
  source: "suggested" | "user",
  confidence: SuggestionConfidence | null,
  reason: string | null,
): ReviewDraftState {
  const validIds = interviewQuestionIds(typeId);
  const filteredAnswers = Object.fromEntries(
    Object.entries(draft.interviewAnswers).filter(([questionId]) => validIds.has(questionId)),
  );
  return {
    ...draft,
    evidenceType: { typeId, source, confidence, reason },
    interviewAnswers: filteredAnswers,
  };
}

export function setDraftInterviewAnswer(
  draft: ReviewDraftState,
  questionId: string,
  patch: Partial<DraftInterviewAnswer>,
): ReviewDraftState {
  const existing = draft.interviewAnswers[questionId] ?? { value: "", confidence: null, note: null };
  return {
    ...draft,
    interviewAnswers: {
      ...draft.interviewAnswers,
      [questionId]: { ...existing, ...patch },
    },
  };
}

export function addDraftConnection(draft: ReviewDraftState, input: DraftConnectionAdd): ReviewDraftState {
  const draftKey = `pending-${draft.pendingSeq}`;
  const view: DraftConnectionView = {
    draftKey,
    connectionId: null,
    direction: "new",
    relatedOriginalPath: input.targetPath,
    type: input.type,
    explanation: input.explanation,
    confidence: input.confidence,
    markedForRemoval: false,
  };
  // "No Related Evidence" workflow: the two states must never coexist —
  // adding a connection always clears a pending "no related evidence"
  // intent immediately, not just after save (the server enforces the
  // same rule authoritatively; this is for instant UI feedback).
  return {
    ...draft,
    connections: [...draft.connections, view],
    pendingSeq: draft.pendingSeq + 1,
    noRelatedEvidence: false,
  };
}

export function setDraftNoRelatedEvidence(draft: ReviewDraftState, value: boolean): ReviewDraftState {
  return { ...draft, noRelatedEvidence: value };
}

/** For an existing (persisted) connection, toggles it marked-for-removal. For a pending (unsaved) one, discards it outright — there is nothing to "unmark" on the server for something never sent. */
export function removeDraftConnection(draft: ReviewDraftState, draftKey: string): ReviewDraftState {
  const target = draft.connections.find((c) => c.draftKey === draftKey);
  if (!target) return draft;
  if (target.connectionId === null) {
    return { ...draft, connections: draft.connections.filter((c) => c.draftKey !== draftKey) };
  }
  return {
    ...draft,
    connections: draft.connections.map((c) => (c.draftKey === draftKey ? { ...c, markedForRemoval: true } : c)),
  };
}

export function unmarkDraftConnectionRemoval(draft: ReviewDraftState, draftKey: string): ReviewDraftState {
  return {
    ...draft,
    connections: draft.connections.map((c) => (c.draftKey === draftKey ? { ...c, markedForRemoval: false } : c)),
  };
}

export function setDraftUsefulnessOverride(
  draft: ReviewDraftState,
  score: number,
  band: UsefulnessBand,
  note: string,
): ReviewDraftState {
  return { ...draft, usefulnessOverride: { action: "set", score, band, note } };
}

export function clearDraftUsefulnessOverride(draft: ReviewDraftState): ReviewDraftState {
  return { ...draft, usefulnessOverride: { action: "clear", score: null, band: null, note: null } };
}

/** Discards a not-yet-saved pending "set"/"clear" and reverts to "leave alone" — used when the user removes an override they staged but never saved this session, so nothing is sent to the server at all. */
export function resetDraftUsefulnessOverride(draft: ReviewDraftState): ReviewDraftState {
  return { ...draft, usefulnessOverride: EMPTY_OVERRIDE };
}

export function setDraftNotes(draft: ReviewDraftState, notes: string): ReviewDraftState {
  return { ...draft, notes };
}

export function setDraftDecisionAction(draft: ReviewDraftState, action: ReviewDecisionAction | null): ReviewDraftState {
  return { ...draft, decisionAction: action };
}

/** Canonical JSON — sorts object keys recursively so semantically-equal drafts compare equal regardless of edit order. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * True when the draft differs from what a freshly-loaded item would
 * produce — the single source of the "Unsaved changes" indicator.
 * Accordion open/close state is not part of ReviewDraftState at all, so
 * it structurally cannot affect this.
 */
export function isDraftDirty(draft: ReviewDraftState, item: EvidenceItemDetail): boolean {
  const baseline = createDraftFromItem(item);
  return stableStringify({ ...draft, pendingSeq: 0 }) !== stableStringify({ ...baseline, pendingSeq: 0 });
}

export function toPayload(draft: ReviewDraftState): ReviewDraftPayload {
  return {
    evidenceType: draft.evidenceType,
    interviewAnswers: draft.interviewAnswers,
    connectionsToAdd: draft.connections
      .filter((c) => c.connectionId === null && !c.markedForRemoval)
      .map((c) => ({
        targetPath: c.relatedOriginalPath,
        type: c.type,
        explanation: c.explanation,
        confidence: c.confidence,
      })),
    connectionIdsToRemove: draft.connections
      .filter((c) => c.connectionId !== null && c.markedForRemoval)
      .map((c) => c.connectionId as number),
    noRelatedEvidence: draft.noRelatedEvidence,
    usefulnessOverride: draft.usefulnessOverride,
    notes: draft.notes,
    decisionAction: draft.decisionAction,
  };
}
