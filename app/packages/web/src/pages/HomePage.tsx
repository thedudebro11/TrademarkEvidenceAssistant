import { useCallback, useEffect, useState } from "react";
import type { RemoveMissingRecordsResponse, ReviewProgress, ScanSummary } from "@trademark-evidence-assistant/shared";
import { useAppState } from "../app/AppStateContext.js";
import { Link } from "../app/router.js";
import { fetchMissingRecordsPreview, fetchProgress, undoMissingRecordsRemoval } from "../api.js";
import { PageHeader } from "../components/layout/PageHeader.js";
import { ContentGrid } from "../components/layout/ContentGrid.js";
import { Card } from "../components/ui/Card.js";
import { GlassPanel } from "../components/ui/GlassPanel.js";
import { Button } from "../components/ui/Button.js";
import { ProgressBar } from "../components/ui/ProgressBar.js";
import { StatusMessage } from "../components/ui/StatusMessage.js";
import { Toast } from "../components/ui/Toast.js";
import { ReviewIcon, PackageIcon } from "../components/ui/icons.js";
import { MissingRecordsModal } from "../components/missingRecords/MissingRecordsModal.js";
import { ScanPanel } from "../ScanPanel.js";
import { BatchAnalysisPanel } from "../components/analysis/BatchAnalysisPanel.js";
import { ReviewSuggestionsQueue } from "../components/analysis/ReviewSuggestionsQueue.js";

/**
 * docs/ui/UI_INFORMATION_ARCHITECTURE.md Page 1 — Home. Every number
 * shown here comes from a real fetch (ReviewProgress) or from a
 * same-session operation result (ScanSummary held in local state after
 * this page triggers a scan) — there is no API to fetch "last scan/
 * export/binder" after the fact yet, so nothing here claims history
 * that doesn't exist. See docs/IMPROVEMENT_PROPOSALS.md for that gap.
 */
export function HomePage() {
  const { health } = useAppState();
  const [progress, setProgress] = useState<ReviewProgress | null>(null);
  const [lastScan, setLastScan] = useState<ScanSummary | null>(null);
  const [missingCount, setMissingCount] = useState<number | null>(null);
  const [missingModalOpen, setMissingModalOpen] = useState(false);
  const [removalToast, setRemovalToast] = useState<{ message: string; operationId: number | null } | null>(null);
  const [reviewQueueOpen, setReviewQueueOpen] = useState<{ jobId: number } | null>(null);

  const refreshProgress = useCallback(() => {
    fetchProgress()
      .then(setProgress)
      .catch(() => setProgress(null));
  }, []);

  const refreshMissingCount = useCallback(() => {
    fetchMissingRecordsPreview()
      .then((result) => setMissingCount(result.confidentlyMissing.length))
      .catch(() => setMissingCount(null));
  }, []);

  useEffect(() => {
    refreshProgress();
    refreshMissingCount();
  }, [refreshProgress, refreshMissingCount]);

  function handleRecordsRemoved(result: RemoveMissingRecordsResponse) {
    setMissingModalOpen(false);
    refreshProgress();
    refreshMissingCount();
    const parts: string[] = [];
    if (result.removedCount > 0) parts.push(`${result.removedCount} missing evidence record${result.removedCount === 1 ? "" : "s"} removed.`);
    if (result.skippedCount > 0) {
      const reasons = new Set(result.skipped.map((s) => s.reasonLabel));
      parts.push(`${result.skippedCount} ${result.skippedCount === 1 ? "was" : "were"} skipped because ${[...reasons].join("; ").toLowerCase()}.`);
    }
    if (result.removedCount === 0 && result.skippedCount === 0) parts.push("No records were removed.");
    setRemovalToast({ message: parts.join(" "), operationId: result.removedCount > 0 ? result.operationId : null });
  }

  function handleUndo() {
    if (!removalToast?.operationId) return;
    const operationId = removalToast.operationId;
    setRemovalToast(null);
    undoMissingRecordsRemoval(operationId)
      .then((result) => {
        refreshProgress();
        refreshMissingCount();
        setRemovalToast({
          message: result.restoredCount > 0 ? `Restored ${result.restoredCount} evidence record${result.restoredCount === 1 ? "" : "s"}. Undo restores the application record only. It cannot restore the deleted source file.` : "Nothing could be restored.",
          operationId: null,
        });
      })
      .catch((err) => {
        setRemovalToast({ message: `Undo failed: ${err instanceof Error ? err.message : String(err)}`, operationId: null });
      });
  }

  if (!health) {
    return (
      <>
        <PageHeader title="Home" />
        <p role="status">Connecting to the workspace…</p>
      </>
    );
  }

  const evidenceRootExists = health.workspace.evidenceRootExists;
  const hasScanned = (progress?.total ?? 0) > 0;
  const allDecided = hasScanned && progress!.unreviewed === 0;

  return (
    <>
      <PageHeader title="Home" subtitle={`Workspace: ${health.workspace.name}`} />

      {!evidenceRootExists && (
        <StatusMessage tone="warning">
          No evidence folder was found for this workspace yet. Nothing can be scanned until it exists.
        </StatusMessage>
      )}

      {evidenceRootExists && (
        <ContentGrid columns="1.6fr 1fr">
          <GlassPanel className="card" style={{ padding: "32px 34px" }} variant="strong">
            {!hasScanned ? (
              <>
                <p className="card__eyebrow">Get started</p>
                <h2 style={{ font: "var(--text-hero-title)", color: "var(--text-primary)", margin: "4px 0 10px" }}>
                  Add your evidence
                </h2>
                <p style={{ color: "var(--text-secondary)", marginBottom: 20 }}>
                  Nothing will modify your original files. Scanning only reads and fingerprints what's already in
                  your evidence folder.
                </p>
                <ScanPanel evidenceRootExists={evidenceRootExists} onScanComplete={refreshProgress} />
              </>
            ) : (
              <>
                <p className="card__eyebrow">{health.workspace.name}</p>
                <h2 style={{ font: "var(--text-hero-title)", color: "var(--text-primary)", margin: "4px 0 10px" }}>
                  {allDecided ? "Review complete" : progress!.reviewed === 0 ? "Start reviewing" : "Continue reviewing"}
                </h2>
                <p style={{ color: "var(--text-secondary)", marginBottom: 16 }}>
                  {allDecided
                    ? "Every evidence item has a decision. You're ready to prepare your package."
                    : "Review your evidence one file at a time — preview, questions, connections, and a transparent score for each item."}
                </p>
                <div style={{ marginBottom: 20 }}>
                  <ProgressBar
                    value={progress!.total - progress!.unreviewed}
                    max={progress!.total}
                    label="Review progress"
                  />
                  <p style={{ marginTop: 8, color: "var(--text-secondary)", font: "var(--text-metadata)" }}>
                    {progress!.total - progress!.unreviewed} of {progress!.total} reviewed
                  </p>
                </div>
                {allDecided ? (
                  <Link to="/prepare">
                    <Button variant="primary" icon={<PackageIcon size={18} />}>
                      Prepare Package
                    </Button>
                  </Link>
                ) : (
                  <Link to="/review">
                    <Button variant="primary" icon={<ReviewIcon size={18} />}>
                      {progress!.reviewed === 0 ? "Start Review" : "Continue Review"}
                    </Button>
                  </Link>
                )}
              </>
            )}
          </GlassPanel>

          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {hasScanned && (
              <Card title="At a glance">
                <dl style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 8px" }}>
                  <dt style={{ font: "var(--text-metadata)", color: "var(--text-secondary)" }}>Total items</dt>
                  <dd style={{ font: "650 20px/1.2 var(--font-sans)" }}>{progress!.total}</dd>
                  <dt style={{ font: "var(--text-metadata)", color: "var(--text-secondary)" }}>Reviewed</dt>
                  <dd style={{ font: "650 20px/1.2 var(--font-sans)" }}>{progress!.reviewed + progress!.excluded}</dd>
                  <dt style={{ font: "var(--text-metadata)", color: "var(--text-secondary)" }}>Needs follow-up</dt>
                  <dd style={{ font: "650 20px/1.2 var(--font-sans)" }}>{progress!.needsFollowUp}</dd>
                  {lastScan && lastScan.duplicateGroups > 0 && (
                    <>
                      <dt style={{ font: "var(--text-metadata)", color: "var(--text-secondary)" }}>Duplicate groups</dt>
                      <dd style={{ font: "650 20px/1.2 var(--font-sans)" }}>{lastScan.duplicateGroups}</dd>
                    </>
                  )}
                </dl>
              </Card>
            )}

            {hasScanned && (
              <Card title="Next steps">
                <ul style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {!allDecided && (
                    <li>
                      <Link to="/review">Continue reviewing evidence</Link>
                    </li>
                  )}
                  {progress!.needsFollowUp > 0 && (
                    <li style={{ color: "var(--text-secondary)" }}>
                      {progress!.needsFollowUp} item{progress!.needsFollowUp === 1 ? "" : "s"} marked Needs
                      Follow-Up — revisit them from Review.
                    </li>
                  )}
                  {allDecided && (
                    <li>
                      <Link to="/prepare">Generate your evidence package and binder</Link>
                    </li>
                  )}
                </ul>
              </Card>
            )}

            {hasScanned && (
              <Card eyebrow="Evidence source" title="Rescan evidence">
                <ScanPanel
                  evidenceRootExists={evidenceRootExists}
                  onScanComplete={() => {
                    refreshProgress();
                    refreshMissingCount();
                  }}
                />
                {missingCount !== null && missingCount > 0 && (
                  <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ color: "var(--text-secondary)", font: "var(--text-metadata)" }}>
                      {missingCount} missing
                    </span>
                    <Button variant="secondary" onClick={() => setMissingModalOpen(true)}>
                      Review Missing Files
                    </Button>
                  </div>
                )}
              </Card>
            )}

            {hasScanned && (
              <Card eyebrow="Evidence Intelligence" title="Batch Analysis">
                <BatchAnalysisPanel onReadyForReview={(jobId) => setReviewQueueOpen({ jobId })} />
                {reviewQueueOpen && (
                  <div style={{ marginTop: 18 }}>
                    <ReviewSuggestionsQueue jobId={reviewQueueOpen.jobId} onClose={() => setReviewQueueOpen(null)} />
                  </div>
                )}
              </Card>
            )}
          </div>
        </ContentGrid>
      )}

      <MissingRecordsModal open={missingModalOpen} onClose={() => setMissingModalOpen(false)} onRemoved={handleRecordsRemoved} />

      {removalToast && (
        <Toast
          tone={removalToast.operationId ? "success" : "info"}
          message={removalToast.message}
          actionLabel={removalToast.operationId ? "Undo" : undefined}
          onAction={removalToast.operationId ? handleUndo : undefined}
          onDismiss={() => setRemovalToast(null)}
        />
      )}
    </>
  );
}
