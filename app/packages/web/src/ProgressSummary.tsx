import type { ReviewProgress } from "@trademark-evidence-assistant/shared";

interface ProgressSummaryProps {
  progress: ReviewProgress;
}

/**
 * Presentation only. Deliberately does not show an estimated time
 * remaining — the app has no data to base one on, and
 * docs/DESIGN_LANGUAGE.md is explicit that the software "should never
 * pretend to know more than it actually does."
 */
export function ProgressSummary({ progress }: ProgressSummaryProps) {
  const decided = progress.total - progress.unreviewed;
  return (
    <p aria-label="Review progress">
      {decided} of {progress.total} reviewed
      {progress.needsFollowUp > 0 && ` · ${progress.needsFollowUp} needs follow-up`}
    </p>
  );
}
