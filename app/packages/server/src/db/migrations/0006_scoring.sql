-- Phase 6 schema: only the user's override is persisted. The computed
-- score itself is never stored — it is recomputed fresh on every read
-- from existing answers/role/connections/duplicates (pure, deterministic,
-- can never go stale). Spec 08 requires "user override requires a note".
ALTER TABLE evidence_items ADD COLUMN usefulness_override_score INTEGER;
ALTER TABLE evidence_items ADD COLUMN usefulness_override_band TEXT;
ALTER TABLE evidence_items ADD COLUMN usefulness_override_note TEXT;
ALTER TABLE evidence_items ADD COLUMN usefulness_override_at TEXT;
