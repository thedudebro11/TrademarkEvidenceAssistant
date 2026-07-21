import { describe, expect, it } from "vitest";
import { getConnectionsReviewState } from "./models.js";

describe("getConnectionsReviewState — 'No Related Evidence' workflow", () => {
  it("not_reviewed: never evaluated (flag false, no connections)", () => {
    expect(getConnectionsReviewState(false, 0)).toBe("not_reviewed");
  });

  it("reviewed_no_connections: the reviewer explicitly determined none exist", () => {
    expect(getConnectionsReviewState(true, 0)).toBe("reviewed_no_connections");
  });

  it("reviewed_with_connections: at least one connection exists", () => {
    expect(getConnectionsReviewState(false, 1)).toBe("reviewed_with_connections");
    expect(getConnectionsReviewState(false, 3)).toBe("reviewed_with_connections");
  });

  it("test 7 — a pre-existing item with connections reads as reviewed_with_connections even if the flag column defaults to false (migration safety, no backfill needed)", () => {
    // Simulates a row from before migration 0010 — no_related_evidence
    // defaults to 0/false, but the item already has real connections.
    expect(getConnectionsReviewState(false, 2)).toBe("reviewed_with_connections");
  });

  it("connections always win over a stale 'no related evidence' flag — the two states must never coexist", () => {
    // Should be structurally unreachable (the write paths enforce this),
    // but the derivation itself is defensive: if it ever happened,
    // connections existing takes precedence over the flag.
    expect(getConnectionsReviewState(true, 1)).toBe("reviewed_with_connections");
  });
});
