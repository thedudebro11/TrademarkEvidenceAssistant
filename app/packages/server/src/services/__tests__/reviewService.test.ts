import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMigrations } from "../../db/migrate.js";
import { runScan } from "../scanService.js";
import * as reviewService from "../reviewService.js";
import { REPO_ROOT } from "../../config/repoRoot.js";

const GOLDEN_SOURCE = join(REPO_ROOT, "tests", "fixtures", "golden-workspace");

describe("reviewService", () => {
  let db: Database.Database;
  let evidenceRoot: string;
  let workspaceId: number;
  let itemIds: string[];

  beforeEach(async () => {
    db = new Database(":memory:");
    runMigrations(db);
    workspaceId = db
      .prepare("INSERT INTO workspaces (name, evidence_root) VALUES ('Golden', 'unused')")
      .run().lastInsertRowid as number;

    evidenceRoot = mkdtempSync(join(tmpdir(), "review-service-test-"));
    cpSync(GOLDEN_SOURCE, evidenceRoot, { recursive: true });
    await runScan(db, workspaceId, evidenceRoot);

    const rows = db
      .prepare("SELECT id FROM evidence_items WHERE workspace_id = ? ORDER BY original_path")
      .all(workspaceId) as { id: string }[];
    itemIds = rows.map((r) => r.id);
  });

  afterEach(() => {
    db.close();
    rmSync(evidenceRoot, { recursive: true, force: true });
  });

  describe("getProgress", () => {
    it("reports all 8 items as unreviewed right after a scan", () => {
      const progress = reviewService.getProgress(db, workspaceId);
      expect(progress).toEqual({ total: 8, unreviewed: 8, reviewed: 0, needsFollowUp: 0, excluded: 0 });
    });
  });

  describe("getNextItem / getPreviousItem", () => {
    it("walks forward through the queue in original_path order", () => {
      const first = reviewService.getNextItem(db, workspaceId, null);
      expect(first?.id).toBe(itemIds[0]);

      const second = reviewService.getNextItem(db, workspaceId, first!.id);
      expect(second?.id).toBe(itemIds[1]);
    });

    it("returns null once every item has been decided", () => {
      for (const id of itemIds) {
        reviewService.recordDecision(db, workspaceId, id, "include");
      }
      expect(reviewService.getNextItem(db, workspaceId, null)).toBeNull();
    });

    it("getPreviousItem returns the immediately preceding item", () => {
      const previous = reviewService.getPreviousItem(db, workspaceId, itemIds[1]);
      expect(previous?.id).toBe(itemIds[0]);
    });

    it("getPreviousItem returns null for the first item", () => {
      expect(reviewService.getPreviousItem(db, workspaceId, itemIds[0])).toBeNull();
    });
  });

  describe("recordDecision", () => {
    it("include sets review_status=reviewed and inclusion_decision=include", () => {
      const result = reviewService.recordDecision(db, workspaceId, itemIds[0], "include");
      expect(result.reviewStatus).toBe("reviewed");
      expect(result.inclusionDecision).toBe("include");
      expect(result.decidedAt).not.toBeNull();
    });

    it("maybe sets review_status=reviewed and inclusion_decision=maybe", () => {
      const result = reviewService.recordDecision(db, workspaceId, itemIds[0], "maybe");
      expect(result.reviewStatus).toBe("reviewed");
      expect(result.inclusionDecision).toBe("maybe");
    });

    it("follow_up sets review_status=needs_follow_up and clears inclusion_decision", () => {
      const result = reviewService.recordDecision(db, workspaceId, itemIds[0], "follow_up");
      expect(result.reviewStatus).toBe("needs_follow_up");
      expect(result.inclusionDecision).toBeNull();
    });

    it("archive sets review_status=excluded and inclusion_decision=not_useful (spec 05 'Not Useful' / USER_JOURNEY 'Archive')", () => {
      const result = reviewService.recordDecision(db, workspaceId, itemIds[0], "archive");
      expect(result.reviewStatus).toBe("excluded");
      expect(result.inclusionDecision).toBe("not_useful");
    });

    it("throws for an item outside the workspace", () => {
      expect(() => reviewService.recordDecision(db, workspaceId, "not-a-real-id", "include")).toThrow();
    });
  });

  describe("saveNotes", () => {
    it("persists notes without changing review_status", () => {
      reviewService.saveNotes(db, workspaceId, itemIds[0], "Looks like the primary product shot.");
      const item = reviewService.getItemDetail(db, workspaceId, itemIds[0]);
      expect(item?.notes).toBe("Looks like the primary product shot.");
      expect(item?.reviewStatus).toBe("unreviewed");
      expect(item?.notesUpdatedAt).not.toBeNull();
    });
  });

  describe("getItemDetail duplicate reporting", () => {
    it("lists the other member of an exact-duplicate group", () => {
      const productPhoto = db
        .prepare("SELECT id FROM evidence_items WHERE original_path = 'product_photo.jpg'")
        .get() as { id: string };
      const detail = reviewService.getItemDetail(db, workspaceId, productPhoto.id);
      expect(detail?.duplicates).toEqual([
        { evidenceItemId: expect.any(String), originalPath: "product_photo_duplicate.jpg" },
      ]);
    });

    it("reports an empty duplicates array for a file with no duplicate", () => {
      const unrelated = db
        .prepare("SELECT id FROM evidence_items WHERE original_path = 'unrelated_image.jpg'")
        .get() as { id: string };
      const detail = reviewService.getItemDetail(db, workspaceId, unrelated.id);
      expect(detail?.duplicates).toEqual([]);
    });
  });

  describe("getItemDetail metadata", () => {
    it("includes extracted metadata for a file that has it", () => {
      const psd = db.prepare("SELECT id FROM evidence_items WHERE original_path = 'logo_source.psd'").get() as {
        id: string;
      };
      const detail = reviewService.getItemDetail(db, workspaceId, psd.id);
      expect(detail?.metadata).toEqual({
        width: 40,
        height: 30,
        pageCount: null,
        exifDateTimeOriginal: null,
        exifCreateDate: null,
        gpsLatitude: null,
        gpsLongitude: null,
        cameraMake: null,
        cameraModel: null,
        orientation: null,
        colorProfile: null,
        filenameInferredDate: null,
      });
    });
  });

  describe("resolveItemFile", () => {
    it("resolves a safe absolute path for an existing item", () => {
      const productPhoto = db
        .prepare("SELECT id FROM evidence_items WHERE original_path = 'product_photo.jpg'")
        .get() as { id: string };
      const resolved = reviewService.resolveItemFile(db, workspaceId, productPhoto.id, evidenceRoot);
      expect(resolved).toEqual({
        kind: "ok",
        absolutePath: join(evidenceRoot, "product_photo.jpg"),
        mimeType: "image/jpeg",
      });
    });

    it("reports 'missing' for an item whose file has been removed from disk", async () => {
      const { unlinkSync } = await import("node:fs");
      unlinkSync(join(evidenceRoot, "unrelated_image.jpg"));
      await runScan(db, workspaceId, evidenceRoot);

      const item = db
        .prepare("SELECT id FROM evidence_items WHERE original_path = 'unrelated_image.jpg'")
        .get() as { id: string };
      const resolved = reviewService.resolveItemFile(db, workspaceId, item.id, evidenceRoot);
      expect(resolved).toEqual({ kind: "missing" });
    });

    it("reports 'not_found' for an unknown item id", () => {
      const resolved = reviewService.resolveItemFile(db, workspaceId, "not-a-real-id", evidenceRoot);
      expect(resolved).toEqual({ kind: "not_found" });
    });
  });

  describe("setFileRole", () => {
    it("sets a valid role", () => {
      const result = reviewService.setFileRole(db, workspaceId, itemIds[0], "product_photo");
      expect(result.fileRole).toBe("product_photo");
    });

    it("rejects a role not in the FILE_ROLES enum", () => {
      // @ts-expect-error deliberately passing an invalid role to test runtime validation
      expect(() => reviewService.setFileRole(db, workspaceId, itemIds[0], "not_a_real_role")).toThrow(
        reviewService.InvalidRoleError,
      );
    });

    it("throws for an item outside the workspace", () => {
      expect(() => reviewService.setFileRole(db, workspaceId, "not-a-real-id", "video")).toThrow();
    });
  });

  describe("saveAnswer", () => {
    it("persists a new answer with value, confidence, and note", () => {
      const answer = reviewService.saveAnswer(db, workspaceId, itemIds[0], "universal_what_is_this", {
        value: "A product photo of a t-shirt",
        confidence: "high",
        note: "Confirmed against the invoice.",
      });
      expect(answer.value).toBe("A product photo of a t-shirt");
      expect(answer.confidence).toBe("high");
      expect(answer.source).toBe("user");
      expect(answer.answeredAt).toBeTruthy();
    });

    it("overwrites the prior answer when the same question is saved again (idempotent autosave)", () => {
      reviewService.saveAnswer(db, workspaceId, itemIds[0], "universal_what_is_this", {
        value: "first draft",
        confidence: null,
        note: null,
      });
      reviewService.saveAnswer(db, workspaceId, itemIds[0], "universal_what_is_this", {
        value: "revised answer",
        confidence: "medium",
        note: null,
      });

      const item = reviewService.getItemDetail(db, workspaceId, itemIds[0]);
      const matching = item?.answers.filter((a) => a.questionId === "universal_what_is_this");
      expect(matching).toHaveLength(1);
      expect(matching?.[0].value).toBe("revised answer");
    });

    it("rejects an invalid confidence value", () => {
      expect(() =>
        reviewService.saveAnswer(db, workspaceId, itemIds[0], "universal_what_is_this", {
          value: "x",
          // @ts-expect-error deliberately invalid
          confidence: "extremely-sure",
          note: null,
        }),
      ).toThrow();
    });

    it("throws for an item outside the workspace", () => {
      expect(() =>
        reviewService.saveAnswer(db, workspaceId, "not-a-real-id", "universal_what_is_this", {
          value: "x",
          confidence: null,
          note: null,
        }),
      ).toThrow();
    });

    it("answers for different questions on the same item coexist", () => {
      reviewService.saveAnswer(db, workspaceId, itemIds[0], "universal_what_is_this", {
        value: "answer 1",
        confidence: null,
        note: null,
      });
      reviewService.saveAnswer(db, workspaceId, itemIds[0], "universal_shows_fatletic", {
        value: "yes",
        confidence: null,
        note: null,
      });
      const item = reviewService.getItemDetail(db, workspaceId, itemIds[0]);
      expect(item?.answers).toHaveLength(2);
    });
  });
});
