-- "No Related Evidence" workflow: an explicit, intentional review
-- outcome for the Connections section distinct from "never evaluated".
-- Existing rows default to 0 — safe/correct without backfill, since the
-- three-state UI derives its actual state from this flag *combined
-- with* whether the item has any connections (see
-- shared/models.ts's getConnectionsReviewState): a pre-existing item
-- that already has connections still reads as "reviewed, connections
-- added" even though this new column defaults to 0, and an untouched
-- item correctly reads as "not reviewed".
ALTER TABLE evidence_items ADD COLUMN no_related_evidence INTEGER NOT NULL DEFAULT 0;
