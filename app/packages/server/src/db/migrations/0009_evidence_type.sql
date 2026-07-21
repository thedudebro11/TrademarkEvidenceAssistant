-- Phase 3.5 schema: the Evidence Classification Framework's confirmed
-- type assignment. `evidence_type_registry_version` freezes which
-- registry version a confirmation was made against (never silently
-- reinterpret historical reviews if the registry changes later).
--
-- Interview answers reuse the existing `review_answers` table
-- (migration 0004) rather than a new table — its schema (item id,
-- question id, value/source/confidence/note/answered_at) is already
-- generic enough for per-evidence-type questions, and Phase 3.5's own
-- Part 7 explicitly calls for "no duplicated configuration."
ALTER TABLE evidence_items ADD COLUMN evidence_type_id TEXT;
ALTER TABLE evidence_items ADD COLUMN evidence_type_registry_version TEXT;
ALTER TABLE evidence_items ADD COLUMN evidence_type_confidence TEXT;
ALTER TABLE evidence_items ADD COLUMN evidence_type_reason TEXT;
ALTER TABLE evidence_items ADD COLUMN evidence_type_source TEXT;
ALTER TABLE evidence_items ADD COLUMN evidence_type_confirmed_at TEXT;
