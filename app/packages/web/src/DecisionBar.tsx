import type { ReviewDecisionAction } from "@trademark-evidence-assistant/shared";

interface DecisionBarProps {
  onDecision: (action: ReviewDecisionAction) => void;
  onSaveAndNext: () => void;
  onPrevious: () => void;
  hasPrevious: boolean;
  busy: boolean;
}

/** Presentation only — every action is delegated to the parent's handlers. */
export function DecisionBar({ onDecision, onSaveAndNext, onPrevious, hasPrevious, busy }: DecisionBarProps) {
  return (
    <div role="group" aria-label="Review decision">
      <button onClick={onPrevious} disabled={!hasPrevious || busy}>
        Previous
      </button>
      <button onClick={() => onDecision("include")} disabled={busy}>
        Include
      </button>
      <button onClick={() => onDecision("maybe")} disabled={busy}>
        Maybe
      </button>
      <button onClick={() => onDecision("follow_up")} disabled={busy}>
        Needs Follow-Up
      </button>
      <button onClick={() => onDecision("archive")} disabled={busy}>
        Archive
      </button>
      <button onClick={onSaveAndNext} disabled={busy}>
        Save &amp; Next
      </button>
    </div>
  );
}
