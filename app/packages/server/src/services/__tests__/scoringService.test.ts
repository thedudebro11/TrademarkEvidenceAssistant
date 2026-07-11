import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMigrations } from "../../db/migrate.js";
import { runScan } from "../scanService.js";
import { getItemDetail } from "../reviewService.js";
import * as scoringService from "../scoringService.js";
import { REPO_ROOT } from "../../config/repoRoot.js";

const GOLDEN_SOURCE = join(REPO_ROOT, "tests", "fixtures", "golden-workspace");

describe("scoringService", () => {
  let db: Database.Database;
  let evidenceRoot: string;
  let workspaceId: number;
  let itemId: string;

  beforeEach(async () => {
    db = new Database(":memory:");
    runMigrations(db);
    workspaceId = db
      .prepare("INSERT INTO workspaces (name, evidence_root) VALUES ('Golden', 'unused')")
      .run().lastInsertRowid as number;

    evidenceRoot = mkdtempSync(join(tmpdir(), "scoring-service-test-"));
    cpSync(GOLDEN_SOURCE, evidenceRoot, { recursive: true });
    await runScan(db, workspaceId, evidenceRoot);

    itemId = (
      db.prepare("SELECT id FROM evidence_items WHERE original_path = 'product_photo.jpg'").get() as { id: string }
    ).id;
  });

  afterEach(() => {
    db.close();
    rmSync(evidenceRoot, { recursive: true, force: true });
  });

  it("a fresh item's usefulness has no override, and effective equals computed", () => {
    const detail = getItemDetail(db, workspaceId, itemId)!;
    expect(detail.usefulness.override).toBeNull();
    expect(detail.usefulness.effective).toEqual(detail.usefulness.computed);
    expect(detail.usefulness.computed.band).toBe("Undetermined");
  });

  describe("setOverride", () => {
    it("sets an override that becomes the effective score, without discarding the computed one", () => {
      scoringService.setOverride(db, workspaceId, itemId, 85, "Strong", "I personally verified this at the event.");

      const detail = getItemDetail(db, workspaceId, itemId)!;
      expect(detail.usefulness.override).toMatchObject({ score: 85, band: "Strong" });
      expect(detail.usefulness.effective.score).toBe(85);
      expect(detail.usefulness.effective.band).toBe("Strong");
      expect(detail.usefulness.computed).toBeTruthy(); // still present, never hidden
    });

    it("rejects an override with no note (spec 08: override requires a note)", () => {
      expect(() => scoringService.setOverride(db, workspaceId, itemId, 85, "Strong", "")).toThrow(
        scoringService.ScoringValidationError,
      );
      expect(() => scoringService.setOverride(db, workspaceId, itemId, 85, "Strong", "   ")).toThrow(
        scoringService.ScoringValidationError,
      );
    });

    it("rejects a score outside 0-100", () => {
      expect(() => scoringService.setOverride(db, workspaceId, itemId, 150, "Strong", "note")).toThrow(
        scoringService.ScoringValidationError,
      );
      expect(() => scoringService.setOverride(db, workspaceId, itemId, -5, "Strong", "note")).toThrow(
        scoringService.ScoringValidationError,
      );
    });

    it("rejects an unrecognized band", () => {
      expect(() =>
        // @ts-expect-error deliberately invalid
        scoringService.setOverride(db, workspaceId, itemId, 50, "Extremely Strong", "note"),
      ).toThrow(scoringService.ScoringValidationError);
    });

    it("throws for an item outside the workspace", () => {
      expect(() => scoringService.setOverride(db, workspaceId, "not-a-real-id", 50, "Weak", "note")).toThrow();
    });
  });

  describe("clearOverride", () => {
    it("reverts effective back to the computed score", () => {
      scoringService.setOverride(db, workspaceId, itemId, 85, "Strong", "note");
      scoringService.clearOverride(db, workspaceId, itemId);

      const detail = getItemDetail(db, workspaceId, itemId)!;
      expect(detail.usefulness.override).toBeNull();
      expect(detail.usefulness.effective).toEqual(detail.usefulness.computed);
    });
  });
});
