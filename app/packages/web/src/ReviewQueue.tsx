import { useCallback, useEffect, useRef, useState } from "react";
import type { EvidenceItemDetail, ReviewDecisionAction, ReviewProgress } from "@trademark-evidence-assistant/shared";
import { fetchItem, fetchNextItem, fetchPreviousItem, fetchProgress, recordDecision } from "./api.js";
import { PreviewPane } from "./PreviewPane.js";
import { MetadataPanel } from "./MetadataPanel.js";
import { DecisionBar } from "./DecisionBar.js";
import { NotesEditor, type NotesEditorHandle } from "./NotesEditor.js";
import { ProgressSummary } from "./ProgressSummary.js";
import { QuestionsPanel } from "./QuestionsPanel.js";
import { ConnectionsPanel } from "./ConnectionsPanel.js";
import { UsefulnessPanel } from "./UsefulnessPanel.js";

type QueueState =
  | { phase: "loading" }
  | { phase: "empty" } // spec 11 "incomplete scan" — nothing to review yet
  | { phase: "reviewing"; item: EvidenceItemDetail }
  | { phase: "complete" }
  | { phase: "error"; message: string };

/**
 * Presentation + local UI state only. Every decision, every next/
 * previous lookup, and the progress tally are computed server-side by
 * ReviewService/reviewQueueEngine — this component just displays that
 * state and forwards user actions, per
 * docs/ARCHITECTURE_CONSTITUTION.md #3.
 */
export function ReviewQueue() {
  const [state, setState] = useState<QueueState>({ phase: "loading" });
  const [progress, setProgress] = useState<ReviewProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [transientMessage, setTransientMessage] = useState<string | null>(null);
  const notesRef = useRef<NotesEditorHandle>(null);

  const refreshProgress = useCallback(async () => {
    setProgress(await fetchProgress());
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const p = await fetchProgress();
        setProgress(p);
        if (p.total === 0) {
          setState({ phase: "empty" });
          return;
        }
        const first = await fetchNextItem(null);
        setState(first ? { phase: "reviewing", item: first } : { phase: "complete" });
      } catch (err) {
        setState({ phase: "error", message: err instanceof Error ? err.message : String(err) });
      }
    })();
  }, []);

  const goToNext = useCallback(async (afterId: string) => {
    setBusy(true);
    try {
      await notesRef.current?.flush();
      const next = await fetchNextItem(afterId);
      setState(next ? { phase: "reviewing", item: next } : { phase: "complete" });
      await refreshProgress();
    } catch (err) {
      setState({ phase: "error", message: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }, [refreshProgress]);

  const handleDecision = useCallback(
    async (action: ReviewDecisionAction) => {
      if (state.phase !== "reviewing") return;
      setBusy(true);
      try {
        await notesRef.current?.flush();
        await recordDecision(state.item.id, action);
        await goToNext(state.item.id);
      } catch (err) {
        setState({ phase: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        setBusy(false);
      }
    },
    [state, goToNext],
  );

  const handleSaveAndNext = useCallback(async () => {
    if (state.phase !== "reviewing") return;
    await goToNext(state.item.id);
  }, [state, goToNext]);

  const handlePrevious = useCallback(async () => {
    if (state.phase !== "reviewing") return;
    setBusy(true);
    try {
      await notesRef.current?.flush();
      const previous = await fetchPreviousItem(state.item.id);
      if (previous) {
        setState({ phase: "reviewing", item: previous });
      } else {
        setTransientMessage("This is the first item.");
        setTimeout(() => setTransientMessage(null), 2000);
      }
    } catch (err) {
      setState({ phase: "error", message: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }, [state]);

  // Keyboard shortcuts per spec 05 (N/P/I/M/X/F). Ignored while typing in
  // the notes textarea so single-letter shortcuts don't fire mid-sentence.
  // "L" (link) is not bound — Connections are Phase 5, not built yet.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (state.phase !== "reviewing" || busy) return;
      const target = e.target as HTMLElement | null;
      if (target?.tagName === "TEXTAREA" || target?.tagName === "INPUT") return;

      switch (e.key.toLowerCase()) {
        case "n":
          void handleSaveAndNext();
          break;
        case "p":
          void handlePrevious();
          break;
        case "i":
          void handleDecision("include");
          break;
        case "m":
          void handleDecision("maybe");
          break;
        case "f":
          void handleDecision("follow_up");
          break;
        case "x":
          void handleDecision("archive");
          break;
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [state, busy, handleDecision, handleSaveAndNext, handlePrevious]);

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
        {progress && <ProgressSummary progress={progress} />}
      </div>
    );
  }

  return (
    <section aria-label="Review Queue">
      {progress && <ProgressSummary progress={progress} />}
      {transientMessage && <p role="status">{transientMessage}</p>}
      <div>
        <PreviewPane item={state.item} />
      </div>
      <div>
        <MetadataPanel item={state.item} />
        <QuestionsPanel
          item={state.item}
          onRoleChange={(updated) => setState({ phase: "reviewing", item: updated })}
        />
        <ConnectionsPanel
          item={state.item}
          onChanged={(updated) => setState({ phase: "reviewing", item: updated })}
          refetchItem={() => fetchItem(state.item.id)}
        />
        <UsefulnessPanel
          item={state.item}
          onChanged={(updated) => setState({ phase: "reviewing", item: updated })}
        />
        <NotesEditor ref={notesRef} itemId={state.item.id} initialNotes={state.item.notes} />
      </div>
      <DecisionBar
        onDecision={handleDecision}
        onSaveAndNext={handleSaveAndNext}
        onPrevious={handlePrevious}
        hasPrevious={true}
        busy={busy}
      />
    </section>
  );
}
