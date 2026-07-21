import { extname, basename } from "node:path";
import type Database from "better-sqlite3";
import { discoverFiles } from "../engines/scannerEngine.js";
import { sha256File } from "../engines/hashEngine.js";
import { mimeTypeForExtension } from "../engines/mimeType.js";
import { extractMetadata } from "../engines/metadataEngine.js";
import { deriveEvidenceItemId } from "../engines/evidenceItemId.js";

export interface ScanSummary {
  scanRunId: number;
  status: "completed" | "failed";
  startedAt: string;
  completedAt: string | null;
  filesDiscovered: number;
  itemsCreated: number;
  itemsUpdated: number;
  itemsUnchanged: number;
  itemsContentChanged: number;
  itemsMissing: number;
  duplicateGroups: number;
  errorMessage: string | null;
}

interface ExistingItemRow {
  id: string;
  sha256: string;
  review_status: string;
  missing_since: string | null;
}

/**
 * Orchestrates one scan of `evidenceRoot` for `workspaceId`: discover
 * files, hash them, extract deterministic metadata, and persist Evidence
 * Items — the four responsibilities the Scanner is allowed, per
 * docs/ARCHITECTURE_CONSTITUTION.md #7. Nothing here reviews, scores, or
 * interprets evidence.
 *
 * Every discovered file is re-hashed on every scan (no mtime-based
 * skip). This is intentionally the simple, always-correct choice for v1
 * — see docs/IMPROVEMENT_PROPOSALS.md for the deferred optimization.
 */
export async function runScan(
  db: Database.Database,
  workspaceId: number,
  evidenceRoot: string,
): Promise<ScanSummary> {
  const alreadyRunning = db
    .prepare("SELECT id FROM scan_runs WHERE workspace_id = ? AND status = 'running'")
    .get(workspaceId) as { id: number } | undefined;
  if (alreadyRunning) {
    throw new Error(`A scan is already running for this workspace (scan_runs.id=${alreadyRunning.id})`);
  }

  const scanRunId = db
    .prepare("INSERT INTO scan_runs (workspace_id, status) VALUES (?, 'running')")
    .run(workspaceId).lastInsertRowid as number;

  try {
    const discovered = discoverFiles(evidenceRoot);
    db.prepare("UPDATE scan_runs SET files_discovered = ? WHERE id = ?").run(
      discovered.length,
      scanRunId,
    );

    const existingRows = db
      .prepare("SELECT id, original_path, sha256, review_status, missing_since FROM evidence_items WHERE workspace_id = ?")
      .all(workspaceId) as (ExistingItemRow & { original_path: string })[];
    const existingByPath = new Map(existingRows.map((row) => [row.original_path, row]));
    const seenPaths = new Set<string>();

    let itemsCreated = 0;
    let itemsUpdated = 0;
    let itemsUnchanged = 0;
    let itemsContentChanged = 0;

    const insertItem = db.prepare(
      `INSERT INTO evidence_items
         (id, workspace_id, original_path, original_filename, extension, mime_type, file_size, sha256, fs_created_at, fs_modified_at)
       VALUES (@id, @workspaceId, @originalPath, @originalFilename, @extension, @mimeType, @fileSize, @sha256, @fsCreatedAt, @fsModifiedAt)`,
    );
    const updateItem = db.prepare(
      `UPDATE evidence_items
       SET sha256 = @sha256, file_size = @fileSize, fs_created_at = @fsCreatedAt,
           fs_modified_at = @fsModifiedAt, last_seen_at = datetime('now'), missing_since = NULL
       WHERE id = @id`,
    );
    const upsertMetadata = db.prepare(
      `INSERT INTO file_metadata
         (evidence_item_id, width, height, page_count, exif_date_time_original, exif_create_date,
          gps_latitude, gps_longitude, camera_make, camera_model, orientation, color_profile, filename_inferred_date, extracted_at)
       VALUES (@evidenceItemId, @width, @height, @pageCount, @exifDateTimeOriginal, @exifCreateDate,
               @gpsLatitude, @gpsLongitude, @cameraMake, @cameraModel, @orientation, @colorProfile, @filenameInferredDate, datetime('now'))
       ON CONFLICT(evidence_item_id) DO UPDATE SET
         width = @width, height = @height, page_count = @pageCount, exif_date_time_original = @exifDateTimeOriginal,
         exif_create_date = @exifCreateDate, gps_latitude = @gpsLatitude, gps_longitude = @gpsLongitude,
         camera_make = @cameraMake, camera_model = @cameraModel, orientation = @orientation,
         color_profile = @colorProfile, filename_inferred_date = @filenameInferredDate, extracted_at = datetime('now')`,
    );

    for (const file of discovered) {
      seenPaths.add(file.relativePath);
      const extension = extname(file.relativePath).replace(/^\./, "");
      const id = deriveEvidenceItemId(workspaceId, file.relativePath);
      const sha256 = await sha256File(file.absolutePath);
      const metadata = await extractMetadata(file.absolutePath, extension, basename(file.relativePath));
      const mimeType = mimeTypeForExtension(extension);

      const existing = existingByPath.get(file.relativePath);
      if (!existing) {
        insertItem.run({
          id,
          workspaceId,
          originalPath: file.relativePath,
          originalFilename: basename(file.relativePath),
          extension,
          mimeType,
          fileSize: file.fileSize,
          sha256,
          fsCreatedAt: file.fsCreatedAt,
          fsModifiedAt: file.fsModifiedAt,
        });
        itemsCreated++;
      } else {
        const contentChanged = existing.sha256 !== sha256;
        const wasMissing = existing.missing_since !== null;
        if (contentChanged || wasMissing) {
          updateItem.run({
            id: existing.id,
            sha256,
            fileSize: file.fileSize,
            fsCreatedAt: file.fsCreatedAt,
            fsModifiedAt: file.fsModifiedAt,
          });
          itemsUpdated++;
          if (contentChanged) {
            itemsContentChanged++;
          }
        } else {
          db.prepare("UPDATE evidence_items SET last_seen_at = datetime('now') WHERE id = ?").run(existing.id);
          itemsUnchanged++;
        }
      }

      upsertMetadata.run({
        evidenceItemId: id,
        width: metadata.width,
        height: metadata.height,
        pageCount: metadata.pageCount,
        exifDateTimeOriginal: metadata.exifDateTimeOriginal ?? null,
        exifCreateDate: metadata.exifCreateDate ?? null,
        gpsLatitude: metadata.gpsLatitude ?? null,
        gpsLongitude: metadata.gpsLongitude ?? null,
        cameraMake: metadata.cameraMake ?? null,
        cameraModel: metadata.cameraModel ?? null,
        orientation: metadata.orientation ?? null,
        colorProfile: metadata.colorProfile ?? null,
        filenameInferredDate: metadata.filenameInferredDate ?? null,
      });
    }

    const markMissing = db.prepare(
      "UPDATE evidence_items SET missing_since = datetime('now') WHERE id = ? AND missing_since IS NULL",
    );
    for (const row of existingRows) {
      if (!seenPaths.has(row.original_path)) {
        markMissing.run(row.id);
      }
    }

    const itemsMissing = (
      db.prepare("SELECT COUNT(*) AS count FROM evidence_items WHERE workspace_id = ? AND missing_since IS NOT NULL")
        .get(workspaceId) as { count: number }
    ).count;

    const duplicateGroups = rebuildDuplicates(db, workspaceId);

    const completedAt = new Date().toISOString();
    db.prepare(
      `UPDATE scan_runs SET status = 'completed', completed_at = datetime('now'),
         items_created = ?, items_updated = ?, items_unchanged = ?, items_content_changed = ?,
         items_missing = ?, duplicate_groups = ?
       WHERE id = ?`,
    ).run(itemsCreated, itemsUpdated, itemsUnchanged, itemsContentChanged, itemsMissing, duplicateGroups, scanRunId);

    const runRow = db.prepare("SELECT started_at FROM scan_runs WHERE id = ?").get(scanRunId) as {
      started_at: string;
    };

    return {
      scanRunId,
      status: "completed",
      startedAt: runRow.started_at,
      completedAt,
      filesDiscovered: discovered.length,
      itemsCreated,
      itemsUpdated,
      itemsUnchanged,
      itemsContentChanged,
      itemsMissing,
      duplicateGroups,
      errorMessage: null,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    db.prepare(
      "UPDATE scan_runs SET status = 'failed', completed_at = datetime('now'), error_message = ? WHERE id = ?",
    ).run(errorMessage, scanRunId);
    throw err;
  }
}

/**
 * Rebuilds the `duplicates` table for a workspace from the current
 * evidence_items state (exact SHA-256 matches only, missing files
 * excluded). Delete+insert is wrapped in a synchronous transaction —
 * safe because, unlike the scan loop above, none of this involves
 * awaited async work.
 */
function rebuildDuplicates(db: Database.Database, workspaceId: number): number {
  const rebuild = db.transaction(() => {
    db.prepare("DELETE FROM duplicates WHERE workspace_id = ?").run(workspaceId);

    const groups = db
      .prepare(
        `SELECT sha256 FROM evidence_items
         WHERE workspace_id = ? AND missing_since IS NULL
         GROUP BY sha256 HAVING COUNT(*) > 1`,
      )
      .all(workspaceId) as { sha256: string }[];

    const insertDuplicate = db.prepare(
      "INSERT INTO duplicates (workspace_id, sha256, evidence_item_id) VALUES (?, ?, ?)",
    );
    const findMembers = db.prepare(
      "SELECT id FROM evidence_items WHERE workspace_id = ? AND sha256 = ? AND missing_since IS NULL",
    );

    for (const group of groups) {
      const members = findMembers.all(workspaceId, group.sha256) as { id: string }[];
      for (const member of members) {
        insertDuplicate.run(workspaceId, group.sha256, member.id);
      }
    }

    return groups.length;
  });

  return rebuild();
}
