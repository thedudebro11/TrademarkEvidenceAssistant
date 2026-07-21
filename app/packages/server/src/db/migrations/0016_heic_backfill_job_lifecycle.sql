-- HEIC backfill job lifecycle hardening.
--
-- `created_at` is distinct from `started_at`: with overlapping-job
-- prevention (heicPreviewService.ts), a request that reuses an existing
-- active job never inserts a new row, so `started_at` on the row a
-- caller ends up polling can predate that specific request by a while.
-- SQLite's ALTER TABLE ADD COLUMN rejects a non-constant DEFAULT (e.g.
-- `datetime('now')`) — verified directly against this project's actual
-- better-sqlite3 build, which errors with "Cannot add a column with
-- non-constant default" — so this column is added nullable and
-- backfilled from `started_at` (the closest available proxy: under the
-- current architecture a job always starts processing immediately after
-- being created, so the two timestamps coincide for every pre-existing
-- row). Every row inserted after this migration gets `created_at` set
-- explicitly at INSERT time by heicPreviewService.ts — a runtime
-- `datetime('now')` in an INSERT statement's VALUES has no such
-- restriction, only a column-level DEFAULT clause does.
--
-- `error` captures why a job ended in 'failed' or 'interrupted' — no
-- equivalent existed before; a truly unexpected exception in the
-- background IIFE had nowhere to record its message.
--
-- No CHECK constraint on `status`: it was a bare TEXT column before this
-- migration too, so 'completed_with_failures' and 'interrupted' (new
-- terminal states — see HeicBackfillJobStatus in shared/models.ts) need
-- no schema change to become legal values, only these two new columns.
ALTER TABLE heic_backfill_jobs ADD COLUMN created_at TEXT;
ALTER TABLE heic_backfill_jobs ADD COLUMN error TEXT;

UPDATE heic_backfill_jobs SET created_at = started_at WHERE created_at IS NULL;
