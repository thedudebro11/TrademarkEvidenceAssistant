import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { generateBinder } from "../engines/binderEngine.js";
import type { BinderItemInput } from "../engines/binderEngine.js";
import { toExhibitCsv, toHtml, toJson, toMarkdown } from "../engines/binderFormatters.js";
import { getItemDetail } from "./reviewService.js";

export class BinderValidationError extends Error {}

export interface BinderSummary {
  binderGenerationId: number;
  exportId: number;
  itemCount: number;
  outputPaths: { markdown: string; html: string; json: string; csv: string };
}

interface ExportRow {
  id: number;
  status: string;
}

interface ExportItemRow {
  evidence_item_id: string;
  export_relative_path: string;
}

/**
 * Builds an Evidence Binder from the items in a completed export run.
 * Reuses ReviewService.getItemDetail per item (not a separate query
 * path) so the binder's role/answers/usefulness/connections data can
 * never drift from what the Review Queue itself shows —
 * docs/ARCHITECTURE_CONSTITUTION.md #2: "business rules exist exactly
 * once."
 */
export async function runBinderGeneration(
  db: Database.Database,
  workspaceId: number,
  workspaceName: string,
  exportId: number | null,
  reportsRoot: string,
): Promise<BinderSummary> {
  const exportRow = exportId
    ? (db.prepare("SELECT id, status FROM exports WHERE id = ? AND workspace_id = ?").get(exportId, workspaceId) as
        | ExportRow
        | undefined)
    : (db
        .prepare(
          "SELECT id, status FROM exports WHERE workspace_id = ? AND status = 'completed' ORDER BY completed_at DESC LIMIT 1",
        )
        .get(workspaceId) as ExportRow | undefined);

  if (!exportRow) {
    throw new BinderValidationError(
      "No completed export found for this workspace. Generate an evidence package first.",
    );
  }
  if (exportRow.status !== "completed") {
    throw new BinderValidationError(`Export ${exportRow.id} did not complete successfully and cannot be used for a binder.`);
  }

  const exportItems = db
    .prepare("SELECT evidence_item_id, export_relative_path FROM export_items WHERE export_id = ?")
    .all(exportRow.id) as ExportItemRow[];

  const items: BinderItemInput[] = exportItems.map((row) => {
    const detail = getItemDetail(db, workspaceId, row.evidence_item_id)!;
    return {
      exportRelativePath: row.export_relative_path,
      originalFilename: detail.originalFilename,
      fileRole: detail.fileRole,
      whatIsThisAnswer: detail.answers.find((a) => a.questionId === "universal_what_is_this")?.value ?? "",
      realWorldDateAnswer: detail.answers.find((a) => a.questionId === "universal_real_world_date")?.value ?? "",
      publiclyPostedAnswer: detail.answers.find((a) => a.questionId === "image_publicly_posted")?.value ?? "",
      fsModifiedAt: detail.fsModifiedAt,
      usefulnessBand: detail.usefulness.effective.band,
      usefulnessScore: detail.usefulness.effective.score,
      reviewStatus: detail.reviewStatus,
      connectionTypes: detail.connections.map((c) => c.type),
      sha256: detail.sha256,
    };
  });

  const counts = db
    .prepare(
      `SELECT
         SUM(CASE WHEN review_status = 'needs_follow_up' THEN 1 ELSE 0 END) AS follow_up,
         SUM(CASE WHEN review_status = 'excluded' THEN 1 ELSE 0 END) AS excluded
       FROM evidence_items WHERE workspace_id = ?`,
    )
    .get(workspaceId) as { follow_up: number | null; excluded: number | null };

  const doc = generateBinder(workspaceName, items, counts.follow_up ?? 0, counts.excluded ?? 0);

  const outputDir = join(reportsRoot, workspaceName, `export-${exportRow.id}`);
  mkdirSync(outputDir, { recursive: true });

  const outputPaths = {
    markdown: join(outputDir, "binder.md"),
    html: join(outputDir, "binder.html"),
    json: join(outputDir, "binder.json"),
    csv: join(outputDir, "exhibits.csv"),
  };

  writeFileSync(outputPaths.markdown, toMarkdown(doc));
  writeFileSync(outputPaths.html, toHtml(doc));
  writeFileSync(outputPaths.json, toJson(doc));
  writeFileSync(outputPaths.csv, toExhibitCsv(doc));

  const binderGenerationId = db
    .prepare("INSERT INTO binder_generations (export_id, workspace_id, output_path) VALUES (?, ?, ?)")
    .run(exportRow.id, workspaceId, outputDir).lastInsertRowid as number;

  return { binderGenerationId, exportId: exportRow.id, itemCount: items.length, outputPaths };
}
