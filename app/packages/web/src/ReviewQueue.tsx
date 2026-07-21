import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  getArchiveSimilarPresetsForEvidenceType,
  getPreviewKind,
  type ArchiveSimilarApplyResponse,
  type ArchiveSimilarReviewTemplate,
  type DraftConnectionAdd,
  type EvidenceItemDetail,
  type ReviewDecisionAction,
  type ReviewProgress,
  type SuggestionConfidence,
} from "@trademark-evidence-assistant/shared";
import { fetchItem, fetchNextItem, fetchPreviousItem, fetchProgress, saveReviewDraft, undoBulkOperation } from "./api.js";
import { consumePendingReviewItemId, setNavigationGuard } from "./app/router.js";
import { EvidenceViewer } from "./components/evidence-viewer/EvidenceViewer.js";
import { MetadataPanel } from "./MetadataPanel.js";
import { DecisionBar } from "./DecisionBar.js";
import { NotesEditor } from "./NotesEditor.js";
import { EvidenceTypePanel } from "./EvidenceTypePanel.js";
import { EvidenceTreePanel } from "./EvidenceTreePanel.js";
import { ReviewedFilesPanel } from "./ReviewedFilesPanel.js";
import { ConnectionsPanel } from "./ConnectionsPanel.js";
import { ConnectionsWorkspace } from "./components/connections/ConnectionsWorkspace.js";
import { ArchiveSimilarModal } from "./components/archiveSimilar/ArchiveSimilarModal.js";
import { UsefulnessPanel } from "./UsefulnessPanel.js";
import { Button } from "./components/ui/Button.js";
import { GlassPanel } from "./components/ui/GlassPanel.js";
import { ProgressBar } from "./components/ui/ProgressBar.js";
import { Badge } from "./components/ui/Badge.js";
import { IconButton } from "./components/ui/IconButton.js";
import { StatusMessage } from "./components/ui/StatusMessage.js";
import { Toast } from "./components/ui/Toast.js";
import { Accordion, type AccordionSection } from "./components/ui/Accordion.js";
import { DetailsIcon, IdentifyIcon, InfoIcon, LinkIcon, NoteIcon, ScoreIcon } from "./components/ui/icons.js";
import {
  addDraftConnection,
  clearDraftUsefulnessOverride,
  createDraftFromItem,
  isDraftDirty,
  removeDraftConnection,
  resetDraftUsefulnessOverride,
  setDraftEvidenceType,
  setDraftInterviewAnswer,
  setDraftNoRelatedEvidence,
  setDraftNotes,
  setDraftUsefulnessOverride,
  toPayload,
  unmarkDraftConnectionRemoval,
  type ReviewDraftState,
} from "./reviewDraft.js";
import {
  addManualSelected,
  clearFilters,
  clearSelected,
  createConnectionWorkspaceState,
  removeSelectedCandidate,
  setFilter,
  setPreviewCandidateId,
  setScrollTop,
  setSearchText,
  setSort,
  toggleSelectedCandidate,
  updateSelectedCandidate,
  type ConnectionWorkspaceState,
} from "./connectionWorkspaceState.js";

type QueueState =
  | { phase: "loading" }
  | { phase: "empty" } // spec 11 "incomplete scan" — nothing to review yet
  | { phase: "reviewing"; item: EvidenceItemDetail }
  | { phase: "complete" }
  | { phase: "error"; message: string };

const SHORTCUTS: { key: string; action: string }[] = [
  { key: "N", action: "Save & Next" },
  { key: "P", action: "Previous" },
  { key: "I", action: "Include" },
  { key: "M", action: "Maybe" },
  { key: "F", action: "Needs Follow-Up" },
  { key: "X", action: "Archive" },
];

type DraftAction =
  | { type: "reset"; item: EvidenceItemDetail }
  | { type: "setEvidenceType"; typeId: string; source: "suggested" | "user"; confidence: SuggestionConfidence | null; reason: string | null }
  | { type: "setAnswer"; questionId: string; patch: Parameters<typeof setDraftInterviewAnswer>[2] }
  | { type: "addConnection"; input: Parameters<typeof addDraftConnection>[1] }
  | { type: "removeConnection"; draftKey: string }
  | { type: "unmarkConnectionRemoval"; draftKey: string }
  | { type: "setNoRelatedEvidence"; value: boolean }
  | { type: "setOverride"; score: number; band: Parameters<typeof setDraftUsefulnessOverride>[2]; note: string }
  | { type: "removeOverride" }
  | { type: "setNotes"; notes: string };

function draftReducer(draft: ReviewDraftState, action: DraftAction): ReviewDraftState {
  switch (action.type) {
    case "reset":
      return createDraftFromItem(action.item);
    case "setEvidenceType":
      return setDraftEvidenceType(draft, action.typeId, action.source, action.confidence, action.reason);
    case "setAnswer":
      return setDraftInterviewAnswer(draft, action.questionId, action.patch);
    case "addConnection":
      return addDraftConnection(draft, action.input);
    case "removeConnection":
      return removeDraftConnection(draft, action.draftKey);
    case "unmarkConnectionRemoval":
      return unmarkDraftConnectionRemoval(draft, action.draftKey);
    case "setNoRelatedEvidence":
      return setDraftNoRelatedEvidence(draft, action.value);
    case "setOverride":
      return setDraftUsefulnessOverride(draft, action.score, action.band, action.note);
    case "removeOverride":
      return draft.usefulnessOverride.action === "set"
        ? resetDraftUsefulnessOverride(draft)
        : clearDraftUsefulnessOverride(draft);
    case "setNotes":
      return setDraftNotes(draft, action.notes);
  }
}

/**
 * Presentation + local UI state, plus the one item-level Review Draft
 * (docs/ADR_0002_REVIEW_DRAFT_STATE.md). Every field a user can edit
 * across Identify/Connect/Evaluate/Notes lives in `draft`, owned here —
 * not in the individual accordion panels, which unmount on collapse
 * (Accordion.tsx only renders the open section). Nothing is persisted
 * to the server until `saveDraftAndAdvance` sends the whole draft in
 * one atomic call; navigation/progress/decision *outcomes* remain
 * server-computed per docs/ARCHITECTURE_CONSTITUTION.md #3.
 */
export function ReviewQueue() {
  const [state, setState] = useState<QueueState>({ phase: "loading" });
  const [progress, setProgress] = useState<ReviewProgress | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [transientMessage, setTransientMessage] = useState<string | null>(null);
  const [openSection, setOpenSection] = useState("identify");
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [changingDecision, setChangingDecision] = useState(false);
  const [draft, dispatchDraft] = useReducer(draftReducer, null as unknown as ReviewDraftState);
  // Set only while the current item was reached via a tree-sidebar jump
  // rather than normal Next/Previous — holds the item we were viewing
  // right before the jump (plus whether it was still unreviewed), so
  // the next navigation action (Save & Next, a decision, or Previous)
  // resumes that original queue position instead of continuing from
  // wherever the jump landed. A tree jump is a one-off detour, not a
  // new queue position: if the anchor item was still unreviewed,
  // "resuming" means showing it again (you hadn't finished it); if it
  // was already decided, resuming means continuing past it as normal.
  const [queueAnchor, setQueueAnchor] = useState<{ id: string; wasUnreviewed: boolean } | null>(null);
  const [sidebarView, setSidebarView] = useState<"tree" | "reviewed">("tree");
  const [archiveSimilarOpen, setArchiveSimilarOpen] = useState(false);
  const [archiveSimilarToast, setArchiveSimilarToast] = useState<{ message: string; operationId: number | null } | null>(null);
  // Connections Workspace browsing state (search/filters/sort/selection/
  // scroll/preview) — lifted here rather than owned by ConnectionsPanel
  // or ConnectionsWorkspace, since the workspace drawer fully unmounts on
  // close (docs/ADR_0003_CONNECTIONS_WORKSPACE_SCROLL_FIX.md). Reset
  // alongside every draft reset (new item), never on open/close alone.
  const [workspaceState, setWorkspaceState] = useState<ConnectionWorkspaceState>(createConnectionWorkspaceState());
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const connectTriggerRef = useRef<HTMLButtonElement>(null);

  const dirty = state.phase === "reviewing" && draft ? isDraftDirty(draft, state.item) : false;

  // Warn on tab close/refresh while unsaved work exists.
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  // Warn on in-app navigation away from Review (e.g. sidebar links) while unsaved work exists.
  useEffect(() => {
    setNavigationGuard(
      dirty ? () => window.confirm("You have unsaved changes for this evidence item. Discard them and leave?") : null,
    );
    return () => setNavigationGuard(null);
  }, [dirty]);

  const refreshProgress = useCallback(async () => {
    setProgress(await fetchProgress());
  }, []);

  /**
   * After Evidence Intelligence's confirmation flow saves accepted
   * suggestions (analysisService.ts, through the same
   * saveDraft/saveDraftWithTx path a manual save uses), the *server's*
   * evidence_items/review_answers/connections rows changed — this
   * reloads the current item fresh from there (never trusts a locally
   * reconstructed value) and refreshes the queue counts, exactly like
   * `handleArchiveSimilarApplied` already does for that feature.
   */
  const handleAnalysisConfirmed = useCallback(async () => {
    await refreshProgress();
    if (state.phase === "reviewing") {
      const refreshed = await fetchItem(state.item.id);
      if (refreshed) {
        setState({ phase: "reviewing", item: refreshed });
        dispatchDraft({ type: "reset", item: refreshed });
      }
    }
  }, [refreshProgress, state]);

  /** New item — the workspace's browsing state belongs to the item just left behind, not the one about to be shown. */
  const resetConnectionsWorkspace = useCallback(() => {
    setWorkspaceState(createConnectionWorkspaceState());
    setWorkspaceOpen(false);
  }, []);

  const closeConnectionsWorkspace = useCallback(() => {
    setWorkspaceOpen(false);
    (connectTriggerRef.current ?? document.getElementById("accordion-trigger-connect"))?.focus();
  }, []);

  const handleLinkAllConnections = useCallback(
    (adds: DraftConnectionAdd[]) => {
      for (const input of adds) dispatchDraft({ type: "addConnection", input });
      setWorkspaceState((s) => clearSelected(s));
      closeConnectionsWorkspace();
    },
    [closeConnectionsWorkspace],
  );

  /**
   * Closes the modal, shows the success/partial-success toast (with
   * Undo when anything was actually archived), refreshes progress, and
   * — only when the current item itself was archived as part of this
   * operation — advances to the next item exactly like a normal
   * decision would. If "Also save and archive the current file" wasn't
   * checked, the current item is untouched server-side, so its local
   * draft is left exactly as the user had it.
   */
  const handleArchiveSimilarApplied = useCallback(
    async (result: ArchiveSimilarApplyResponse, archivedSource: boolean) => {
      setArchiveSimilarOpen(false);

      let message: string;
      const hasUndo = result.appliedCount > 0;
      if (!hasUndo) {
        message = "Nothing was archived because all selected files became ineligible.";
      } else if (result.status === "completed") {
        message = `${result.appliedCount} similar mockup${result.appliedCount === 1 ? "" : "s"} ${result.appliedCount === 1 ? "was" : "were"} reviewed and archived.`;
      } else {
        message = `${result.appliedCount} mockup${result.appliedCount === 1 ? "" : "s"} ${result.appliedCount === 1 ? "was" : "were"} archived. ${result.skippedCount} ${result.skippedCount === 1 ? "was" : "were"} skipped because their evidence changed.`;
      }
      setArchiveSimilarToast({ message, operationId: hasUndo ? result.operationId : null });
      await refreshProgress();

      if (archivedSource && state.phase === "reviewing") {
        const next = await fetchNextItem(state.item.id);
        if (next) {
          setState({ phase: "reviewing", item: next });
          dispatchDraft({ type: "reset", item: next });
          resetConnectionsWorkspace();
          setChangingDecision(false);
          setOpenSection("identify");
        } else {
          setState({ phase: "complete" });
        }
      }
    },
    [refreshProgress, state, resetConnectionsWorkspace],
  );

  const handleUndoArchiveSimilar = useCallback(
    async (operationId: number) => {
      try {
        const result = await undoBulkOperation(operationId);
        setArchiveSimilarToast(null);
        await refreshProgress();
        const message =
          result.undoStatus === "undone"
            ? `${result.restoredCount} file${result.restoredCount === 1 ? "" : "s"} restored.`
            : `${result.restoredCount} restored, ${result.skippedCount} skipped because ${result.skippedCount === 1 ? "it was" : "they were"} changed since.`;
        setTransientMessage(message);
        setTimeout(() => setTransientMessage(null), 4000);
      } catch (err) {
        setTransientMessage(`Undo failed: ${err instanceof Error ? err.message : String(err)}`);
        setTimeout(() => setTransientMessage(null), 4000);
      }
    },
    [refreshProgress],
  );

  useEffect(() => {
    (async () => {
      try {
        const p = await fetchProgress();
        setProgress(p);
        if (p.total === 0) {
          setState({ phase: "empty" });
          return;
        }
        const requestedItemId = consumePendingReviewItemId();
        const first = requestedItemId ? await fetchItem(requestedItemId) : await fetchNextItem(null);
        if (first) {
          setState({ phase: "reviewing", item: first });
          dispatchDraft({ type: "reset", item: first });
          resetConnectionsWorkspace();
          setChangingDecision(false);
        } else {
          setState({ phase: "complete" });
        }
      } catch (err) {
        setState({ phase: "error", message: err instanceof Error ? err.message : String(err) });
      }
    })();
  }, []);

  /** The single atomic save path — used by both "Save & Next" and every decision button, per the ticket's "do not create conflicting save paths." */
  const saveDraftAndAdvance = useCallback(
    async (decisionAction: ReviewDecisionAction | null) => {
      if (state.phase !== "reviewing" || saving) return;
      setSaving(true);
      setSaveError(null);
      try {
        const payload = toPayload(draft);
        payload.decisionAction = decisionAction;
        await saveReviewDraft(state.item.id, payload);
        setJustSaved(true);
        setTimeout(() => setJustSaved(false), 2000);

        // Resume the original queue position if this item was reached
        // via a tree jump, rather than continuing from the jumped-to
        // item. If the anchor was still unreviewed, show it again — you
        // hadn't finished it; otherwise continue past it as normal.
        const next = queueAnchor
          ? queueAnchor.wasUnreviewed
            ? await fetchItem(queueAnchor.id)
            : await fetchNextItem(queueAnchor.id)
          : await fetchNextItem(state.item.id);
        if (next) {
          setState({ phase: "reviewing", item: next });
          dispatchDraft({ type: "reset", item: next });
          resetConnectionsWorkspace();
          setChangingDecision(false);
        } else {
          setState({ phase: "complete" });
        }
        setQueueAnchor(null);
        setOpenSection("identify");
        await refreshProgress();
      } catch (err) {
        // The draft is deliberately left untouched here — a failed save
        // must never lose the user's in-progress work.
        setSaveError(err instanceof Error ? err.message : String(err));
      } finally {
        setSaving(false);
      }
    },
    [state, saving, draft, queueAnchor, refreshProgress, resetConnectionsWorkspace],
  );

  const handleDecision = useCallback((action: ReviewDecisionAction) => void saveDraftAndAdvance(action), [saveDraftAndAdvance]);
  const handleSaveAndNext = useCallback(() => void saveDraftAndAdvance(null), [saveDraftAndAdvance]);

  const handlePrevious = useCallback(async () => {
    if (state.phase !== "reviewing" || saving) return;
    if (dirty && !window.confirm("You have unsaved changes for this evidence item. Discard them and go back?")) {
      return;
    }
    setSaving(true);
    try {
      // Same resume rule as Save & Next: a tree jump is a one-off
      // detour, so Previous also returns to the original queue
      // position rather than computing "previous" relative to
      // whatever the jump landed on.
      const previous = queueAnchor
        ? queueAnchor.wasUnreviewed
          ? await fetchItem(queueAnchor.id)
          : await fetchNextItem(queueAnchor.id)
        : await fetchPreviousItem(state.item.id);
      if (previous) {
        setState({ phase: "reviewing", item: previous });
        dispatchDraft({ type: "reset", item: previous });
        resetConnectionsWorkspace();
        setChangingDecision(false);
        setOpenSection("identify");
      } else {
        setTransientMessage("This is the first item.");
        setTimeout(() => setTransientMessage(null), 2000);
      }
      setQueueAnchor(null);
    } catch (err) {
      setState({ phase: "error", message: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  }, [state, saving, dirty, queueAnchor, resetConnectionsWorkspace]);

  const goToItem = useCallback(
    async (itemId: string) => {
      if (state.phase !== "reviewing" || saving || itemId === state.item.id) return;
      if (dirty && !window.confirm("You have unsaved changes for this evidence item. Discard them and switch files?")) {
        return;
      }
      setSaving(true);
      try {
        const target = await fetchItem(itemId);
        if (!target) {
          setSaveError("That evidence item could not be found.");
          return;
        }
        // Only remember the very first departure point — jumping again
        // before returning shouldn't move the anchor.
        setQueueAnchor((prev) => prev ?? { id: state.item.id, wasUnreviewed: state.item.reviewStatus === "unreviewed" });
        setState({ phase: "reviewing", item: target });
        dispatchDraft({ type: "reset", item: target });
        resetConnectionsWorkspace();
        setChangingDecision(false);
        setOpenSection("identify");
      } catch (err) {
        setState({ phase: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        setSaving(false);
      }
    },
    [state, saving, dirty, resetConnectionsWorkspace],
  );

  // Keyboard shortcuts per spec 05 (N/P/I/M/X/F). Ignored while typing in
  // a text field so single-letter shortcuts don't fire mid-sentence.
  // "L" (link) is not bound — no dedicated link-creation shortcut exists.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (state.phase !== "reviewing" || saving) return;
      const target = e.target as HTMLElement | null;
      if (target?.tagName === "TEXTAREA" || target?.tagName === "INPUT" || target?.tagName === "SELECT") return;

      // Decision shortcuts only act when a decision is actually being
      // made — either the item is still unreviewed, or the user has
      // explicitly opened "Change decision". Otherwise I/M/F/X would
      // silently re-decide an already-reviewed item you're just paging
      // back through, which is exactly the confusion this feature fixes
      // for the on-screen buttons.
      const decisionKeysActive = state.item.reviewStatus === "unreviewed" || changingDecision;

      switch (e.key.toLowerCase()) {
        case "n":
          handleSaveAndNext();
          break;
        case "p":
          void handlePrevious();
          break;
        case "i":
          if (decisionKeysActive) handleDecision("include");
          break;
        case "m":
          if (decisionKeysActive) handleDecision("maybe");
          break;
        case "f":
          if (decisionKeysActive) handleDecision("follow_up");
          break;
        case "x":
          if (decisionKeysActive) handleDecision("archive");
          break;
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [state, saving, changingDecision, handleDecision, handleSaveAndNext, handlePrevious]);

  if (state.phase === "loading") {
    return <p role="status">Loading your evidence for review…</p>;
  }

  if (state.phase === "empty") {
    return (
      <p role="status">
        No evidence has been scanned into this workspace yet. Run a scan
        first, then come back here to begin reviewing.
      </p>
    );
  }

  if (state.phase === "error") {
    return <p role="alert">{state.message} Your original files were not affected.</p>;
  }

  if (state.phase === "complete") {
    return (
      <div role="status">
        <p>Review Complete. Every evidence item has been reviewed.</p>
        {progress && (
          <p aria-label="Review progress">
            {progress.total - progress.unreviewed} of {progress.total} reviewed
            {progress.needsFollowUp > 0 && ` · ${progress.needsFollowUp} needs follow-up`}
          </p>
        )}
      </div>
    );
  }

  const item = state.item;
  const previewKind = getPreviewKind(item.extension);

  // Archive Similar is only offered when the *live* form state (including
  // unsaved edits) already matches the exact template its preset
  // requires — never a stale saved value the user has since changed on
  // screen. Deliberately a plain computation (not a hook): it depends on
  // `item`/`draft`, both only defined past the early-return phase checks
  // above, so it can't be a useMemo without violating the rules of hooks.
  // Preset-generic (shared/archiveSimilarPresets.ts) rather than a
  // hardcoded Product Mockup check, so Design Mockup gets the same
  // live-template gating for free — Product Mockup's own two questions
  // and validation call are unchanged, just driven by the registry now.
  const archiveSimilarTemplate = ((): ArchiveSimilarReviewTemplate | null => {
    if (item.reviewStatus === "excluded") return null; // already archived — nothing new to apply
    const evidenceTypeId = draft.evidenceType?.typeId ?? item.evidenceType?.typeId ?? null;
    const candidates = getArchiveSimilarPresetsForEvidenceType(evidenceTypeId);
    if (!evidenceTypeId || candidates.length === 0) return null;
    const effectiveAnswer = (questionId: string) => {
      const draftAnswer = draft.interviewAnswers[questionId];
      if (draftAnswer) return { value: draftAnswer.value, confidence: draftAnswer.confidence };
      const saved = item.answers.find((a) => a.questionId === questionId);
      return saved ? { value: saved.value, confidence: saved.confidence } : null;
    };
    // Design Mockup now has two presets sharing one evidence type
    // (unused-design vs. Earlier Logo Iterations); try each registered
    // preset in turn and use whichever one's own answer set actually
    // validates — they're mutually exclusive by construction, so at
    // most one can ever match. `optionalCopiedQuestionIds` lets a
    // preset (Earlier Logo Iterations' auto-defaulted creator) become
    // available before that one question has been answered at all.
    for (const preset of candidates) {
      const answers: Record<string, { value: string; confidence: SuggestionConfidence | null }> = {};
      let missingRequiredAnswer = false;
      for (const questionId of preset.copiedQuestionIds) {
        const answer = effectiveAnswer(questionId);
        if (!answer) {
          if (preset.optionalCopiedQuestionIds?.includes(questionId)) {
            answers[questionId] = { value: "", confidence: null };
            continue;
          }
          missingRequiredAnswer = true;
          break;
        }
        answers[questionId] = answer;
      }
      if (missingRequiredAnswer) continue;
      const validation = preset.validateTemplate({ evidenceTypeId, answers, decisionAction: "archive" });
      if (validation.valid) return { evidenceTypeId, answers, decisionAction: "archive" };
    }
    return null;
  })();
  const archiveSimilarSourcePayload = { ...toPayload(draft), decisionAction: "archive" as const };

  const sections: AccordionSection[] = [
    {
      id: "identify",
      title: "Identify",
      icon: <IdentifyIcon size={18} />,
      badge: draft.evidenceType || item.evidenceType ? <Badge tone="success">Confirmed</Badge> : undefined,
      content: (
        <EvidenceTypePanel
          item={item}
          draftEvidenceType={draft.evidenceType}
          draftAnswers={draft.interviewAnswers}
          onConfirmType={(typeId, source, confidence, reason) =>
            dispatchDraft({ type: "setEvidenceType", typeId, source, confidence, reason })
          }
          onAnswerChange={(questionId, patch) => dispatchDraft({ type: "setAnswer", questionId, patch })}
        />
      ),
    },
    {
      id: "connect",
      title: "Connect",
      icon: <LinkIcon size={18} />,
      badge:
        draft.connections.length > 0 ? (
          <Badge tone="info">{draft.connections.length}</Badge>
        ) : draft.noRelatedEvidence ? (
          <Badge tone="success">Reviewed</Badge>
        ) : undefined,
      content: (
        <ConnectionsPanel
          connections={draft.connections}
          noRelatedEvidence={draft.noRelatedEvidence}
          onRemove={(draftKey) => dispatchDraft({ type: "removeConnection", draftKey })}
          onUnmarkRemoval={(draftKey) => dispatchDraft({ type: "unmarkConnectionRemoval", draftKey })}
          onToggleNoRelatedEvidence={(value) => dispatchDraft({ type: "setNoRelatedEvidence", value })}
          onOpenWorkspace={() => setWorkspaceOpen(true)}
          triggerRef={connectTriggerRef}
        />
      ),
    },
    {
      id: "evaluate",
      title: "Evaluate",
      icon: <ScoreIcon size={18} />,
      badge: <Badge tone="info">{item.usefulness.effective.band}</Badge>,
      content: (
        <UsefulnessPanel
          item={item}
          draftOverride={draft.usefulnessOverride}
          onSetOverride={(score, band, note) => dispatchDraft({ type: "setOverride", score, band, note })}
          onRemoveOverride={() => dispatchDraft({ type: "removeOverride" })}
        />
      ),
    },
    {
      id: "details",
      title: "Details",
      icon: <DetailsIcon size={18} />,
      content: <MetadataPanel item={item} />,
    },
    {
      id: "notes",
      title: "Notes",
      icon: <NoteIcon size={18} />,
      content: (
        <NotesEditor itemId={item.id} value={draft.notes} onChange={(notes) => dispatchDraft({ type: "setNotes", notes })} />
      ),
    },
  ];

  return (
    <>
    <div className="review-with-tree">
      <GlassPanel as="aside" className="review-tree-sidebar" variant="subtle">
        <div className="review-tree-sidebar__toggle" role="tablist" aria-label="Evidence sidebar view">
          <Button
            variant={sidebarView === "tree" ? "secondary" : "tertiary"}
            aria-selected={sidebarView === "tree"}
            role="tab"
            onClick={() => setSidebarView("tree")}
          >
            Browse Files
          </Button>
          <Button
            variant={sidebarView === "reviewed" ? "secondary" : "tertiary"}
            aria-selected={sidebarView === "reviewed"}
            role="tab"
            onClick={() => setSidebarView("reviewed")}
          >
            Reviewed
          </Button>
        </div>
        {sidebarView === "tree" ? (
          <EvidenceTreePanel currentItemId={item.id} onSelectItem={(id) => void goToItem(id)} />
        ) : (
          <ReviewedFilesPanel currentItemId={item.id} onSelectItem={(id) => void goToItem(id)} />
        )}
      </GlassPanel>
      <section aria-label="Review Queue" className="review-main">
      <GlassPanel className="review-progress-strip" variant="subtle">
        <div className="review-progress-strip__bar">
          {progress && (
            <>
              <ProgressBar
                value={progress.total - progress.unreviewed}
                max={progress.total}
                label="Review progress"
              />
              <p aria-label="Review progress" style={{ marginTop: 6, font: "var(--text-metadata)", color: "var(--text-secondary)" }}>
                {progress.total - progress.unreviewed} of {progress.total} reviewed
                {progress.needsFollowUp > 0 && ` · ${progress.needsFollowUp} needs follow-up`}
              </p>
            </>
          )}
        </div>
        <IconButton
          aria-label="Keyboard shortcuts"
          icon={<InfoIcon size={18} />}
          pressed={showShortcuts}
          onClick={() => setShowShortcuts((v) => !v)}
        />
      </GlassPanel>

      {showShortcuts && (
        <GlassPanel className="shortcuts-help" variant="subtle" role="region" aria-label="Keyboard shortcuts">
          <strong>Keyboard shortcuts</strong>
          <dl>
            {SHORTCUTS.map((s) => (
              <div key={s.key} style={{ display: "contents" }}>
                <dt>
                  <kbd>{s.key}</kbd>
                </dt>
                <dd>{s.action}</dd>
              </div>
            ))}
          </dl>
        </GlassPanel>
      )}

      {transientMessage && <p role="status">{transientMessage}</p>}

      <div aria-live="polite">
        {saveError && <StatusMessage tone="error">Could not save: {saveError} Your changes were kept — try again.</StatusMessage>}
        {!saveError && justSaved && <StatusMessage tone="success">Saved</StatusMessage>}
        {!saveError && !justSaved && dirty && <StatusMessage tone="info">Unsaved changes</StatusMessage>}
      </div>

      <div className="review-layout">
        <GlassPanel className="preview-canvas" variant="strong">
          <div className="preview-canvas__header">
            <span className="preview-canvas__filename">{item.originalFilename}</span>
            <Badge tone="neutral">{previewKind}</Badge>
          </div>
          <div className="preview-canvas__body">
            <EvidenceViewer item={item} onViewMetadata={() => setOpenSection("details")} onAnalysisConfirmed={() => void handleAnalysisConfirmed()} />
          </div>
        </GlassPanel>

        <div className="review-panel">
          <Accordion sections={sections} openId={openSection} onOpenChange={setOpenSection} />
        </div>
      </div>

      <DecisionBar
        reviewStatus={item.reviewStatus}
        inclusionDecision={item.inclusionDecision}
        changingDecision={changingDecision}
        onToggleChangeDecision={() => setChangingDecision((v) => !v)}
        onDecision={handleDecision}
        onSaveAndNext={handleSaveAndNext}
        onPrevious={() => void handlePrevious()}
        hasPrevious={true}
        busy={saving}
        archiveSimilarAvailable={archiveSimilarTemplate !== null && !archiveSimilarOpen}
        onArchiveSimilar={() => setArchiveSimilarOpen(true)}
      />
      </section>
    </div>
    {archiveSimilarTemplate && (
      <ArchiveSimilarModal
        open={archiveSimilarOpen}
        sourceItemId={item.id}
        reviewTemplate={archiveSimilarTemplate}
        sourceItemPayload={archiveSimilarSourcePayload}
        onClose={() => setArchiveSimilarOpen(false)}
        onApplied={(result, archivedSource) => void handleArchiveSimilarApplied(result, archivedSource)}
      />
    )}
    {archiveSimilarToast && (
      <div className="toast-region">
        <Toast
          tone="success"
          message={archiveSimilarToast.message}
          actionLabel={archiveSimilarToast.operationId !== null ? "Undo" : undefined}
          onAction={archiveSimilarToast.operationId !== null ? () => void handleUndoArchiveSimilar(archiveSimilarToast.operationId!) : undefined}
          onDismiss={() => setArchiveSimilarToast(null)}
        />
      </div>
    )}
    <ConnectionsWorkspace
      open={workspaceOpen}
      currentItem={{
        id: item.id,
        originalFilename: item.originalFilename,
        extension: item.extension,
        evidenceTypeId: draft.evidenceType?.typeId ?? item.evidenceType?.typeId ?? null,
      }}
      connections={draft.connections}
      state={workspaceState}
      onSearchChange={(text) => setWorkspaceState((s) => setSearchText(s, text))}
      onFilterChange={(key, value) => setWorkspaceState((s) => setFilter(s, key, value))}
      onClearFilters={() => setWorkspaceState((s) => clearFilters(s))}
      onSortChange={(field) => setWorkspaceState((s) => setSort(s, field))}
      onToggleCandidate={(candidate) => setWorkspaceState((s) => toggleSelectedCandidate(s, candidate))}
      onAddManual={(path) => setWorkspaceState((s) => addManualSelected(s, path))}
      onUpdateSelected={(key, patch) => setWorkspaceState((s) => updateSelectedCandidate(s, key, patch))}
      onRemoveSelected={(key) => setWorkspaceState((s) => removeSelectedCandidate(s, key))}
      onScrollTopChange={(value) => setWorkspaceState((s) => setScrollTop(s, value))}
      onPreviewCandidate={(id) => setWorkspaceState((s) => setPreviewCandidateId(s, id))}
      onLinkAll={handleLinkAllConnections}
      onClose={closeConnectionsWorkspace}
    />
    </>
  );
}
