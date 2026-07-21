import type { InclusionDecision, ReviewDecisionAction, ReviewStatus } from "@trademark-evidence-assistant/shared";
import { Button } from "./components/ui/Button.js";
import { Badge } from "./components/ui/Badge.js";
import { AlertIcon, CheckCircleIcon, ChevronRightIcon, DuplicateIcon, InfoIcon, LayersIcon } from "./components/ui/icons.js";

interface DecisionBarProps {
  reviewStatus: ReviewStatus;
  inclusionDecision: InclusionDecision | null;
  /** True while the user has explicitly asked to change an already-recorded decision. */
  changingDecision: boolean;
  onToggleChangeDecision: () => void;
  onDecision: (action: ReviewDecisionAction) => void;
  onSaveAndNext: () => void;
  onPrevious: () => void;
  hasPrevious: boolean;
  busy: boolean;
  /** Only shown when the current (possibly unsaved) review matches the concept-only Product Mockup template — see shared/archiveSimilarEligibility.ts's validateProductMockupTemplate. */
  archiveSimilarAvailable: boolean;
  onArchiveSimilar: () => void;
}

/** Exported for reuse by EvidenceTreePanel, so the tree's status icons and this bar's status readout can never disagree — one place defines what each combination means. */
export function decisionStatus(reviewStatus: ReviewStatus, inclusionDecision: InclusionDecision | null) {
  if (reviewStatus === "excluded") return { label: "Archived", icon: <DuplicateIcon size={17} /> };
  if (reviewStatus === "needs_follow_up") return { label: "Needs Follow-Up", icon: <AlertIcon size={17} /> };
  if (inclusionDecision === "include") return { label: "Included", icon: <CheckCircleIcon size={17} /> };
  if (inclusionDecision === "maybe") return { label: "Marked Maybe", icon: <InfoIcon size={17} /> };
  return null;
}

/**
 * Presentation only — every action is delegated to the parent's
 * handlers. Once an item already has a recorded decision, the four
 * decision buttons are replaced with a plain status readout (so paging
 * back through already-reviewed items via Previous doesn't look like
 * they still need action) plus a "Change decision" toggle that reveals
 * the buttons again — an already-recorded decision is never a dead end.
 * Each decision (and its status readout) is distinguishable by label
 * and icon, never color alone (docs/ui/UI_DESIGN_SYSTEM.md "Decision
 * buttons") — the status view reuses the exact same icon as the button
 * that produced it.
 */
export function DecisionBar({
  reviewStatus,
  inclusionDecision,
  changingDecision,
  onToggleChangeDecision,
  onDecision,
  onSaveAndNext,
  onPrevious,
  hasPrevious,
  busy,
  archiveSimilarAvailable,
  onArchiveSimilar,
}: DecisionBarProps) {
  const status = decisionStatus(reviewStatus, inclusionDecision);
  const showButtons = !status || changingDecision;

  return (
    <div role="group" aria-label="Review decision" className="decision-dock glass-surface glass-surface--floating">
      <Button variant="tertiary" onClick={onPrevious} disabled={!hasPrevious || busy}>
        Previous
      </Button>

      {status && !changingDecision && (
        <div className="decision-dock__status">
          <Badge tone="success" icon={status.icon}>
            {status.label}
          </Badge>
          <Button variant="tertiary" onClick={onToggleChangeDecision} disabled={busy}>
            Change decision
          </Button>
        </div>
      )}

      {showButtons && (
        <div className="decision-dock__primary">
          <Button variant="secondary" icon={<CheckCircleIcon size={17} />} onClick={() => onDecision("include")} disabled={busy}>
            Include
          </Button>
          <Button variant="secondary" icon={<InfoIcon size={17} />} onClick={() => onDecision("maybe")} disabled={busy}>
            Maybe
          </Button>
          <Button variant="secondary" icon={<AlertIcon size={17} />} onClick={() => onDecision("follow_up")} disabled={busy}>
            Needs Follow-Up
          </Button>
          <Button variant="secondary" icon={<DuplicateIcon size={17} />} onClick={() => onDecision("archive")} disabled={busy}>
            Archive
          </Button>
          {archiveSimilarAvailable && (
            <Button
              variant="secondary"
              icon={<LayersIcon size={17} />}
              onClick={onArchiveSimilar}
              disabled={busy}
              title="Apply this review to matching files and archive them."
            >
              Archive Similar
            </Button>
          )}
          {status && changingDecision && (
            <Button variant="tertiary" onClick={onToggleChangeDecision} disabled={busy}>
              Cancel
            </Button>
          )}
        </div>
      )}

      <Button variant="primary" icon={<ChevronRightIcon size={17} />} onClick={onSaveAndNext} disabled={busy}>
        Save &amp; Next
      </Button>
    </div>
  );
}
