import { describe, expect, it } from "vitest";
import { computeProgress, pickNextUnreviewed, pickPrevious } from "../reviewQueueEngine.js";
import type { QueueItem } from "../reviewQueueEngine.js";

const items: QueueItem[] = [
  { id: "a", reviewStatus: "reviewed" },
  { id: "b", reviewStatus: "unreviewed" },
  { id: "c", reviewStatus: "excluded" },
  { id: "d", reviewStatus: "unreviewed" },
  { id: "e", reviewStatus: "needs_follow_up" },
];

describe("pickNextUnreviewed", () => {
  it("returns the first unreviewed item when there is no current item", () => {
    expect(pickNextUnreviewed(items, null)).toBe("b");
  });

  it("scans forward from the current item's position for the next unreviewed one", () => {
    expect(pickNextUnreviewed(items, "b")).toBe("d");
  });

  it("returns null when there are no more unreviewed items after current", () => {
    expect(pickNextUnreviewed(items, "d")).toBeNull();
  });

  it("still finds the next unreviewed item after the current item's status has just changed (the bug this engine specifically avoids)", () => {
    const afterDecision: QueueItem[] = [
      { id: "a", reviewStatus: "reviewed" },
      { id: "b", reviewStatus: "reviewed" }, // was 'unreviewed', just decided
      { id: "c", reviewStatus: "excluded" },
      { id: "d", reviewStatus: "unreviewed" },
    ];
    // Caller asks "what's next after b" using the id of the item it just
    // decided on — b itself is no longer unreviewed, but must still be
    // findable by id so scanning resumes from the right position.
    expect(pickNextUnreviewed(afterDecision, "b")).toBe("d");
  });

  it("returns null for an unknown currentId with nothing after it in scan order", () => {
    expect(pickNextUnreviewed(items, "e")).toBeNull();
  });

  it("returns null for an empty list", () => {
    expect(pickNextUnreviewed([], null)).toBeNull();
  });
});

describe("pickPrevious", () => {
  it("returns null when currentId is null", () => {
    expect(pickPrevious(items, null)).toBeNull();
  });

  it("returns null when currentId is the first item", () => {
    expect(pickPrevious(items, "a")).toBeNull();
  });

  it("returns the immediately preceding item regardless of status", () => {
    expect(pickPrevious(items, "c")).toBe("b");
  });

  it("returns null for an id not present in the list", () => {
    expect(pickPrevious(items, "not-present")).toBeNull();
  });
});

describe("computeProgress", () => {
  it("tallies each status bucket correctly", () => {
    const counts = computeProgress(items.map((i) => i.reviewStatus));
    expect(counts).toEqual({
      total: 5,
      unreviewed: 2,
      reviewed: 1,
      needsFollowUp: 1,
      excluded: 1,
    });
  });

  it("handles an empty list", () => {
    expect(computeProgress([])).toEqual({
      total: 0,
      unreviewed: 0,
      reviewed: 0,
      needsFollowUp: 0,
      excluded: 0,
    });
  });
});
