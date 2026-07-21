import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMigrations } from "../../db/migrate.js";
import { runScan } from "../scanService.js";
import * as connectionService from "../connectionService.js";
import { getItemDetail } from "../reviewService.js";
import { REPO_ROOT } from "../../config/repoRoot.js";

const GOLDEN_SOURCE = join(REPO_ROOT, "tests", "fixtures", "golden-workspace");

describe("connectionService", () => {
  let db: Database.Database;
  let evidenceRoot: string;
  let workspaceId: number;
  let productPhotoId: string;
  let invoiceId: string;

  beforeEach(async () => {
    db = new Database(":memory:");
    runMigrations(db);
    workspaceId = db
      .prepare("INSERT INTO workspaces (name, evidence_root) VALUES ('Golden', 'unused')")
      .run().lastInsertRowid as number;

    evidenceRoot = mkdtempSync(join(tmpdir(), "connection-service-test-"));
    cpSync(GOLDEN_SOURCE, evidenceRoot, { recursive: true });
    await runScan(db, workspaceId, evidenceRoot);

    productPhotoId = (
      db.prepare("SELECT id FROM evidence_items WHERE original_path = 'product_photo.jpg'").get() as { id: string }
    ).id;
    invoiceId = (
      db.prepare("SELECT id FROM evidence_items WHERE original_path = 'printful_invoice.pdf'").get() as {
        id: string;
      }
    ).id;
  });

  afterEach(() => {
    db.close();
    rmSync(evidenceRoot, { recursive: true, force: true });
  });

  describe("createConnection", () => {
    it("creates a connection by target original path", () => {
      const connection = connectionService.createConnection(db, workspaceId, productPhotoId, "printful_invoice.pdf", {
        type: "product_to_invoice",
        explanation: "This photo matches the product listed on the invoice.",
        confidence: "high",
      });
      expect(connection.sourceItemId).toBe(productPhotoId);
      expect(connection.targetItemId).toBe(invoiceId);
      expect(connection.type).toBe("product_to_invoice");
    });

    it("rejects an unrecognized connection type", () => {
      expect(() =>
        connectionService.createConnection(db, workspaceId, productPhotoId, "printful_invoice.pdf", {
          // @ts-expect-error deliberately invalid
          type: "not_a_real_type",
          explanation: "x",
          confidence: null,
        }),
      ).toThrow(connectionService.ConnectionValidationError);
    });

    it("rejects an empty explanation", () => {
      expect(() =>
        connectionService.createConnection(db, workspaceId, productPhotoId, "printful_invoice.pdf", {
          type: "product_to_invoice",
          explanation: "   ",
          confidence: null,
        }),
      ).toThrow(/explanation is required/);
    });

    it("rejects connecting an item to itself", () => {
      expect(() =>
        connectionService.createConnection(db, workspaceId, productPhotoId, "product_photo.jpg", {
          type: "related_to",
          explanation: "x",
          confidence: null,
        }),
      ).toThrow(/cannot be connected to itself/);
    });

    it("rejects a target path that doesn't exist in the workspace", () => {
      expect(() =>
        connectionService.createConnection(db, workspaceId, productPhotoId, "does_not_exist.jpg", {
          type: "related_to",
          explanation: "x",
          confidence: null,
        }),
      ).toThrow(/No evidence item matches/);
    });

    it("resolves a pasted absolute Windows path via a suffix match against the stored relative path", () => {
      const connection = connectionService.createConnection(
        db,
        workspaceId,
        productPhotoId,
        "C:\\Users\\oscar\\TrademarkEvidenceAssistant\\workspaces\\Fatletic\\evidence\\printful_invoice.pdf",
        { type: "product_to_invoice", explanation: "Pasted from Explorer.", confidence: null },
      );
      expect(connection.targetItemId).toBe(invoiceId);
    });

    it("resolves an absolute POSIX-style path the same way", () => {
      const connection = connectionService.createConnection(
        db,
        workspaceId,
        productPhotoId,
        "/home/oscar/TrademarkEvidenceAssistant/workspaces/Fatletic/evidence/printful_invoice.pdf",
        { type: "product_to_invoice", explanation: "Pasted from a file manager.", confidence: null },
      );
      expect(connection.targetItemId).toBe(invoiceId);
    });

    it("the suffix fallback still requires the whole stored relative path to match, not just a partial filename", () => {
      // "voice.pdf" is shorter than the stored "printful_invoice.pdf" and
      // isn't a real suffix of it, so this must still be rejected.
      expect(() =>
        connectionService.createConnection(db, workspaceId, productPhotoId, "voice.pdf", {
          type: "related_to",
          explanation: "x",
          confidence: null,
        }),
      ).toThrow(/No evidence item matches/);
    });

    it("rejects an invalid confidence value", () => {
      expect(() =>
        connectionService.createConnection(db, workspaceId, productPhotoId, "printful_invoice.pdf", {
          type: "product_to_invoice",
          explanation: "x",
          // @ts-expect-error deliberately invalid
          confidence: "extremely-sure",
        }),
      ).toThrow(connectionService.ConnectionValidationError);
    });
  });

  describe("getConnectionsForItem via getItemDetail", () => {
    it("shows the connection from both the source's (outgoing) and target's (incoming) point of view", () => {
      connectionService.createConnection(db, workspaceId, productPhotoId, "printful_invoice.pdf", {
        type: "product_to_invoice",
        explanation: "Matches this order.",
        confidence: "medium",
      });

      const sourceDetail = getItemDetail(db, workspaceId, productPhotoId);
      expect(sourceDetail?.connections).toHaveLength(1);
      expect(sourceDetail?.connections[0].direction).toBe("outgoing");
      expect(sourceDetail?.connections[0].relatedOriginalPath).toBe("printful_invoice.pdf");

      const targetDetail = getItemDetail(db, workspaceId, invoiceId);
      expect(targetDetail?.connections).toHaveLength(1);
      expect(targetDetail?.connections[0].direction).toBe("incoming");
      expect(targetDetail?.connections[0].relatedOriginalPath).toBe("product_photo.jpg");
    });
  });

  describe("removeConnection", () => {
    it("removes an existing connection", () => {
      const connection = connectionService.createConnection(db, workspaceId, productPhotoId, "printful_invoice.pdf", {
        type: "related_to",
        explanation: "x",
        confidence: null,
      });
      connectionService.removeConnection(db, workspaceId, connection.id);

      const detail = getItemDetail(db, workspaceId, productPhotoId);
      expect(detail?.connections).toHaveLength(0);
    });

    it("throws for a connection id that doesn't exist", () => {
      expect(() => connectionService.removeConnection(db, workspaceId, 999999)).toThrow(
        connectionService.ConnectionValidationError,
      );
    });
  });
});
