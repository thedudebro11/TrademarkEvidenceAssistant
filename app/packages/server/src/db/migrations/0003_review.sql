-- Phase 3 schema: the Review Queue's decision and autosave fields.
--
-- Vocabulary reconciliation (documented per the instruction to explain,
-- not silently resolve, drift between governing documents): spec 05
-- names the four review decisions "Include / Maybe / Follow-Up / Not
-- Useful"; docs/USER_JOURNEY.md's Review Queue button list instead says
-- "Include, Maybe, Needs Follow-Up, Archive". These are the same
-- workflow with two different user-facing labels for the fourth
-- decision. Resolution: the existing review_status enum (spec 03) value
-- 'excluded' is reused unchanged for that outcome — it was already
-- defined in Phase 1 and matches spec 03's contract — while the web UI
-- displays the button as "Archive" per USER_JOURNEY.md's calmer,
-- plainer language (docs/DESIGN_LANGUAGE.md: "prefer plain language").
-- Internal state name and user-facing label are allowed to differ; no
-- schema value named "archive" or "not_useful_button" was introduced.
--
-- review_status (existing, spec 03) already distinguishes
-- reviewed/needs_follow_up/excluded, but "reviewed" alone can't tell
-- Include and Maybe apart. inclusion_decision adds that.
ALTER TABLE evidence_items ADD COLUMN inclusion_decision TEXT;
ALTER TABLE evidence_items ADD COLUMN notes TEXT;
ALTER TABLE evidence_items ADD COLUMN decided_at TEXT;
ALTER TABLE evidence_items ADD COLUMN notes_updated_at TEXT;
