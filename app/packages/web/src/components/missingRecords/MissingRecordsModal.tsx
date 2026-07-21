import { useEffect, useMemo, useRef, useState } from "react";
import type { MissingRecordCandidate, MissingRecordsPreviewResponse, RemoveMissingRecordsResponse } from "@trademark-evidence-assistant/shared";
import { getEvidenceType } from "@trademark-evidence-assistant/shared";
import { fetchMissingRecordsPreview, removeMissingRecords } from "../../api.js";
import { Badge } from "../ui/Badge.js";
import { Button } from "../ui/Button.js";
import { IconButton } from "../ui/IconButton.js";
import { CloseIcon } from "../ui/icons.js";

interface MissingRecordsModalProps {
  open: boolean;
  onClose: () => void;
  /** Called once the operation completes (fully or partially) — the caller (Home page) owns the success toast, Undo action, and refreshing every count. */
  onRemoved: (result: RemoveMissingRecordsResponse) => void;
}

type Step = "select" | "confirm";

function newIdempotencyKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `missing-records-${Date.now()}-${Math.random()}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function evidenceTypeLabel(id: string | null): string {
  if (!id) return "Unclassified";
  return getEvidenceType(id)?.displayName ?? id;
}

function downloadBackupJson(backup: NonNullable<RemoveMissingRecordsResponse["backup"]>): void {
  const date = new Date().toISOString().slice(0, 10);
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `missing-evidence-backup-${date}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Home page "Review Missing Files" workflow. Two steps, per spec: (1)
 * select which confidently-missing records to remove, from a
 * server-computed, freshly-rechecked list — never a client-held
 * `isMissing` flag; (2) an explicit, separate "are you sure" step
 * naming the exact count and requiring an affirmative checkbox before
 * the actual removal request is ever sent. Submission itself is one
 * request for the whole batch (never one per item) — the server
 * rechecks every selected id's eligibility again immediately before
 * deleting anything, so a file that reappeared between opening this
 * modal and confirming is silently skipped, not removed.
 */
export function MissingRecordsModal({ open, onClose, onRemoved }: MissingRecordsModalProps) {
  const [step, setStep] = useState<Step>("select");
  const [preview, setPreview] = useState<MissingRecordsPreviewResponse | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchText, setSearchText] = useState("");
  const [exportBackup, setExportBackup] = useState(true);
  const [confirmChecked, setConfirmChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const idempotencyKeyRef = useRef(newIdempotencyKey());

  useEffect(() => {
    if (!open) return;
    idempotencyKeyRef.current = newIdempotencyKey();
    setStep("select");
    setPreview(null);
    setPreviewError(null);
    setSelectedIds(new Set());
    setSearchText("");
    setConfirmChecked(false);
    setSubmitError(null);
    let cancelled = false;
    fetchMissingRecordsPreview()
      .then((result) => {
        if (cancelled) return;
        setPreview(result);
        setSelectedIds(new Set(result.confidentlyMissing.map((c) => c.evidenceItemId)));
      })
      .catch((err) => {
        if (!cancelled) setPreviewError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !submitting) {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === "Tab" && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])');
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, submitting, onClose]);

  const visibleCandidates = useMemo(() => {
    if (!preview) return [];
    const q = searchText.trim().toLowerCase();
    const sorted = [...preview.confidentlyMissing].sort((a, b) => Number(b.hasReviewedWork) - Number(a.hasReviewedWork));
    if (!q) return sorted;
    return sorted.filter((c) => c.filename.toLowerCase().includes(q) || c.originalPath.toLowerCase().includes(q));
  }, [preview, searchText]);

  if (!open) return null;

  function toggleSelected(itemId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  function selectAll() {
    if (!preview) return;
    setSelectedIds(new Set(preview.confidentlyMissing.map((c) => c.evidenceItemId)));
  }

  function deselectAll() {
    setSelectedIds(new Set());
  }

  async function handleRemove() {
    if (submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await removeMissingRecords({
        evidenceItemIds: [...selectedIds],
        idempotencyKey: idempotencyKeyRef.current,
        confirmation: true,
        exportBackup,
      });
      if (result.backup) downloadBackupJson(result.backup);
      onRemoved(result);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  const selectedCount = selectedIds.size;

  return (
    <div className="missing-records-modal">
      <div className="missing-records-modal__backdrop" onClick={() => !submitting && onClose()} />
      <div ref={dialogRef} className="missing-records-modal__dialog" role="dialog" aria-modal="true" aria-label={step === "select" ? "Missing Evidence Files" : "Permanently Remove Missing Records?"}>
        {step === "select" && (
          <>
            <header className="missing-records-modal__header">
              <div>
                <strong>Missing Evidence Files</strong>
                <p className="missing-records-modal__subtitle">
                  These evidence records refer to source files that no longer exist at their recorded locations. Removing a record deletes it from this workspace but does not affect files
                  currently on disk.
                </p>
              </div>
              <IconButton aria-label="Close" icon={<CloseIcon size={20} />} onClick={onClose} disabled={submitting} />
            </header>

            {previewError && <p role="alert">Could not load missing records: {previewError}</p>}
            {!previewError && !preview && <p role="status">Checking which records are missing…</p>}

            {preview && (
              <div className="missing-records-modal__body">
                {preview.confidentlyMissing.length === 0 && preview.uncertain.length === 0 && <p role="status">No missing records were found.</p>}

                {preview.confidentlyMissing.length > 0 && (
                  <section aria-label="Missing records">
                    <div className="missing-records-modal__toolbar">
                      <label htmlFor="missing-records-search">Search missing files</label>
                      <input id="missing-records-search" value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="Filter by filename or path" />
                      <Button variant="tertiary" onClick={selectAll} disabled={preview.confidentlyMissing.length === 0}>
                        Select all
                      </Button>
                      <Button variant="tertiary" onClick={deselectAll} disabled={selectedIds.size === 0}>
                        Deselect all
                      </Button>
                    </div>

                    <ul className="missing-records-modal__list" role="group" aria-label="Select missing records to remove">
                      {visibleCandidates.map((c) => (
                        <MissingRecordRow key={c.evidenceItemId} candidate={c} checked={selectedIds.has(c.evidenceItemId)} onToggle={() => toggleSelected(c.evidenceItemId)} />
                      ))}
                    </ul>
                  </section>
                )}

                {preview.uncertain.length > 0 && (
                  <details className="missing-records-modal__uncertain">
                    <summary>Needs manual review — availability could not be confirmed ({preview.uncertain.length})</summary>
                    <ul>
                      {preview.uncertain.map((c) => (
                        <li key={c.evidenceItemId}>
                          <span>{c.filename}</span> — <small>{c.originalPath}</small> — <Badge tone="warning">{c.availabilityReasonCode.replace(/_/g, " ")}</Badge>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}

                <div className="missing-records-modal__footer">
                  <Button variant="tertiary" onClick={onClose}>
                    Cancel
                  </Button>
                  <Button variant="destructive" onClick={() => setStep("confirm")} disabled={selectedCount === 0}>
                    Remove {selectedCount} Missing Record{selectedCount === 1 ? "" : "s"}
                  </Button>
                </div>
              </div>
            )}
          </>
        )}

        {step === "confirm" && preview && (
          <FinalConfirmStep
            candidates={preview.confidentlyMissing.filter((c) => selectedIds.has(c.evidenceItemId))}
            exportBackup={exportBackup}
            onExportBackupChange={setExportBackup}
            confirmChecked={confirmChecked}
            onConfirmCheckedChange={setConfirmChecked}
            submitting={submitting}
            submitError={submitError}
            onBack={() => setStep("select")}
            onConfirm={() => void handleRemove()}
          />
        )}
      </div>
    </div>
  );
}

function MissingRecordRow({ candidate, checked, onToggle }: { candidate: MissingRecordCandidate; checked: boolean; onToggle: () => void }) {
  const c = candidate;
  const details = [c.answersCount > 0 ? `${c.answersCount} answer${c.answersCount === 1 ? "" : "s"}` : null, c.notesCount > 0 ? "notes" : null, c.connectionsCount > 0 ? `${c.connectionsCount} connection${c.connectionsCount === 1 ? "" : "s"}` : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <li className="missing-records-modal__row">
      <label>
        <input type="checkbox" checked={checked} onChange={onToggle} />
        <span className="missing-records-modal__filename">{c.filename}</span>
        {c.hasReviewedWork && <Badge tone="warning">Contains reviewed evidence</Badge>}
      </label>
      <div className="missing-records-modal__row-details">
        <p className="missing-records-modal__path">{c.originalPath}</p>
        <p className="missing-records-modal__meta">
          {c.folderPath || "(root)"} · {evidenceTypeLabel(c.evidenceTypeId)} · {c.reviewStatus.replace(/_/g, " ")}
          {c.inclusionDecision ? ` · ${c.inclusionDecision}` : ""} · {formatBytes(c.fileSize)}
          {c.lastKnownModifiedAt ? ` · last modified ${new Date(c.lastKnownModifiedAt).toLocaleDateString()}` : ""} · missing since{" "}
          {c.missingSince ? new Date(c.missingSince).toLocaleDateString() : "unknown"}
        </p>
        {details && <p className="missing-records-modal__meta">{details}</p>}
      </div>
    </li>
  );
}

interface FinalConfirmStepProps {
  candidates: MissingRecordCandidate[];
  exportBackup: boolean;
  onExportBackupChange: (value: boolean) => void;
  confirmChecked: boolean;
  onConfirmCheckedChange: (value: boolean) => void;
  submitting: boolean;
  submitError: string | null;
  onBack: () => void;
  onConfirm: () => void;
}

function FinalConfirmStep({ candidates, exportBackup, onExportBackupChange, confirmChecked, onConfirmCheckedChange, submitting, submitError, onBack, onConfirm }: FinalConfirmStepProps) {
  const count = candidates.length;
  const reviewedCount = candidates.filter((c) => c.hasReviewedWork).length;
  const totals = candidates.reduce(
    (acc, c) => ({
      reviewAnswers: acc.reviewAnswers + c.dependencyCounts.reviewAnswers,
      connections: acc.connections + c.dependencyCounts.connectionsOutgoing + c.dependencyCounts.connectionsIncoming,
      duplicateMemberships: acc.duplicateMemberships + c.dependencyCounts.duplicateMemberships,
      bulkOperationReferences: acc.bulkOperationReferences + c.dependencyCounts.bulkOperationReferences,
      exportReferences: acc.exportReferences + c.dependencyCounts.exportReferences,
    }),
    { reviewAnswers: 0, connections: 0, duplicateMemberships: 0, bulkOperationReferences: 0, exportReferences: 0 },
  );

  return (
    <>
      <header className="missing-records-modal__header">
        <div>
          <strong>Permanently Remove Missing Records?</strong>
          <p className="missing-records-modal__subtitle">
            This will permanently remove {count} evidence record{count === 1 ? "" : "s"} and their dependent review data from this workspace. Existing files on disk will not be changed.
          </p>
        </div>
      </header>

      <div className="missing-records-modal__body">
        {reviewedCount > 0 && (
          <p role="alert" className="missing-records-modal__reviewed-warning">
            <Badge tone="warning">Contains reviewed evidence</Badge> {reviewedCount} of the selected record{reviewedCount === 1 ? "" : "s"} contain{reviewedCount === 1 ? "s" : ""} manual review work
            (decisions, evidence type, answers, notes, or connections).
          </p>
        )}

        <section aria-label="Dependency summary">
          <h3>What will also be removed</h3>
          <dl className="missing-records-modal__dependency-summary">
            <dt>Evidence records</dt>
            <dd>{count}</dd>
            <dt>Review answers</dt>
            <dd>{totals.reviewAnswers}</dd>
            <dt>Connections</dt>
            <dd>{totals.connections}</dd>
            <dt>Duplicate-group memberships</dt>
            <dd>{totals.duplicateMemberships}</dd>
            <dt>Bulk-operation references</dt>
            <dd>{totals.bulkOperationReferences}</dd>
            <dt>Export references</dt>
            <dd>{totals.exportReferences}</dd>
          </dl>
        </section>

        <label className="missing-records-modal__backup-checkbox">
          <input type="checkbox" checked={exportBackup} onChange={(e) => onExportBackupChange(e.target.checked)} />
          Export a backup of the selected records before removal
        </label>

        <label className="missing-records-modal__confirm-checkbox">
          <input type="checkbox" checked={confirmChecked} onChange={(e) => onConfirmCheckedChange(e.target.checked)} /> I understand these evidence records will be permanently removed.
        </label>

        {submitError && <p role="alert">Could not complete this operation: {submitError} Nothing was changed.</p>}

        <div className="missing-records-modal__footer">
          <Button variant="tertiary" onClick={onBack} disabled={submitting}>
            Back
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={!confirmChecked || submitting}>
            {submitting ? "Removing…" : `Remove ${count} Missing Record${count === 1 ? "" : "s"}`}
          </Button>
        </div>
      </div>
    </>
  );
}
