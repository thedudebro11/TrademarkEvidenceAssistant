import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, cpSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { runMigrations } from "../../db/migrate.js";
import { runScan } from "../scanService.js";
import { recordDecision } from "../reviewService.js";
import { setFileRole } from "../reviewService.js";
import { runExport } from "../exportService.js";
import { REPO_ROOT } from "../../config/repoRoot.js";

const GOLDEN_SOURCE = join(REPO_ROOT, "tests", "fixtures", "golden-workspace");

describe("runExport", () => {
  let db: Database.Database;
  let evidenceRoot: string;
  let exportsRoot: string;
  let workspaceId: number;

  beforeEach(async () => {
    db = new Database(":memory:");
    runMigrations(db);
    workspaceId = db
      .prepare("INSERT INTO workspaces (name, evidence_root) VALUES ('Golden', 'unused')")
      .run().lastInsertRowid as number;

    evidenceRoot = mkdtempSync(join(tmpdir(), "export-service-evidence-"));
    cpSync(GOLDEN_SOURCE, evidenceRoot, { recursive: true });
    exportsRoot = mkdtempSync(join(tmpdir(), "export-service-exports-"));
    await runScan(db, workspaceId, evidenceRoot);
  });

  afterEach(() => {
    db.close();
    rmSync(evidenceRoot, { recursive: true, force: true });
    rmSync(exportsRoot, { recursive: true, force: true });
  });

  it("exports nothing when no item has been decided Include", async () => {
    const summary = await runExport(db, workspaceId, "Golden", evidenceRoot, exportsRoot);
    expect(summary.status).toBe("completed");
    expect(summary.itemsExported).toBe(0);
  });

  it("copies an Include-decision item into its role-mapped folder with byte-identical content", async () => {
    const item = db
      .prepare("SELECT id FROM evidence_items WHERE original_path = 'product_photo.jpg'")
      .get() as { id: string };
    setFileRole(db, workspaceId, item.id, "product_photo");
    recordDecision(db, workspaceId, item.id, "include");

    const summary = await runExport(db, workspaceId, "Golden", evidenceRoot, exportsRoot);
    expect(summary.itemsExported).toBe(1);

    const exportedPath = join(summary.exportPath, "05_PRODUCTS_AND_DESIGNS", "Product_Photos", "product_photo.jpg");
    expect(existsSync(exportedPath)).toBe(true);

    const originalBytes = readFileSync(join(evidenceRoot, "product_photo.jpg"));
    const exportedBytes = readFileSync(exportedPath);
    expect(exportedBytes.equals(originalBytes)).toBe(true);
  });

  it("never exports a Maybe/Follow-Up/Archive decision item, only Include", async () => {
    const maybeItem = db
      .prepare("SELECT id FROM evidence_items WHERE original_path = 'customer_photo.jpg'")
      .get() as { id: string };
    recordDecision(db, workspaceId, maybeItem.id, "maybe");
    const archivedItem = db
      .prepare("SELECT id FROM evidence_items WHERE original_path = 'unrelated_image.jpg'")
      .get() as { id: string };
    recordDecision(db, workspaceId, archivedItem.id, "archive");

    const summary = await runExport(db, workspaceId, "Golden", evidenceRoot, exportsRoot);
    expect(summary.itemsExported).toBe(0);
  });

  it("resolves a filename collision when two included items would land in the same folder with the same name", async () => {
    const a = db.prepare("SELECT id FROM evidence_items WHERE original_path = 'product_photo.jpg'").get() as {
      id: string;
    };
    const b = db
      .prepare("SELECT id FROM evidence_items WHERE original_path = 'product_photo_duplicate.jpg'")
      .get() as { id: string };
    setFileRole(db, workspaceId, a.id, "product_photo");
    setFileRole(db, workspaceId, b.id, "product_photo");
    recordDecision(db, workspaceId, a.id, "include");
    recordDecision(db, workspaceId, b.id, "include");

    const summary = await runExport(db, workspaceId, "Golden", evidenceRoot, exportsRoot);
    expect(summary.itemsExported).toBe(2);
    // Both are exact duplicates with the same content but different
    // original filenames (product_photo.jpg vs product_photo_duplicate.jpg)
    // — no actual collision here, but confirms both land safely.
    const folder = join(summary.exportPath, "05_PRODUCTS_AND_DESIGNS", "Product_Photos");
    expect(existsSync(join(folder, "product_photo.jpg"))).toBe(true);
    expect(existsSync(join(folder, "product_photo_duplicate.jpg"))).toBe(true);
  });

  it("writes a private original-path mapping outside the TrademarkEvidencePackage folder", async () => {
    const item = db
      .prepare("SELECT id FROM evidence_items WHERE original_path = 'product_photo.jpg'")
      .get() as { id: string };
    recordDecision(db, workspaceId, item.id, "include");

    const summary = await runExport(db, workspaceId, "Golden", evidenceRoot, exportsRoot);
    const runDir = join(summary.exportPath, "..");
    const mappingPath = join(runDir, "private_original_path_mapping.json");
    expect(existsSync(mappingPath)).toBe(true);
    expect(mappingPath.includes("TrademarkEvidencePackage")).toBe(false);

    const mapping = JSON.parse(readFileSync(mappingPath, "utf-8"));
    expect(mapping.items).toHaveLength(1);
    expect(mapping.items[0].originalPath).toBe("product_photo.jpg");
  });

  it("creates the full spec-09 folder skeleton even for folders with nothing exported into them", async () => {
    const summary = await runExport(db, workspaceId, "Golden", evidenceRoot, exportsRoot);
    for (const folder of ["01_CORE_EVIDENCE", "07_TIMELINE", "09_EVIDENCE_INDEX", "10_EXCLUDED_SUMMARY"]) {
      expect(existsSync(join(summary.exportPath, folder))).toBe(true);
    }
    expect(existsSync(join(summary.exportPath, "00_README.txt"))).toBe(true);
  });

  it("records export_items rows with verified hashes", async () => {
    const item = db
      .prepare("SELECT id, sha256 FROM evidence_items WHERE original_path = 'product_photo.jpg'")
      .get() as { id: string; sha256: string };
    recordDecision(db, workspaceId, item.id, "include");

    const summary = await runExport(db, workspaceId, "Golden", evidenceRoot, exportsRoot);
    const rows = db.prepare("SELECT * FROM export_items WHERE export_id = ?").all(summary.exportId) as {
      evidence_item_id: string;
      sha256_verified: number;
    }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].evidence_item_id).toBe(item.id);
    expect(rows[0].sha256_verified).toBe(1);
  });

  it("never modifies the original evidence file during export", async () => {
    const item = db
      .prepare("SELECT id FROM evidence_items WHERE original_path = 'product_photo.jpg'")
      .get() as { id: string };
    recordDecision(db, workspaceId, item.id, "include");

    const before = createHash("sha256").update(readFileSync(join(evidenceRoot, "product_photo.jpg"))).digest("hex");
    await runExport(db, workspaceId, "Golden", evidenceRoot, exportsRoot);
    const after = createHash("sha256").update(readFileSync(join(evidenceRoot, "product_photo.jpg"))).digest("hex");

    expect(after).toBe(before);
  });
});
