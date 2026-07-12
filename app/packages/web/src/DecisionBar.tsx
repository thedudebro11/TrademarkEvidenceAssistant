import type { ReviewDecisionAction } from "@trademark-evidence-assistant/shared";
import { Button } from "./components/ui/Button.js";
import { AlertIcon, CheckCircleIcon, ChevronRightIcon, DuplicateIcon, InfoIcon } from "./components/ui/icons.js";

interface DecisionBarProps {
  onDecision: (action: ReviewDecisionAction) => void;
  onSaveAndNext: () => void;
  onPrevious: () => void;
  hasPrevious: boolean;
  busy: boolean;
}

/**
 * Presentation only — every action is delegated to the parent's
 * handlers. Restyled as the sticky decision dock
 * (docs/ui/UI_INFORMATION_ARCHITECTURE.md "Decision dock") — every
 * button keeps its exact accessible name from Phase 3, so existing
 * behavior (and the tests describing it) stays intact. Each decision is
 * distinguishable by label and icon, never color alone
 * (docs/ui/UI_DESIGN_SYSTEM.md "Decision buttons").
 */
export function DecisionBar({ onDecision, onSaveAndNext, onPrevious, hasPrevious, busy }: DecisionBarProps) {
  return (
    <div role="group" aria-label="Review decision" className="decision-dock glass-surface glass-surface--floating">
      <Button variant="tertiary" onClick={onPrevious} disabled={!hasPrevious || busy}>
        Previous
      </Button>
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
      </div>
      <Button variant="primary" icon={<ChevronRightIcon size={17} />} onClick={onSaveAndNext} disabled={busy}>
        Save &amp; Next
      </Button>
    </div>
  );
}
