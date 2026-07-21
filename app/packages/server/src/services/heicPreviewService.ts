import { basename, join } from "node:path";
import { rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import type Database from "better-sqlite3";
import type { HeicBackfillJobStatus, HeicPreviewInfo, HeicPreviewStatus } from "@trademark-evidence-assistant/shared";
import { resolveSafePath, PathTraversalError } from "../security/pathGuard.js";
import { getHeicDecoder, getPreferredHeicDecoder, PREFERRED_DECODER_ID, type HeicDecoder } from "../engines/heicDecoders/index.js";

/**
 * HEIC/HEIF inline preview generation and caching
 * (docs/ADR_0005_HEIC_PREVIEWS.md). The original file is never read
 * for anything other than conversion input and metadata extraction —
 * this module never writes to it, renames it, or moves it. Every
 * generated preview lives under `generatedRoot` (a `heic-previews`
 * directory under `generated/<workspace>/`, already excluded from
 * evidence scanning by scannerEngine.ts's IGNORED_DIR_NAMES).
 *
 * Decoder-independent: this module never calls ImageMagick (or any
 * other decoder) directly — it calls whichever `HeicDecoder` from
 * `engines/heicDecoders/` it's given (`heicDecoders/index.ts` decides
 * which one that is). This exists because ImageMagick's HEIC delegate
 * was found to silently produce visually corrupted output for a real
 * evidence file; see `heicDecoders/libheifJsDecoder.ts`'s doc comment.
 */

export const HEIC_EXTENSIONS = new Set(["heic", "heif"]);

const MAX_SOURCE_FILE_BYTES = 100 * 1024 * 1024; // 100MB — defense in depth before ever invoking a decoder.
const DECODE_OPTIONS = { maxDimension: 2400, quality: 0.88 };

export class HeicPreviewItemNotFoundError extends Error {}
export class HeicPreviewUnknownDecoderError extends Error {}

interface EvidenceItemRow {
  id: string;
  original_path: string;
  extension: string;
  sha256: string;
  missing_since: string | null;
}

interface HeicPreviewRow {
  evidence_item_id: string;
  preview_relative_path: string | null;
  preview_mime_type: string | null;
  preview_status: string;
  preview_generated_at: string | null;
  preview_generator: string | null;
  preview_generator_version: string | null;
  source_fingerprint: string | null;
  decoder_selection: string;
  conversion_error: string | null;
}

function isHeicExtension(extension: string): boolean {
  return HEIC_EXTENSIONS.has(extension.toLowerCase().replace(/^\./, ""));
}

function getEvidenceItemRow(db: Database.Database, workspaceId: number, itemId: string): EvidenceItemRow | undefined {
  return db
    .prepare("SELECT id, original_path, extension, sha256, missing_since FROM evidence_items WHERE workspace_id = ? AND id = ?")
    .get(workspaceId, itemId) as EvidenceItemRow | undefined;
}

function getPreviewRow(db: Database.Database, itemId: string): HeicPreviewRow | undefined {
  return db.prepare("SELECT * FROM heic_previews WHERE evidence_item_id = ?").get(itemId) as HeicPreviewRow | undefined;
}

function upsertPreviewRow(
  db: Database.Database,
  itemId: string,
  fields: Partial<Omit<HeicPreviewRow, "evidence_item_id">>,
): void {
  const existing = getPreviewRow(db, itemId);
  const merged: Omit<HeicPreviewRow, "evidence_item_id"> = {
    preview_relative_path: fields.preview_relative_path ?? existing?.preview_relative_path ?? null,
    preview_mime_type: fields.preview_mime_type ?? existing?.preview_mime_type ?? null,
    preview_status: fields.preview_status ?? existing?.preview_status ?? "not_requested",
    preview_generated_at: fields.preview_generated_at !== undefined ? fields.preview_generated_at : (existing?.preview_generated_at ?? null),
    preview_generator: fields.preview_generator !== undefined ? fields.preview_generator : (existing?.preview_generator ?? null),
    preview_generator_version: fields.preview_generator_version !== undefined ? fields.preview_generator_version : (existing?.preview_generator_version ?? null),
    source_fingerprint: fields.source_fingerprint !== undefined ? fields.source_fingerprint : (existing?.source_fingerprint ?? null),
    decoder_selection: fields.decoder_selection ?? existing?.decoder_selection ?? "auto",
    conversion_error: fields.conversion_error !== undefined ? fields.conversion_error : null,
  };
  db.prepare(
    `INSERT INTO heic_previews
       (evidence_item_id, preview_relative_path, preview_mime_type, preview_status, preview_generated_at, preview_generator, preview_generator_version, source_fingerprint, decoder_selection, conversion_error, updated_at)
     VALUES (@itemId, @previewRelativePath, @previewMimeType, @previewStatus, @previewGeneratedAt, @previewGenerator, @previewGeneratorVersion, @sourceFingerprint, @decoderSelection, @conversionError, datetime('now'))
     ON CONFLICT(evidence_item_id) DO UPDATE SET
       preview_relative_path = @previewRelativePath, preview_mime_type = @previewMimeType, preview_status = @previewStatus,
       preview_generated_at = @previewGeneratedAt, preview_generator = @previewGenerator, preview_generator_version = @previewGeneratorVersion,
       source_fingerprint = @sourceFingerprint, decoder_selection = @decoderSelection, conversion_error = @conversionError, updated_at = datetime('now')`,
  ).run({
    itemId,
    previewRelativePath: merged.preview_relative_path,
    previewMimeType: merged.preview_mime_type,
    previewStatus: merged.preview_status,
    previewGeneratedAt: merged.preview_generated_at,
    previewGenerator: merged.preview_generator,
    previewGeneratorVersion: merged.preview_generator_version,
    sourceFingerprint: merged.source_fingerprint,
    decoderSelection: merged.decoder_selection,
    conversionError: merged.conversion_error,
  });
}

/**
 * The effective status a stored row represents *right now* — overriding
 * a stale "ready" row with "stale" when either (a) the source file's
 * content has changed since generation (fingerprint mismatch), or (b)
 * the row was auto-generated by a decoder that is no longer this app's
 * preferred one — e.g. every preview this feature ever produced before
 * the ImageMagick-corruption fix shipped, all of them
 * `preview_generator = 'imagemagick'`, `decoder_selection = 'auto'`.
 * That second condition is what "invalidate previews created by the
 * previous ImageMagick implementation" means in practice — no bulk
 * migration script needed, existing rows simply stop reporting "ready"
 * the next time anything reads their status. A `decoder_selection =
 * 'manual'` row (an explicit "Retry with Alternate Decoder" result) is
 * exempt from (b) — the user asked for that specific decoder, and a
 * later preference change shouldn't silently discard their choice.
 */
function effectiveStatus(row: HeicPreviewRow | undefined, evidenceItem: EvidenceItemRow): HeicPreviewStatus {
  if (evidenceItem.missing_since !== null) return "source_missing";
  if (!row) return "not_requested";
  if (row.preview_status !== "ready") return row.preview_status as HeicPreviewStatus;
  if (row.source_fingerprint !== evidenceItem.sha256) return "stale";
  if (row.decoder_selection === "auto" && row.preview_generator !== PREFERRED_DECODER_ID) return "stale";
  return "ready";
}

function toPreviewInfo(row: HeicPreviewRow | undefined, status: HeicPreviewStatus): HeicPreviewInfo {
  return {
    status,
    previewMimeType: row?.preview_mime_type ?? null,
    previewGeneratedAt: row?.preview_generated_at ?? null,
    previewGenerator: row?.preview_generator ?? null,
    previewGeneratorVersion: row?.preview_generator_version ?? null,
    decoderSelection: (row?.decoder_selection as "auto" | "manual" | undefined) ?? "auto",
    conversionError: row?.conversion_error ?? null,
  };
}

/**
 * Read-only: the current preview state for one item, without
 * triggering generation. Returns `null` for a non-HEIC/HEIF item or one
 * that doesn't exist in this workspace — `EvidenceItemDetail.heicPreview`
 * is `null` in exactly those cases.
 */
export function getHeicPreviewInfo(db: Database.Database, workspaceId: number, itemId: string): HeicPreviewInfo | null {
  const item = getEvidenceItemRow(db, workspaceId, itemId);
  if (!item || !isHeicExtension(item.extension)) return null;
  const row = getPreviewRow(db, itemId);
  return toPreviewInfo(row, effectiveStatus(row, item));
}

/** Conversions currently in flight, keyed by evidence item id — ensures a second concurrent request for the same item reuses the same in-progress conversion rather than spawning a duplicate decode. */
const inFlightConversions = new Map<string, Promise<HeicPreviewInfo>>();

export interface HeicPreviewPaths {
  evidenceRoot: string;
  generatedRoot: string;
}

export interface EnsureHeicPreviewOptions {
  /** Explicit "Retry with Alternate Decoder" request — bypasses the preferred-decoder-only automatic policy and always regenerates, recording `decoder_selection: "manual"`. */
  decoderId?: string;
  /** "Regenerate Preview" — forces a fresh attempt with the preferred decoder even if a ready, current preview already exists. Ignored when `decoderId` is set (that always regenerates). */
  force?: boolean;
}

/**
 * Ensures a ready, up-to-date preview exists for `itemId`, generating
 * one if needed (missing, previously failed, the source file's content
 * changed, the previous preview was produced by a since-superseded
 * decoder, or the caller explicitly asked for regeneration/an alternate
 * decoder). Never trusts a client-supplied path — the input file is
 * resolved from the validated, already-scanned `evidence_items.original_path`
 * via `resolveSafePath`, exactly like the existing `/evidence-items/:id/file`
 * download route.
 */
export async function ensureHeicPreview(
  db: Database.Database,
  workspaceId: number,
  itemId: string,
  paths: HeicPreviewPaths,
  options: EnsureHeicPreviewOptions = {},
): Promise<HeicPreviewInfo> {
  const item = getEvidenceItemRow(db, workspaceId, itemId);
  if (!item || !isHeicExtension(item.extension)) {
    throw new HeicPreviewItemNotFoundError(`No HEIC/HEIF evidence item ${itemId} found in this workspace`);
  }

  if (item.missing_since !== null) {
    upsertPreviewRow(db, itemId, { preview_status: "source_missing", conversion_error: "The original file can no longer be found on disk" });
    return toPreviewInfo(getPreviewRow(db, itemId), "source_missing");
  }

  let decoder: HeicDecoder;
  let selection: "auto" | "manual";
  if (options.decoderId) {
    const requested = getHeicDecoder(options.decoderId);
    if (!requested) throw new HeicPreviewUnknownDecoderError(`Unknown HEIC decoder id "${options.decoderId}"`);
    decoder = requested;
    selection = "manual";
  } else {
    const existingRow = getPreviewRow(db, itemId);
    const currentStatus = effectiveStatus(existingRow, item);
    if (currentStatus === "ready" && !options.force) {
      return toPreviewInfo(existingRow, "ready");
    }
    decoder = getPreferredHeicDecoder();
    selection = "auto";
  }

  const inFlight = inFlightConversions.get(itemId);
  if (inFlight) return inFlight;

  const job = generatePreview(db, workspaceId, item, paths, decoder, selection).finally(() => {
    inFlightConversions.delete(itemId);
  });
  inFlightConversions.set(itemId, job);
  return job;
}

async function generatePreview(
  db: Database.Database,
  workspaceId: number,
  item: EvidenceItemRow,
  paths: HeicPreviewPaths,
  decoder: HeicDecoder,
  selection: "auto" | "manual",
): Promise<HeicPreviewInfo> {
  const previousRow = getPreviewRow(db, item.id);
  upsertPreviewRow(db, item.id, { preview_status: "generating", decoder_selection: selection, conversion_error: null });

  const capability = await decoder.checkCapability().catch(
    (): { available: boolean; version: string | null; failureReason: string | null } => ({
      available: false,
      version: null,
      failureReason: "Could not determine decoder capability",
    }),
  );

  if (!capability.available) {
    upsertPreviewRow(db, item.id, {
      preview_status: "unsupported_backend",
      preview_generator: decoder.id,
      preview_generator_version: capability.version,
      decoder_selection: selection,
      conversion_error: capability.failureReason ?? "HEIC preview generation is not available on this server",
    });
    return toPreviewInfo(getPreviewRow(db, item.id), "unsupported_backend");
  }

  let absoluteInputPath: string;
  try {
    absoluteInputPath = resolveSafePath(paths.evidenceRoot, item.original_path);
  } catch (err) {
    const reason = err instanceof PathTraversalError ? "Refusing to read a file outside the evidence root" : "Could not resolve the original file's path";
    upsertPreviewRow(db, item.id, { preview_status: "failed", preview_generator: decoder.id, preview_generator_version: capability.version, decoder_selection: selection, conversion_error: reason });
    return toPreviewInfo(getPreviewRow(db, item.id), "failed");
  }

  if (!existsSync(absoluteInputPath)) {
    upsertPreviewRow(db, item.id, { preview_status: "source_missing", conversion_error: "The original file can no longer be found on disk" });
    return toPreviewInfo(getPreviewRow(db, item.id), "source_missing");
  }

  try {
    const stats = await stat(absoluteInputPath);
    if (stats.size > MAX_SOURCE_FILE_BYTES) {
      upsertPreviewRow(db, item.id, {
        preview_status: "failed",
        preview_generator: decoder.id,
        preview_generator_version: capability.version,
        decoder_selection: selection,
        conversion_error: "The original file exceeds the size limit for preview generation",
      });
      return toPreviewInfo(getPreviewRow(db, item.id), "failed");
    }
  } catch {
    upsertPreviewRow(db, item.id, { preview_status: "source_missing", conversion_error: "The original file can no longer be found on disk" });
    return toPreviewInfo(getPreviewRow(db, item.id), "source_missing");
  }

  const result = await decoder.decode(absoluteInputPath, paths.generatedRoot, item.id, DECODE_OPTIONS);
  if (!result.ok || !result.outputPath || !result.mimeType) {
    upsertPreviewRow(db, item.id, {
      preview_status: "failed",
      preview_generator: decoder.id,
      preview_generator_version: capability.version,
      decoder_selection: selection,
      conversion_error: result.reason ?? "Conversion failed",
    });
    return toPreviewInfo(getPreviewRow(db, item.id), "failed");
  }

  const newRelativePath = basename(result.outputPath);

  // Best-effort: remove a previous preview file left behind by a
  // different decoder/format (e.g. a stale ImageMagick .webp when the
  // new preview is a libheif-js .jpg) so orphaned files don't accumulate.
  // Never removes the just-written new file, and a failure here is not
  // itself a generation failure.
  if (previousRow?.preview_relative_path && previousRow.preview_relative_path !== newRelativePath) {
    await rm(join(paths.generatedRoot, previousRow.preview_relative_path), { force: true }).catch(() => {});
  }

  upsertPreviewRow(db, item.id, {
    preview_status: "ready",
    preview_relative_path: newRelativePath,
    preview_mime_type: result.mimeType,
    preview_generated_at: new Date().toISOString(),
    preview_generator: decoder.id,
    preview_generator_version: capability.version,
    source_fingerprint: item.sha256,
    decoder_selection: selection,
    conversion_error: null,
  });
  return toPreviewInfo(getPreviewRow(db, item.id), "ready");
}

/**
 * Resolves the absolute path of a *ready and current* generated preview
 * for streaming — `null` for anything else (not requested, generating,
 * failed, stale, or the file missing from disk despite the DB row
 * saying "ready", which can happen if the preview directory was
 * cleaned up externally). The file-serving route treats `null` as 404,
 * never as "fall back to the original."
 */
export function resolveReadyHeicPreviewFile(db: Database.Database, workspaceId: number, itemId: string, generatedRoot: string): { absolutePath: string; mimeType: string } | null {
  const item = getEvidenceItemRow(db, workspaceId, itemId);
  if (!item || !isHeicExtension(item.extension)) return null;
  const row = getPreviewRow(db, itemId);
  if (!row || effectiveStatus(row, item) !== "ready" || !row.preview_relative_path || !row.preview_mime_type) return null;
  const absolutePath = join(generatedRoot, row.preview_relative_path);
  if (!existsSync(absolutePath)) return null;
  return { absolutePath, mimeType: row.preview_mime_type };
}

interface BackfillJobRow {
  id: number;
  workspace_id: number;
  status: string;
  created_at: string;
  started_at: string;
  completed_at: string | null;
  total_count: number;
  processed_count: number;
  succeeded_count: number;
  failed_count: number;
  skipped_count: number;
  error: string | null;
}

function mapBackfillJobRow(row: BackfillJobRow): HeicBackfillJobStatus {
  return {
    id: row.id,
    status: row.status as HeicBackfillJobStatus["status"],
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    totalCount: row.total_count,
    processedCount: row.processed_count,
    succeededCount: row.succeeded_count,
    failedCount: row.failed_count,
    skippedCount: row.skipped_count,
    errorMessage: row.error,
  };
}

export function getHeicBackfillJobStatus(db: Database.Database, workspaceId: number, jobId: number): HeicBackfillJobStatus | null {
  const row = db.prepare("SELECT * FROM heic_backfill_jobs WHERE id = ? AND workspace_id = ?").get(jobId, workspaceId) as BackfillJobRow | undefined;
  return row ? mapBackfillJobRow(row) : null;
}

/**
 * Job ids this *process* is actively running the background IIFE for
 * (added right after insert, removed once that IIFE settles). This is
 * the signal `reconcileAbandonedHeicBackfillJobs` uses to tell "still
 * genuinely running" apart from "the row says running, but the process
 * that was running it is gone" — the DB row alone can't distinguish
 * those two cases across a server restart, since nothing marks it
 * otherwise if the process just exits.
 */
const jobsRunningInThisProcess = new Set<number>();

/**
 * Marks any `heic_backfill_jobs` row still `status = 'running'` in the
 * database but *not* in `jobsRunningInThisProcess` as `'interrupted'` —
 * i.e. a job a previous process instance started and never finished,
 * because that process exited (crash, restart, redeploy) before its
 * background IIFE completed. Called at the start of every
 * `runHeicPreviewBackfill` (including the very first one after a fresh
 * process start, when `jobsRunningInThisProcess` is empty and every
 * `running` row — if any — is therefore necessarily abandoned) so a
 * stale job can never block new work or poll forever.
 */
export function reconcileAbandonedHeicBackfillJobs(db: Database.Database, workspaceId: number): void {
  const runningRows = db.prepare("SELECT id FROM heic_backfill_jobs WHERE workspace_id = ? AND status = 'running'").all(workspaceId) as { id: number }[];
  for (const row of runningRows) {
    if (jobsRunningInThisProcess.has(row.id)) continue; // genuinely still in flight in this process
    db.prepare("UPDATE heic_backfill_jobs SET status = 'interrupted', completed_at = datetime('now'), error = ? WHERE id = ?").run(
      "The server restarted while this job was running",
      row.id,
    );
  }
}

/** Bounded-concurrency worker pool — runs `tasks` with at most `concurrency` in flight at once, awaiting all of them before resolving. */
async function runWithConcurrency<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  let index = 0;
  async function next(): Promise<void> {
    const current = index++;
    if (current >= items.length) return;
    await worker(items[current]);
    return next();
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => next()));
}

const PER_ITEM_BACKFILL_TIMEOUT_MS = 30_000;

/** Races `ensureHeicPreview` against a timeout so one hung decode can never stall the rest of the batch — the item is simply counted as failed and the worker pool moves on. */
async function ensureHeicPreviewWithTimeout(db: Database.Database, workspaceId: number, itemId: string, paths: HeicPreviewPaths): Promise<HeicPreviewInfo> {
  return Promise.race([
    ensureHeicPreview(db, workspaceId, itemId, paths),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Preview generation timed out")), PER_ITEM_BACKFILL_TIMEOUT_MS)),
  ]);
}

/**
 * "Generate Missing Previews" — finds every HEIC/HEIF evidence item in
 * the workspace without a current, valid preview (which now includes
 * any item whose preview was auto-generated by a since-superseded
 * decoder — see `effectiveStatus`) and generates one with the preferred
 * decoder, with bounded concurrency. Returns immediately with a job id;
 * conversions run in the background. Idempotent in two senses: an item
 * whose preview is already `ready` and current is skipped, not
 * reconverted (never regenerates a preview that's already ready with
 * the current source fingerprint and preferred decoder); and a second
 * call while a job for this workspace is still genuinely active returns
 * that *same* job id rather than starting a duplicate one running
 * concurrently over the same candidates.
 */
export async function runHeicPreviewBackfill(db: Database.Database, workspaceId: number, paths: HeicPreviewPaths, concurrency = 2): Promise<number> {
  reconcileAbandonedHeicBackfillJobs(db, workspaceId);

  const activeJob = db.prepare("SELECT id FROM heic_backfill_jobs WHERE workspace_id = ? AND status IN ('queued', 'running') ORDER BY id DESC LIMIT 1").get(workspaceId) as
    | { id: number }
    | undefined;
  if (activeJob) {
    return activeJob.id;
  }

  const candidates = db
    .prepare(
      `SELECT id, original_path, extension, sha256, missing_since FROM evidence_items
       WHERE workspace_id = ? AND lower(extension) IN ('heic', 'heif')`,
    )
    .all(workspaceId) as EvidenceItemRow[];

  const toProcess = candidates.filter((item) => {
    if (item.missing_since !== null) return false; // reported as skipped below, not attempted
    const row = getPreviewRow(db, item.id);
    return effectiveStatus(row, item) !== "ready";
  });
  const skippedCount = candidates.length - toProcess.length;

  const jobId = db
    .prepare("INSERT INTO heic_backfill_jobs (workspace_id, status, created_at, total_count, skipped_count) VALUES (?, 'running', datetime('now'), ?, ?)")
    .run(workspaceId, candidates.length, skippedCount).lastInsertRowid as number;

  jobsRunningInThisProcess.add(jobId);

  void (async () => {
    let succeeded = 0;
    let failed = 0;
    let processed = 0;

    try {
      await runWithConcurrency(toProcess, concurrency, async (item) => {
        try {
          const result = await ensureHeicPreviewWithTimeout(db, workspaceId, item.id, paths);
          if (result.status === "ready") succeeded++;
          else failed++;
        } catch {
          failed++;
        }
        // Persisted after every single item, not just at the end — a
        // client polling mid-batch always sees real progress, and a job
        // interrupted partway through still has an accurate count of
        // what it actually got to.
        processed++;
        db.prepare("UPDATE heic_backfill_jobs SET processed_count = ?, succeeded_count = ?, failed_count = ? WHERE id = ?").run(processed, succeeded, failed, jobId);
      });

      const finalStatus: HeicBackfillJobStatus["status"] = failed > 0 ? "completed_with_failures" : "completed";
      db.prepare("UPDATE heic_backfill_jobs SET status = ?, completed_at = datetime('now') WHERE id = ?").run(finalStatus, jobId);
    } catch (err) {
      db.prepare("UPDATE heic_backfill_jobs SET status = 'failed', completed_at = datetime('now'), error = ? WHERE id = ?").run(
        err instanceof Error ? err.message : String(err),
        jobId,
      );
      // eslint-disable-next-line no-console
      console.error("HEIC preview backfill failed unexpectedly:", err instanceof Error ? err.message : err);
    } finally {
      jobsRunningInThisProcess.delete(jobId);
    }
  })();

  return jobId;
}
