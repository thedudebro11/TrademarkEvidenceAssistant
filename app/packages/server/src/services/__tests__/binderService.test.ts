import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, cpSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMigrations } from "../../db/migrate.js";
import { runScan } from "../scanService.js";
import { recordDecision, saveAnswer, setFileRole } from "../reviewService.js";
import { runExport } from "../exportService.js";
import { runBinderGeneration, BinderValidationError } from "../binderService.js";
import { findForbiddenLanguage } from "../../engines/binderEngine.js";
import { REPO_ROOT } from "../../config/repoRoot.js";

const GOLDEN_SOURCE = join(REPO_ROOT, "tests", "fixtures", "golden-workspace");

describe("runBinderGeneration", () => {
  let db: Database.Database;
  let evidenceRoot: string;
  let exportsRoot: string;
  let reportsRoot: string;
  let workspaceId: number;

  beforeEach(async () => {
    db = new Database(":memory:");
    runMigrations(db);
    workspaceId = db
      .prepare("INSERT INTO workspaces (name, evidence_root) VALUES ('Golden', 'unused')")
      .run().lastInsertRowid as number;

    evidenceRoot = mkdtempSync(join(tmpdir(), "binder-service-evidence-"));
    cpSync(GOLDEN_SOURCE, evidenceRoot, { recursive: true });
    exportsRoot = mkdtempSync(join(tmpdir(), "binder-service-exports-"));
    reportsRoot = mkdtempSync(join(tmpdir(), "binder-service-reports-"));
    await runScan(db, workspaceId, evidenceRoot);
  });

  afterEach(() => {
    db.close();
    rmSync(evidenceRoot, { recursive: true, force: true });
    rmSync(exportsRoot, { recursive: true, force: true });
    rmSync(reportsRoot, { recursive: true, force: true });
  });

  it("throws a clear error when no export has ever been run", async () => {
    await expect(runBinderGeneration(db, workspaceId, "Golden", null, reportsRoot)).rejects.toThrow(
      BinderValidationError,
    );
  });

  it("generates all four output files from a completed export", async () => {
    const item = db
      .prepare("SELECT id FROM evidence_items WHERE original_path = 'product_photo.jpg'")
      .get() as { id: string };
    setFileRole(db, workspaceId, item.id, "product_photo");
    saveAnswer(db, workspaceId, item.id, "universal_what_is_this", {
      value: "The main product photo.",
      confidence: null,
      note: null,
    });
    saveAnswer(db, workspaceId, item.id, "universal_real_world_date", {
      value: "September 2024",
      confidence: null,
      note: null,
    });
    recordDecision(db, workspaceId, item.id, "include");

    await runExport(db, workspaceId, "Golden", evidenceRoot, exportsRoot);
    const summary = await runBinderGeneration(db, workspaceId, "Golden", null, reportsRoot);

    expect(summary.itemCount).toBe(1);
    for (const path of Object.values(summary.outputPaths)) {
      expect(existsSync(path)).toBe(true);
    }
  });

  it("every generated output file contains no forbidden language", async () => {
    const item = db
      .prepare("SELECT id FROM evidence_items WHERE original_path = 'product_photo.jpg'")
      .get() as { id: string };
    setFileRole(db, workspaceId, item.id, "product_photo");
    recordDecision(db, workspaceId, item.id, "include");
    await runExport(db, workspaceId, "Golden", evidenceRoot, exportsRoot);
    const summary = await runBinderGeneration(db, workspaceId, "Golden", null, reportsRoot);

    for (const path of Object.values(summary.outputPaths)) {
      const content = readFileSync(path, "utf-8");
      expect(findForbiddenLanguage(content)).toEqual([]);
    }
  });

  it("cites the item's role-driven answers and score consistently with what the Review Queue itself shows", async () => {
    const item = db
      .prepare("SELECT id FROM evidence_items WHERE original_path = 'product_photo.jpg'")
      .get() as { id: string };
    setFileRole(db, workspaceId, item.id, "product_photo");
    saveAnswer(db, workspaceId, item.id, "universal_what_is_this", {
      value: "A specific description used for citation testing.",
      confidence: null,
      note: null,
    });
    recordDecision(db, workspaceId, item.id, "include");
    await runExport(db, workspaceId, "Golden", evidenceRoot, exportsRoot);
    const summary = await runBinderGeneration(db, workspaceId, "Golden", null, reportsRoot);

    const md = readFileSync(summary.outputPaths.markdown, "utf-8");
    expect(md).toContain("A specific description used for citation testing.");
  });

  it("rejects a specified exportId that doesn't belong to the workspace", async () => {
    await expect(runBinderGeneration(db, workspaceId, "Golden", 999999, reportsRoot)).rejects.toThrow(
      BinderValidationError,
    );
  });

  it("the JSON output's exhibit count matches the number of exported items", async () => {
    const a = db.prepare("SELECT id FROM evidence_items WHERE original_path = 'product_photo.jpg'").get() as {
      id: string;
    };
    const b = db.prepare("SELECT id FROM evidence_items WHERE original_path = 'customer_photo.jpg'").get() as {
      id: string;
    };
    recordDecision(db, workspaceId, a.id, "include");
    recordDecision(db, workspaceId, b.id, "include");
    await runExport(db, workspaceId, "Golden", evidenceRoot, exportsRoot);
    const summary = await runBinderGeneration(db, workspaceId, "Golden", null, reportsRoot);

    const json = JSON.parse(readFileSync(summary.outputPaths.json, "utf-8"));
    expect(json.exhibits).toHaveLength(2);
  });
});
