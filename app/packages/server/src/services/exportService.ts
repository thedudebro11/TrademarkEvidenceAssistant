import { mkdirSync, copyFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { folderForRole, generateSafeFilename } from "../engines/exportEngine.js";
import { sha256File } from "../engines/hashEngine.js";
import { resolveSafePath } from "../security/pathGuard.js";
import type { FileRole } from "@trademark-evidence-assistant/shared";

export interface ExportSummary {
  exportId: number;
  status: "completed" | "failed";
  exportPath: string;
  itemsExported: number;
  errorMessage: string | null;
}

const SKELETON_FOLDERS = [
  ["01_CORE_EVIDENCE"],
  ["02_PRINTFUL"],
  ["03_SOCIAL_MEDIA"],
  ["04_CUSTOMERS"],
  ["05_PRODUCTS_AND_DESIGNS"],
  ["06_PACKAGING_AND_LABELS"],
  ["07_TIMELINE"],
  ["08_SUPPORTING_DOCUMENTS"],
  ["09_EVIDENCE_INDEX"],
  ["10_EXCLUDED_SUMMARY"],
];

interface ExportableItemRow {
  id: string;
  original_path: string;
  original_filename: string;
  sha256: string;
  file_role: string | null;
}

/**
 * Copies every Include-decision Evidence Item into a new
 * TrademarkEvidencePackage/ tree (spec 09), verifying each copy's hash
 * against the original before recording it, and writes a private
 * original-path mapping *outside* that tree so it's structurally
 * excluded if the package folder alone is shared externally. Never
 * writes to `evidenceRoot` — only reads from it, through the same
 * resolveSafePath guard every other read path uses.
 *
 * 07_TIMELINE / 09_EVIDENCE_INDEX / 10_EXCLUDED_SUMMARY are created as
 * empty skeleton folders only — their content generation is Phase 8
 * (Binder) territory per spec 10, not duplicated here. See
 * docs/IMPLEMENTATION_PLAN.md Phase 7 for the full reasoning.
 */
export async function runExport(
  db: Database.Database,
  workspaceId: number,
  workspaceName: string,
  evidenceRoot: string,
  exportsRoot: string,
): Promise<ExportSummary> {
  const runTimestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const exportRunDir = join(exportsRoot, workspaceName, runTimestamp);
  const packageDir = join(exportRunDir, "TrademarkEvidencePackage");

  const exportId = db
    .prepare("INSERT INTO exports (workspace_id, status, export_path) VALUES (?, 'running', ?)")
    .run(workspaceId, packageDir).lastInsertRowid as number;

  try {
    for (const segments of SKELETON_FOLDERS) {
      mkdirSync(join(packageDir, ...segments), { recursive: true });
    }
    writeFileSync(
      join(packageDir, "00_README.txt"),
      `TRADEMARK EVIDENCE PACKAGE\nWorkspace: ${workspaceName}\nGenerated: ${new Date().toISOString()}\n\n` +
        `This package contains evidence files selected for inclusion during review.\n` +
        `This is not legal advice and does not prove trademark rights.\n` +
        `Original evidence files were never modified to produce this package.\n`,
    );

    const items = db
      .prepare(
        `SELECT id, original_path, original_filename, sha256, file_role
         FROM evidence_items
         WHERE workspace_id = ? AND inclusion_decision = 'include' AND missing_since IS NULL
         ORDER BY original_path`,
      )
      .all(workspaceId) as ExportableItemRow[];

    const usedNamesByFolder = new Map<string, Set<string>>();
    const mapping: { originalPath: string; exportRelativePath: string; sha256: string }[] = [];
    let itemsExported = 0;

    const insertExportItem = db.prepare(
      "INSERT INTO export_items (export_id, evidence_item_id, export_relative_path, sha256_verified) VALUES (?, ?, ?, ?)",
    );

    for (const item of items) {
      const platformAnswer = (
        db
          .prepare(
            "SELECT value FROM review_answers WHERE evidence_item_id = ? AND question_id = 'image_platform'",
          )
          .get(item.id) as { value: string } | undefined
      )?.value ?? "";

      const folderSegments = folderForRole(item.file_role as FileRole | null, platformAnswer);
      const folderKey = folderSegments.join("/");
      if (!usedNamesByFolder.has(folderKey)) {
        usedNamesByFolder.set(folderKey, new Set());
      }
      const safeFilename = generateSafeFilename(item.original_filename, usedNamesByFolder.get(folderKey)!);

      const sourcePath = resolveSafePath(evidenceRoot, item.original_path);
      const destRelativePath = join(...folderSegments, safeFilename);
      const destPath = join(packageDir, destRelativePath);

      mkdirSync(join(packageDir, ...folderSegments), { recursive: true });
      copyFileSync(sourcePath, destPath);

      const copyHash = await sha256File(destPath);
      if (copyHash !== item.sha256) {
        throw new Error(
          `Copy verification failed for "${item.original_path}": copied file hash does not match the original. Export aborted — nothing partial was left in place.`,
        );
      }

      insertExportItem.run(exportId, item.id, destRelativePath, 1);
      mapping.push({ originalPath: item.original_path, exportRelativePath: destRelativePath, sha256: item.sha256 });
      itemsExported++;
    }

    writeFileSync(
      join(exportRunDir, "private_original_path_mapping.json"),
      JSON.stringify(
        {
          note: "Private mapping from export filenames back to original evidence paths. Do not share this file externally.",
          workspace: workspaceName,
          generatedAt: new Date().toISOString(),
          items: mapping,
        },
        null,
        2,
      ),
    );

    db.prepare(
      "UPDATE exports SET status = 'completed', completed_at = datetime('now'), items_exported = ? WHERE id = ?",
    ).run(itemsExported, exportId);

    return { exportId, status: "completed", exportPath: packageDir, itemsExported, errorMessage: null };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    db.prepare(
      "UPDATE exports SET status = 'failed', completed_at = datetime('now'), error_message = ? WHERE id = ?",
    ).run(errorMessage, exportId);
    throw err;
  }
}
