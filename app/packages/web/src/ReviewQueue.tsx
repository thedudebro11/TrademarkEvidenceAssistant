import { useCallback, useEffect, useRef, useState } from "react";
import { getPreviewKind, type EvidenceItemDetail, type ReviewDecisionAction, type ReviewProgress } from "@trademark-evidence-assistant/shared";
import { fetchItem, fetchNextItem, fetchPreviousItem, fetchProgress, recordDecision } from "./api.js";
import { PreviewPane } from "./PreviewPane.js";
import { MetadataPanel } from "./MetadataPanel.js";
import { DecisionBar } from "./DecisionBar.js";
import { NotesEditor, type NotesEditorHandle } from "./NotesEditor.js";
import { QuestionsPanel } from "./QuestionsPanel.js";
import { ConnectionsPanel } from "./ConnectionsPanel.js";
import { UsefulnessPanel } from "./UsefulnessPanel.js";
import { GlassPanel } from "./components/ui/GlassPanel.js";
import { ProgressBar } from "./components/ui/ProgressBar.js";
import { Badge } from "./components/ui/Badge.js";
import { IconButton } from "./components/ui/IconButton.js";
import { Accordion, type AccordionSection } from "./components/ui/Accordion.js";
import { DetailsIcon, IdentifyIcon, InfoIcon, LinkIcon, NoteIcon, ScoreIcon } from "./components/ui/icons.js";

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

/**
 * Presentation + local UI state only. Every decision, every next/
 * previous lookup, and the progress tally are computed server-side by
 * ReviewService/reviewQueueEngine — this component just displays that
 * state and forwards user actions, per
 * docs/ARCHITECTURE_CONSTITUTION.md #3. Layout restructured for
 * Evidence Studio (docs/ui/UI_INFORMATION_ARCHITECTURE.md Page 2) —
 * state machine, handlers, and keyboard shortcuts are unchanged from
 * Phase 3.
 */
export function ReviewQueue() {
  const [state, setState] = useState<QueueState>({ phase: "loading" });
  const [progress, setProgress] = useState<ReviewProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [transientMessage, setTransientMessage] = useState<string | null>(null);
  const [openSection, setOpenSection] = useState("identify");
  const [showShortcuts, setShowShortcuts] = useState(false);
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

  const goToNext = useCallback(
    async (afterId: string) => {
      setBusy(true);
      try {
        await notesRef.current?.flush();
        const next = await fetchNextItem(afterId);
        setState(next ? { phase: "reviewing", item: next } : { phase: "complete" });
        setOpenSection("identify");
        await refreshProgress();
      } catch (err) {
        setState({ phase: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        setBusy(false);
      }
    },
    [refreshProgress],
  );

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
        setOpenSection("identify");
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
  // "L" (link) is not bound — no dedicated link-creation shortcut exists.
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

  const sections: AccordionSection[] = [
    {
      id: "identify",
      title: "Identify",
      icon: <IdentifyIcon size={18} />,
      content: (
        <QuestionsPanel item={item} onRoleChange={(updated) => setState({ phase: "reviewing", item: updated })} />
      ),
    },
    {
      id: "connect",
      title: "Connect",
      icon: <LinkIcon size={18} />,
      badge: item.connections.length > 0 ? <Badge tone="info">{item.connections.length}</Badge> : undefined,
      content: (
        <ConnectionsPanel
          item={item}
          onChanged={(updated) => setState({ phase: "reviewing", item: updated })}
          refetchItem={() => fetchItem(item.id)}
        />
      ),
    },
    {
      id: "evaluate",
      title: "Evaluate",
      icon: <ScoreIcon size={18} />,
      badge: <Badge tone="info">{item.usefulness.effective.band}</Badge>,
      content: <UsefulnessPanel item={item} onChanged={(updated) => setState({ phase: "reviewing", item: updated })} />,
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
      content: <NotesEditor ref={notesRef} itemId={item.id} initialNotes={item.notes} />,
    },
  ];

  return (
    <section aria-label="Review Queue">
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

      <div className="review-layout">
        <GlassPanel className="preview-canvas" variant="strong">
          <div className="preview-canvas__header">
            <span className="preview-canvas__filename">{item.originalFilename}</span>
            <Badge tone="neutral">{previewKind}</Badge>
          </div>
          <div className="preview-canvas__body">
            <PreviewPane item={item} />
          </div>
        </GlassPanel>

        <div className="review-panel">
          <Accordion sections={sections} openId={openSection} onOpenChange={setOpenSection} />
        </div>
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
