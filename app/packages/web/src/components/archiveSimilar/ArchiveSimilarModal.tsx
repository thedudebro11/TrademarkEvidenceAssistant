import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ArchiveSimilarApplyResponse,
  ArchiveSimilarPreviewResponse,
  ArchiveSimilarReviewTemplate,
  ReviewDraftPayload,
  SuggestionConfidence,
} from "@trademark-evidence-assistant/shared";
import {
  DESIGN_MOCKUP_EVIDENCE_TYPE_ID,
  DESIGN_MOCKUP_QUESTION_IDS,
  getArchiveSimilarPreset,
  getEvidenceType,
  getInterviewForType,
  resolveArchiveSimilarPreset,
} from "@trademark-evidence-assistant/shared";
import { applyArchiveSimilar, previewArchiveSimilar } from "../../api.js";
import { Badge } from "../ui/Badge.js";
import { Button } from "../ui/Button.js";
import { IconButton } from "../ui/IconButton.js";
import { CloseIcon } from "../ui/icons.js";

interface ArchiveSimilarModalProps {
  open: boolean;
  sourceItemId: string;
  reviewTemplate: ArchiveSimilarReviewTemplate;
  /** The source item's own complete, live Review Draft payload (decisionAction already "archive") — sent only when "Also save and archive the current file" is checked, so any unsaved notes/connections/override are preserved rather than reconstructed. */
  sourceItemPayload: ReviewDraftPayload;
  onClose: () => void;
  onApplied: (result: ArchiveSimilarApplyResponse, archivedSource: boolean) => void;
}

/** A fresh id per modal open — reused across retries after a failed apply (so a retry safely hits the server's idempotency check) but never reused across two separate opens of the modal. */
function newIdempotencyKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `archive-similar-${Date.now()}-${Math.random()}`;
}

const DATE_CONFIDENCE_OPTIONS: SuggestionConfidence[] = ["medium", "high", "low"];
const DATE_CONFIDENCE_LABELS: Record<SuggestionConfidence, string> = { medium: "Medium — default", high: "High", low: "Low" };

/**
 * The Archive Similar confirmation modal (docs/ADR_0004_ARCHIVE_SIMILAR.md,
 * extended for Design Mockup). Fetches a server-computed preview on
 * open — the eligible/excluded split, and (for Design Mockup) every
 * candidate's derived filesystem date, are never decided client-side,
 * per the "server independently re-checks eligibility and re-derives
 * dates" requirement. Selection state lives here only; the actual
 * apply/undo/audit/navigation behavior is owned by ReviewQueue.tsx via
 * `onApplied`, matching this app's existing "modal is a thin controlled
 * view" pattern (see ConnectionsWorkspace.tsx).
 *
 * Product Mockup's "Review to apply" summary keeps its own hand-written
 * copy exactly as before (unchanged rendering, unchanged text) — Design
 * Mockup's summary is registry-driven instead (its question text has no
 * prior hardcoded copy to preserve), per "don't hardcode UI wording
 * where a stable registry id already exists."
 */
export function ArchiveSimilarModal({ open, sourceItemId, reviewTemplate, sourceItemPayload, onClose, onApplied }: ArchiveSimilarModalProps) {
  const [preview, setPreview] = useState<ArchiveSimilarPreviewResponse | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [archiveCurrentItem, setArchiveCurrentItem] = useState(true);
  const [searchText, setSearchText] = useState("");
  const [dateConfidence, setDateConfidence] = useState<SuggestionConfidence>("medium");
  const [creatorOverride, setCreatorOverride] = useState("");
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const idempotencyKeyRef = useRef(newIdempotencyKey());

  // Resolved the same way the server resolves it (shared/archiveSimilarPresets.ts's
  // resolveArchiveSimilarPreset) rather than by evidence type id alone —
  // Design Mockup now has two presets sharing one evidence type, and
  // `reviewTemplate` (built by ReviewQueue from the already-validated
  // live answers) always resolves to exactly the same preset the button
  // itself validated against. Falls back to Product Mockup only as a
  // defensive default; in practice this modal is never rendered unless
  // a preset already resolved successfully upstream.
  const preset = resolveArchiveSimilarPreset(reviewTemplate.evidenceTypeId, reviewTemplate.answers, reviewTemplate.decisionAction) ?? getArchiveSimilarPreset("product_mockup");
  const isDesignMockup = reviewTemplate.evidenceTypeId === DESIGN_MOCKUP_EVIDENCE_TYPE_ID;

  useEffect(() => {
    if (!open) return;
    idempotencyKeyRef.current = newIdempotencyKey();
    setPreview(null);
    setPreviewError(null);
    setApplyError(null);
    setSearchText("");
    setDateConfidence("medium");
    // Defaults to the source's own existing creator answer when
    // non-blank ("do not overwrite an existing nonblank creator answer
    // without showing it to the user" — showing it here, pre-filled and
    // editable, satisfies that literally); only falls back to the
    // preset's defaultCreator when the source's own answer is blank.
    if (preset.defaultCreator !== undefined) {
      const existing = reviewTemplate.answers[DESIGN_MOCKUP_QUESTION_IDS.creator]?.value?.trim();
      setCreatorOverride(existing || preset.defaultCreator);
    }
    let cancelled = false;
    previewArchiveSimilar(sourceItemId, reviewTemplate)
      .then((result) => {
        if (cancelled) return;
        setPreview(result);
        setSelectedIds(new Set(result.eligible.map((e) => e.itemId)));
      })
      .catch((err) => {
        if (!cancelled) setPreviewError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sourceItemId]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !applying) {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === "Tab" && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
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
  }, [open, applying, onClose]);

  const visibleEligible = useMemo(() => {
    if (!preview) return [];
    const q = searchText.trim().toLowerCase();
    if (!q) return preview.eligible;
    return preview.eligible.filter((e) => e.filename.toLowerCase().includes(q));
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

  function selectAllEligible() {
    if (!preview) return;
    setSelectedIds(new Set(preview.eligible.map((e) => e.itemId)));
  }

  function deselectAll() {
    setSelectedIds(new Set());
  }

  async function handleConfirm() {
    if (applying) return;
    setApplying(true);
    setApplyError(null);
    try {
      // For a preset with a default creator (Earlier Logo Iterations),
      // the modal's own chosen creator value — not whatever the source
      // form happened to hold — is what gets applied to every target
      // (per "Apply creator = selected modal creator value") and to the
      // source item itself when it's archived alongside them.
      const finalCreator = preset.defaultCreator !== undefined ? creatorOverride.trim() || preset.defaultCreator : null;
      const effectiveTemplate =
        finalCreator !== null
          ? { ...reviewTemplate, answers: { ...reviewTemplate.answers, [DESIGN_MOCKUP_QUESTION_IDS.creator]: { value: finalCreator, confidence: "high" as const } } }
          : reviewTemplate;
      const effectiveSourcePayload =
        finalCreator !== null
          ? {
              ...sourceItemPayload,
              interviewAnswers: {
                ...sourceItemPayload.interviewAnswers,
                [DESIGN_MOCKUP_QUESTION_IDS.creator]: { value: finalCreator, confidence: "high" as const, note: null },
              },
            }
          : sourceItemPayload;
      const result = await applyArchiveSimilar(sourceItemId, {
        selectedItemIds: [...selectedIds],
        reviewTemplate: effectiveTemplate,
        archiveCurrentItem,
        sourceItemPayload: archiveCurrentItem ? effectiveSourcePayload : undefined,
        previewToken: preview?.previewToken,
        idempotencyKey: idempotencyKeyRef.current,
        dateConfidence: isDesignMockup ? dateConfidence : undefined,
      });
      onApplied(result, archiveCurrentItem);
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : String(err));
    } finally {
      setApplying(false);
    }
  }

  const everProducedAnswer = reviewTemplate.answers.product_mockup_ever_produced;
  const matchingRecordAnswer = reviewTemplate.answers.product_mockup_matching_record;
  const canConfirm = !applying && preview !== null && (selectedIds.size > 0 || archiveCurrentItem);
  const confirmLabel = preset.confirmLabel(selectedIds.size);
  const derivedQuestionId = preview?.derivedField?.questionId ?? null;
  const interviewQuestions = getInterviewForType(reviewTemplate.evidenceTypeId);
  const questionText = (questionId: string) => interviewQuestions.find((q) => q.id === questionId)?.text ?? questionId;

  return (
    <div className="archive-similar-modal">
      <div className="archive-similar-modal__backdrop" onClick={() => !applying && onClose()} />
      <div ref={dialogRef} className="archive-similar-modal__dialog" role="dialog" aria-modal="true" aria-label={preset.modalTitle}>
        <header className="archive-similar-modal__header">
          <div>
            <strong>{preset.modalTitle}</strong>
            <p className="archive-similar-modal__subtitle">{preset.modalDescription}</p>
          </div>
          <IconButton aria-label="Close" icon={<CloseIcon size={20} />} onClick={onClose} disabled={applying} />
        </header>

        {previewError && <p role="alert">Could not load eligible files: {previewError}</p>}
        {!previewError && !preview && <p role="status">Checking which files are eligible…</p>}

        {preview && (
          <div className="archive-similar-modal__body">
            <section className="archive-similar-modal__summary" aria-label="Review to apply">
              <h3>Review to apply</h3>
              {isDesignMockup ? (
                <dl>
                  <dt>Evidence type</dt>
                  <dd>{getEvidenceType(reviewTemplate.evidenceTypeId)?.displayName ?? reviewTemplate.evidenceTypeId}</dd>
                  {preset.copiedQuestionIds.map((questionId) => {
                    // Editable, not a static readout, for the one
                    // question this preset auto-defaults — changing it
                    // here updates both this summary and the value sent
                    // for the whole operation (see handleConfirm).
                    if (questionId === DESIGN_MOCKUP_QUESTION_IDS.creator && preset.defaultCreator !== undefined) {
                      return (
                        <div key={questionId} style={{ display: "contents" }}>
                          <dt>
                            <label htmlFor="archive-similar-creator">{questionText(questionId)}</label>
                          </dt>
                          <dd>
                            <input id="archive-similar-creator" value={creatorOverride} onChange={(e) => setCreatorOverride(e.target.value)} /> — high confidence
                          </dd>
                        </div>
                      );
                    }
                    const answer = reviewTemplate.answers[questionId];
                    return (
                      <div key={questionId} style={{ display: "contents" }}>
                        <dt>{questionText(questionId)}</dt>
                        <dd>
                          {answer?.value} — {answer?.confidence} confidence
                        </dd>
                      </div>
                    );
                  })}
                  <dt>Result</dt>
                  <dd>Excluded / not evidence of commercial use</dd>
                </dl>
              ) : (
                <dl>
                  <dt>Evidence type</dt>
                  <dd>{getEvidenceType(reviewTemplate.evidenceTypeId)?.displayName ?? reviewTemplate.evidenceTypeId}</dd>
                  <dt>Became a real physical product</dt>
                  <dd>
                    {everProducedAnswer?.value} — {everProducedAnswer?.confidence} confidence
                  </dd>
                  <dt>Finished-product photo available</dt>
                  <dd>
                    {matchingRecordAnswer?.value} — {matchingRecordAnswer?.confidence} confidence
                  </dd>
                  <dt>Result</dt>
                  <dd>Excluded / not evidence of commercial use</dd>
                </dl>
              )}
              <p className="archive-similar-modal__scope">
                Scope: eligible unreviewed images in <strong>{preview.scope.folderPath || "(root)"}</strong>
              </p>
              <p>
                Eligible files: <strong>{preview.eligibleCount}</strong> · Protected or excluded files: <strong>{preview.excludedCount}</strong>
              </p>
            </section>

            {isDesignMockup && derivedQuestionId && (
              // No aria-label here — the enclosed <label>/<select> pair
              // already provides "Confidence in filesystem dates" as an
              // accessible name; a matching aria-label on this wrapper
              // would give getByLabelText/testing-library two identically
              // named matches for one control.
              <section className="archive-similar-modal__date-confidence">
                <label htmlFor="archive-similar-date-confidence">Confidence in filesystem dates</label>
                <select
                  id="archive-similar-date-confidence"
                  value={dateConfidence}
                  onChange={(e) => setDateConfidence(e.target.value as SuggestionConfidence)}
                >
                  {DATE_CONFIDENCE_OPTIONS.map((c) => (
                    <option key={c} value={c}>
                      {DATE_CONFIDENCE_LABELS[c]}
                    </option>
                  ))}
                </select>
                <p className="archive-similar-modal__date-confidence-help">
                  Filesystem dates help establish a timeline but may change when files are copied, exported, or edited.
                </p>
              </section>
            )}

            <section className="archive-similar-modal__eligible" aria-label="Eligible files">
              <div className="archive-similar-modal__eligible-toolbar">
                <label htmlFor="archive-similar-search">Search eligible files</label>
                <input id="archive-similar-search" value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="Filter by filename" />
                <Button variant="tertiary" onClick={selectAllEligible} disabled={preview.eligible.length === 0}>
                  Select all eligible
                </Button>
                <Button variant="tertiary" onClick={deselectAll} disabled={selectedIds.size === 0}>
                  Deselect all
                </Button>
              </div>

              {preview.eligible.length === 0 && <p role="status">No other eligible files were found.</p>}

              <ul className="archive-similar-modal__eligible-list" role="group" aria-label="Select files to archive">
                {visibleEligible.map((item) => {
                  const derived = derivedQuestionId ? item.derivedAnswers?.[derivedQuestionId] : undefined;
                  return (
                    <li key={item.itemId}>
                      <label>
                        <input type="checkbox" checked={selectedIds.has(item.itemId)} onChange={() => toggleSelected(item.itemId)} />
                        <span>{item.filename}</span>
                        <Badge tone="neutral">{item.evidenceTypeId ? getEvidenceType(item.evidenceTypeId)?.displayName ?? item.evidenceTypeId : "Unclassified"}</Badge>
                        <Badge tone="neutral">{item.reviewStatus.replace(/_/g, " ")}</Badge>
                      </label>
                      {derived && (
                        <p className="archive-similar-modal__derived-date">
                          Created date: <strong>{derived.value}</strong> · Source: Filesystem last-modified date
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>

            {preview.excluded.length > 0 && (
              <details className="archive-similar-modal__excluded">
                <summary>Protected or excluded files ({preview.excluded.length})</summary>
                <ul>
                  {preview.excluded.map((item) => (
                    <li key={item.itemId}>
                      <span>{item.filename}</span> — <small>{item.reasonLabel}</small>
                    </li>
                  ))}
                </ul>
              </details>
            )}

            <label className="archive-similar-modal__archive-current">
              <input type="checkbox" checked={archiveCurrentItem} onChange={(e) => setArchiveCurrentItem(e.target.checked)} />
              Also save and archive the current file
            </label>

            {applyError && <p role="alert">Could not complete this operation: {applyError} Nothing was changed for files not yet processed.</p>}

            <div className="archive-similar-modal__footer">
              <Button variant="tertiary" onClick={onClose} disabled={applying}>
                Cancel
              </Button>
              <Button variant="primary" onClick={() => void handleConfirm()} disabled={!canConfirm}>
                {applying ? "Applying…" : confirmLabel}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
