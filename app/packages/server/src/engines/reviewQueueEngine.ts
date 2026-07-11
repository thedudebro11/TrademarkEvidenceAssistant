import type { ReviewStatus } from "@trademark-evidence-assistant/shared";

/**
 * Pure navigation/progress logic for the Review Queue
 * (docs/ARCHITECTURE_CONSTITUTION.md #3 — the Review Engine owns
 * Next/Previous/Progress; the UI only displays its state). No DB, no
 * HTTP — takes plain arrays so it's fast and trivial to unit test.
 */

export interface QueueItem {
  id: string;
  reviewStatus: ReviewStatus;
}

/**
 * Finds the next item with review_status 'unreviewed', scanning forward
 * from just after `currentId`'s position in the *full* ordered list
 * (not a pre-filtered one). This matters: if the caller just recorded a
 * decision on `currentId` (changing its status away from 'unreviewed'),
 * it must still be findable by id to know where to resume scanning from
 * — a list pre-filtered to unreviewed-only would have already dropped
 * it, breaking navigation right after every decision.
 */
export function pickNextUnreviewed(items: QueueItem[], currentId: string | null): string | null {
  const startIndex =
    currentId === null ? 0 : items.findIndex((item) => item.id === currentId) + 1;
  for (let i = Math.max(startIndex, 0); i < items.length; i++) {
    if (items[i].reviewStatus === "unreviewed") {
      return items[i].id;
    }
  }
  return null;
}

/**
 * Returns the id immediately before `currentId` in the full ordered
 * list, regardless of status — Previous means "show me what I just
 * looked at," not "show me the previous unreviewed item."
 */
export function pickPrevious(items: { id: string }[], currentId: string | null): string | null {
  if (currentId === null) {
    return null;
  }
  const index = items.findIndex((item) => item.id === currentId);
  if (index <= 0) {
    return null;
  }
  return items[index - 1].id;
}

export interface ReviewProgressCounts {
  total: number;
  unreviewed: number;
  reviewed: number;
  needsFollowUp: number;
  excluded: number;
}

/** Tallies review_status values into the progress summary the UI displays. */
export function computeProgress(statuses: ReviewStatus[]): ReviewProgressCounts {
  const counts: ReviewProgressCounts = {
    total: statuses.length,
    unreviewed: 0,
    reviewed: 0,
    needsFollowUp: 0,
    excluded: 0,
  };
  for (const status of statuses) {
    if (status === "unreviewed") counts.unreviewed++;
    else if (status === "reviewed") counts.reviewed++;
    else if (status === "needs_follow_up") counts.needsFollowUp++;
    else if (status === "excluded") counts.excluded++;
    // 'in_review' is intentionally untracked as its own bucket in v1 —
    // no UI action currently sets it.
  }
  return counts;
}
