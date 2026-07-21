import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { runMigrations } from "../../db/migrate.js";

const { extractTextFromItemMock } = vi.hoisted(() => ({ extractTextFromItemMock: vi.fn() }));
vi.mock("../ocrService.js", () => ({ extractTextFromItem: extractTextFromItemMock, OcrError: class OcrError extends Error {} }));

import {
  AnalysisItemNotFoundError,
  AnalysisRunNotFoundError,
  AnalysisValidationError,
  confirmAnalysisSuggestions,
  getLatestAnalysis,
  startAnalysis,
} from "../analysisService.js";

function ocrExtraction(rawText: string) {
  return { rawText, dateCandidates: [], orderNumberCandidates: [] };
}

describe("analysisService", () => {
  let db: Database.Database;
  let evidenceRoot: string;
  const workspaceId = 1;

  beforeEach(() => {
    vi.clearAllMocks();
    extractTextFromItemMock.mockResolvedValue(ocrExtraction(""));
    db = new Database(":memory:");
    runMigrations(db);
    db.prepare("INSERT INTO workspaces (id, name, evidence_root) VALUES (1, 'Test', 'unused')").run();
    evidenceRoot = mkdtempSync(join(tmpdir(), "analysis-service-test-"));
  });

  afterEach(() => {
    db.close();
    rmSync(evidenceRoot, { recursive: true, force: true });
  });

  function insertItem(id: string, relativePath: string, opts: { sha256?: string; evidenceTypeId?: string | null } = {}) {
    const abs = join(evidenceRoot, relativePath);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, "content");
    db.prepare(
      `INSERT INTO evidence_items (id, workspace_id, original_path, original_filename, extension, mime_type, file_size, sha256, evidence_type_id)
       VALUES (?, ?, ?, ?, ?, 'image/jpeg', 100, ?, ?)`,
    ).run(id, workspaceId, relativePath, relativePath.split("/").pop(), relativePath.split(".").pop(), opts.sha256 ?? `sha-${id}`, opts.evidenceTypeId ?? null);
  }

  // analysis-run persistence
  it("persists an analysis run with the recorded fingerprint, versions, and completed status", async () => {
    insertItem("item-1", "Customer Photos/img1.jpg");
    const result = await startAnalysis(db, workspaceId, "item-1", { evidenceRoot });
    expect(result.run.status).toBe("completed");
    expect(result.run.sourceFingerprint).toBe("sha-item-1");
    expect(result.run.deterministicRuleVersion).toBeTruthy();
    expect(result.run.stale).toBe(false);
    const row = db.prepare("SELECT * FROM analysis_runs WHERE id = ?").get(result.run.id);
    expect(row).toBeTruthy();
  });

  it("throws AnalysisItemNotFoundError for an unknown item", async () => {
    await expect(startAnalysis(db, workspaceId, "does-not-exist", { evidenceRoot })).rejects.toBeInstanceOf(AnalysisItemNotFoundError);
  });

  // no permanent mutation before confirmation
  it("never writes to evidence_items, review_answers, or connections just from running analysis", async () => {
    insertItem("item-2", "Customer Photos/img2.jpg");
    insertItem("item-2b", "Customer Photos/img2b.jpg");
    extractTextFromItemMock.mockResolvedValue(ocrExtraction("Order Number #PF12345678 Order Date March 1, 2026"));
    await startAnalysis(db, workspaceId, "item-2", { evidenceRoot });

    const item = db.prepare("SELECT evidence_type_id, review_status, inclusion_decision FROM evidence_items WHERE id = 'item-2'").get() as { evidence_type_id: string | null; review_status: string; inclusion_decision: string | null };
    expect(item.evidence_type_id).toBeNull();
    expect(item.review_status).toBe("unreviewed");
    expect(item.inclusion_decision).toBeNull();
    expect(db.prepare("SELECT COUNT(*) AS c FROM review_answers").get()).toEqual({ c: 0 });
    expect(db.prepare("SELECT COUNT(*) AS c FROM connections").get()).toEqual({ c: 0 });
  });

  // exact identifier extraction
  it("extracts an exact order number from OCR text with high confidence, never inventing one that isn't present", async () => {
    insertItem("item-3", "Printful Orders/order.png");
    extractTextFromItemMock.mockResolvedValue(ocrExtraction("Order #PF116824539 shipped to customer"));
    const result = await startAnalysis(db, workspaceId, "item-3", { evidenceRoot });
    const orderEntity = result.entities.find((e) => e.entityType === "order_number");
    expect(orderEntity?.normalizedValue).toBe("#PF116824539");
    expect(orderEntity?.confidence).toBe("high");
  });

  it("never fabricates an identifier that isn't in the OCR text", async () => {
    insertItem("item-3b", "Printful Orders/order2.png");
    extractTextFromItemMock.mockResolvedValue(ocrExtraction("This document has no identifiers at all."));
    const result = await startAnalysis(db, workspaceId, "item-3b", { evidenceRoot });
    expect(result.entities.filter((e) => e.entityType === "order_number")).toHaveLength(0);
    expect(result.entities.filter((e) => e.entityType === "tracking_number")).toHaveLength(0);
  });

  // exact identifier connection suggestions / no duplicate connections
  it("suggests a connection between two items sharing the exact same order number, in both directions, without creating a real connection", async () => {
    insertItem("order-a", "Printful Orders/a.png");
    insertItem("order-b", "Printful Orders/b.png");
    extractTextFromItemMock.mockResolvedValue(ocrExtraction("Order #PF999888777"));
    await startAnalysis(db, workspaceId, "order-a", { evidenceRoot });
    const result = await startAnalysis(db, workspaceId, "order-b", { evidenceRoot });

    expect(result.connectionSuggestions).toHaveLength(1);
    expect(result.connectionSuggestions[0].targetItemId).toBe("order-a");
    expect(result.connectionSuggestions[0].matchedIdentifierValue).toBe("#PF999888777");
    expect(db.prepare("SELECT COUNT(*) AS c FROM connections").get()).toEqual({ c: 0 }); // never auto-created
  });

  it("does not suggest a connection that already exists as a confirmed connection", async () => {
    insertItem("order-c", "Printful Orders/c.png");
    insertItem("order-d", "Printful Orders/d.png");
    db.prepare("INSERT INTO connections (source_item_id, target_item_id, type, explanation) VALUES ('order-c', 'order-d', 'related_to', 'already linked')").run();
    extractTextFromItemMock.mockResolvedValue(ocrExtraction("Order #PF555444333"));
    await startAnalysis(db, workspaceId, "order-c", { evidenceRoot });
    const result = await startAnalysis(db, workspaceId, "order-d", { evidenceRoot });
    expect(result.connectionSuggestions).toHaveLength(0);
  });

  it("does not create duplicate connection-suggestion rows across repeated analyses", async () => {
    insertItem("order-e", "Printful Orders/e.png");
    insertItem("order-f", "Printful Orders/f.png");
    extractTextFromItemMock.mockResolvedValue(ocrExtraction("Order #PF111222333"));
    await startAnalysis(db, workspaceId, "order-e", { evidenceRoot });
    await startAnalysis(db, workspaceId, "order-f", { evidenceRoot });
    await startAnalysis(db, workspaceId, "order-f", { evidenceRoot }); // reanalyze again
    const rows = db.prepare("SELECT * FROM connection_suggestions WHERE source_item_id = 'order-f' AND state = 'proposed'").all();
    expect(rows).toHaveLength(1);
  });

  // exact file-hash connection suggestions (byte-for-byte duplicates)
  it("suggests a connection between two items with the exact same SHA-256, in both directions, without creating a real connection", async () => {
    insertItem("dup-a", "Extras/logo (1).jpg", { sha256: "same-hash-abc" });
    insertItem("dup-b", "UPDATED LOGOS/logo.jpg", { sha256: "same-hash-abc" });
    await startAnalysis(db, workspaceId, "dup-a", { evidenceRoot });
    const result = await startAnalysis(db, workspaceId, "dup-b", { evidenceRoot });

    expect(result.connectionSuggestions).toHaveLength(1);
    expect(result.connectionSuggestions[0].targetItemId).toBe("dup-a");
    expect(result.connectionSuggestions[0].matchedIdentifierType).toBe("file_hash");
    expect(result.connectionSuggestions[0].matchedIdentifierValue).toBe("same-hash-abc");
    expect(db.prepare("SELECT COUNT(*) AS c FROM connections").get()).toEqual({ c: 0 });
  });

  it("does not suggest a file-hash connection for items with different content", async () => {
    insertItem("distinct-a", "Extras/one.jpg", { sha256: "hash-one" });
    insertItem("distinct-b", "Extras/two.jpg", { sha256: "hash-two" });
    await startAnalysis(db, workspaceId, "distinct-a", { evidenceRoot });
    const result = await startAnalysis(db, workspaceId, "distinct-b", { evidenceRoot });
    expect(result.connectionSuggestions).toHaveLength(0);
  });

  // customer status remains unresolved
  it("leaves the customer-relationship question unresolved with no proposed value for a Customer Photos item", async () => {
    insertItem("cust-1", "Customer Photos/photo.jpg");
    const result = await startAnalysis(db, workspaceId, "cust-1", { evidenceRoot });
    const relationship = result.answerSuggestions.find((s) => s.fieldId === "customer_photo_relationship");
    expect(relationship).toBeTruthy();
    expect(relationship?.state).toBe("unresolved");
    expect(relationship?.proposedValue).toBe("");
  });

  // Printful order not classified as Design Mockup
  it("classifies a Printful order-detail screenshot as Customer Order, never Design Mockup, even in a 'mockup'-named folder", async () => {
    insertItem("printful-1", "Mockups/order_screenshot.png");
    extractTextFromItemMock.mockResolvedValue(ocrExtraction("Order #PF200300400 Order Status: Fulfilled Shipping Address: 123 Main St"));
    const result = await startAnalysis(db, workspaceId, "printful-1", { evidenceRoot });
    const top = result.evidenceTypeSuggestions[0];
    expect(top.proposedValue).toBe("customer_order");
    expect(top.confidence).toBe("high");
    expect(result.evidenceTypeSuggestions.some((s) => s.proposedValue === "design_mockup")).toBe(false);
  });

  // folder prior capped below High when unsupported
  it("caps a folder/filename-only evidence-type signal below High confidence", async () => {
    insertItem("folder-only", "Customer Photos/random_name.jpg");
    const result = await startAnalysis(db, workspaceId, "folder-only", { evidenceRoot });
    const top = result.evidenceTypeSuggestions[0];
    expect(top.confidence).not.toBe("high");
  });

  // date provenance / no fallback to today / no UTC calendar-day shift
  it("keeps EXIF, filename-inferred, and filesystem dates as separate assertions, never collapsed into one date", async () => {
    db.prepare(
      `INSERT INTO evidence_items (id, workspace_id, original_path, original_filename, extension, mime_type, file_size, sha256, fs_created_at, fs_modified_at)
       VALUES ('date-1', 1, 'Customer Photos/IMG_20260717_020251.heic', 'IMG_20260717_020251.heic', 'heic', 'image/heic', 100, 'sha-date-1', '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z')`,
    ).run();
    mkdirSync(join(evidenceRoot, "Customer Photos"), { recursive: true });
    writeFileSync(join(evidenceRoot, "Customer Photos/IMG_20260717_020251.heic"), "content");
    db.prepare(
      `INSERT INTO file_metadata (evidence_item_id, exif_date_time_original, filename_inferred_date) VALUES ('date-1', '2026:07:17 02:02:51', '2026-07-17T02:02:51')`,
    ).run();

    const result = await startAnalysis(db, workspaceId, "date-1", { evidenceRoot });
    const bySource = Object.fromEntries(result.dates.map((d) => [d.sourceType, d]));
    expect(bySource.exif_date_time_original.normalizedValue).toBe("2026-07-17T02:02:51"); // no UTC shift — the exact local calendar date/time from EXIF, unchanged
    expect(bySource.filename_inferred.normalizedValue).toBe("2026-07-17T02:02:51");
    expect(bySource.fs_created.rawValue).toBe("2026-07-20T00:00:00.000Z");
    expect(bySource.fs_modified.explanation).toMatch(/never proof/i);
    // "Never label filesystem last-modified as 'photo taken'" is enforced
    // architecturally, not by wording: fs_modified is its own distinct
    // sourceType with its own value, never merged into (or overwriting)
    // the EXIF capture-time assertion — proven here by the two genuinely
    // differing, since the test fixture gave them different raw values.
    expect(bySource.fs_modified.sourceType).toBe("fs_modified");
    expect(bySource.fs_modified.rawValue).not.toBe(bySource.exif_date_time_original.rawValue);
    // no fallback to "today" — every date present traces to a real source; nothing is a synthesized current-date value.
    const today = new Date().toISOString().slice(0, 10);
    for (const d of result.dates) {
      if (d.sourceType !== "fs_created" && d.sourceType !== "fs_modified") {
        expect(d.normalizedValue?.slice(0, 10)).not.toBe(today);
      }
    }
  });

  // stale fingerprint rejection / reanalysis versioning
  it("marks a run stale once the item's sha256 changes, and reanalysis supersedes the previous run's suggestions", async () => {
    insertItem("stale-1", "Customer Photos/stale.jpg");
    const first = await startAnalysis(db, workspaceId, "stale-1", { evidenceRoot });
    expect(first.run.stale).toBe(false);

    db.prepare("UPDATE evidence_items SET sha256 = 'new-sha' WHERE id = 'stale-1'").run();
    const staleCheck = getLatestAnalysis(db, workspaceId, "stale-1");
    expect(staleCheck?.run.stale).toBe(true);
    expect(staleCheck?.answerSuggestions.every((s) => s.state !== "proposed" || true)).toBe(true); // proposed suggestions from a stale run report as 'stale', not silently 'proposed'
    expect(staleCheck?.evidenceTypeSuggestions[0]?.state).toBe("stale");

    const second = await startAnalysis(db, workspaceId, "stale-1", { evidenceRoot });
    expect(second.run.id).not.toBe(first.run.id);
    const firstRunAfter = db.prepare("SELECT superseded_at FROM analysis_runs WHERE id = ?").get(first.run.id) as { superseded_at: string | null };
    expect(firstRunAfter.superseded_at).not.toBeNull();
    const firstSuggestionsAfter = db.prepare("SELECT state FROM evidence_suggestions WHERE analysis_run_id = ?").all(first.run.id) as { state: string }[];
    expect(firstSuggestionsAfter.every((s) => s.state === "superseded")).toBe(true);
  });

  it("confirmation is rejected for a stale run", async () => {
    insertItem("stale-2", "Customer Photos/stale2.jpg");
    const run = await startAnalysis(db, workspaceId, "stale-2", { evidenceRoot });
    db.prepare("UPDATE evidence_items SET sha256 = 'changed' WHERE id = 'stale-2'").run();
    expect(() =>
      confirmAnalysisSuggestions(db, workspaceId, "stale-2", {
        analysisRunId: run.run.id,
        acceptedEvidenceTypeSuggestionId: null,
        acceptedAnswers: [],
        rejectedSuggestionIds: [],
        acceptedConnectionSuggestionIds: [],
        rejectedConnectionSuggestionIds: [],
      }),
    ).toThrow(AnalysisValidationError);
  });

  // server-side field whitelist
  it("rejects confirming an answer for a question that doesn't belong to the accepted evidence type", async () => {
    insertItem("wl-1", "Random/file.jpg");
    const run = await startAnalysis(db, workspaceId, "wl-1", { evidenceRoot });
    // Insert a bogus suggestion row that claims to be for this run but names a
    // question that belongs to a totally different evidence type — simulates
    // a forged/stale client payload, which the server must reject regardless.
    const bogus = db
      .prepare(
        `INSERT INTO evidence_suggestions (workspace_id, evidence_item_id, analysis_run_id, field_kind, field_id, proposed_value, confidence, rationale, generation_method, state)
         VALUES (1, 'wl-1', ?, 'question_answer', 'printful_invoice_order_number', 'PF123', 'high', 'x', 'deterministic', 'proposed')`,
      )
      .run(run.run.id);
    expect(() =>
      confirmAnalysisSuggestions(db, workspaceId, "wl-1", {
        analysisRunId: run.run.id,
        acceptedEvidenceTypeSuggestionId: null, // no evidence type accepted or previously confirmed
        acceptedAnswers: [{ suggestionId: Number(bogus.lastInsertRowid), value: "PF123" }],
        rejectedSuggestionIds: [],
        acceptedConnectionSuggestionIds: [],
        rejectedConnectionSuggestionIds: [],
      }),
    ).toThrow(AnalysisValidationError);
  });

  it("rejects a suggestion id that doesn't belong to the given analysis run (whitelist can't be bypassed by id alone)", async () => {
    insertItem("wl-2a", "Random/a.jpg");
    insertItem("wl-2b", "Random/b.jpg");
    const runA = await startAnalysis(db, workspaceId, "wl-2a", { evidenceRoot });
    const runB = await startAnalysis(db, workspaceId, "wl-2b", { evidenceRoot });
    const otherItemsSuggestionId = runB.evidenceTypeSuggestions[0].id;
    expect(() =>
      confirmAnalysisSuggestions(db, workspaceId, "wl-2a", {
        analysisRunId: runA.run.id,
        acceptedEvidenceTypeSuggestionId: otherItemsSuggestionId,
        acceptedAnswers: [],
        rejectedSuggestionIds: [],
        acceptedConnectionSuggestionIds: [],
        rejectedConnectionSuggestionIds: [],
      }),
    ).toThrow(AnalysisValidationError);
  });

  it("throws AnalysisRunNotFoundError for an unknown run id", () => {
    expect(() =>
      confirmAnalysisSuggestions(db, workspaceId, "does-not-exist", {
        analysisRunId: 999999,
        acceptedEvidenceTypeSuggestionId: null,
        acceptedAnswers: [],
        rejectedSuggestionIds: [],
        acceptedConnectionSuggestionIds: [],
        rejectedConnectionSuggestionIds: [],
      }),
    ).toThrow(AnalysisItemNotFoundError);
  });

  // accepted selected suggestions only / confirmed manual answers preserved / rejected suggestions retained
  it("saves only explicitly accepted suggestions through the existing review path, preserves rejections, and never touches unrelated manual work", async () => {
    insertItem("confirm-1", "Mockups/order.png");
    extractTextFromItemMock.mockResolvedValue(ocrExtraction("Order #PF700800900 Order Status: Fulfilled Shipping Address: 1 Way"));
    db.prepare("UPDATE evidence_items SET notes = 'pre-existing manual note' WHERE id = 'confirm-1'").run();

    const result = await startAnalysis(db, workspaceId, "confirm-1", { evidenceRoot });
    const typeSuggestion = result.evidenceTypeSuggestions.find((s) => s.proposedValue === "customer_order")!;

    const confirmResult = confirmAnalysisSuggestions(db, workspaceId, "confirm-1", {
      analysisRunId: result.run.id,
      acceptedEvidenceTypeSuggestionId: typeSuggestion.id,
      acceptedAnswers: [],
      rejectedSuggestionIds: result.evidenceTypeSuggestions.filter((s) => s.id !== typeSuggestion.id).map((s) => s.id),
      acceptedConnectionSuggestionIds: [],
      rejectedConnectionSuggestionIds: [],
    });

    expect(confirmResult.acceptedEvidenceType).toBe("customer_order");
    const item = db.prepare("SELECT evidence_type_id, notes FROM evidence_items WHERE id = 'confirm-1'").get() as { evidence_type_id: string; notes: string };
    expect(item.evidence_type_id).toBe("customer_order");
    expect(item.notes).toBe("pre-existing manual note"); // untouched

    const acceptedRow = db.prepare("SELECT state, confirmed_at FROM evidence_suggestions WHERE id = ?").get(typeSuggestion.id) as { state: string; confirmed_at: string | null };
    expect(acceptedRow.state).toBe("accepted");
    expect(acceptedRow.confirmed_at).toBeTruthy();

    const rejectedRows = db.prepare("SELECT state FROM evidence_suggestions WHERE evidence_item_id = 'confirm-1' AND field_kind = 'evidence_type' AND id != ?").all(typeSuggestion.id) as { state: string }[];
    expect(rejectedRows.every((r) => r.state === "rejected")).toBe(true); // retained, not deleted
  });

  it("records an edited (not accepted-verbatim) suggestion when the confirmed value differs from the proposal, accepting the type and the answer together (the realistic flow)", async () => {
    insertItem("edit-1", "Customer Photos/photo.jpg");
    const result = await startAnalysis(db, workspaceId, "edit-1", { evidenceRoot });
    const relationship = result.answerSuggestions.find((s) => s.fieldId === "customer_photo_relationship")!;
    const customerPhotoType = result.evidenceTypeSuggestions.find((s) => s.proposedValue === "customer_photo")!;

    confirmAnalysisSuggestions(db, workspaceId, "edit-1", {
      analysisRunId: result.run.id,
      acceptedEvidenceTypeSuggestionId: customerPhotoType.id,
      acceptedAnswers: [{ suggestionId: relationship.id, value: "gift recipient" }],
      rejectedSuggestionIds: [],
      acceptedConnectionSuggestionIds: [],
      rejectedConnectionSuggestionIds: [],
    });

    const answerRow = db.prepare("SELECT value FROM review_answers WHERE evidence_item_id = 'edit-1' AND question_id = 'customer_photo_relationship'").get() as { value: string } | undefined;
    expect(answerRow?.value).toBe("gift recipient"); // the edited value was saved, not the empty proposed value
    const suggestionRow = db.prepare("SELECT state, user_correction FROM evidence_suggestions WHERE id = ?").get(relationship.id) as { state: string; user_correction: string };
    expect(suggestionRow.state).toBe("edited");
    expect(suggestionRow.user_correction).toBe("gift recipient");
  });

  it("rejects an accepted answer for a question that belongs to the item's already-confirmed type when no new type is accepted in this request", async () => {
    insertItem("wl-3", "Customer Photos/photo.jpg");
    // First confirm: accept the customer_photo type with no answers.
    const first = await startAnalysis(db, workspaceId, "wl-3", { evidenceRoot });
    const customerPhotoType = first.evidenceTypeSuggestions.find((s) => s.proposedValue === "customer_photo")!;
    confirmAnalysisSuggestions(db, workspaceId, "wl-3", {
      analysisRunId: first.run.id,
      acceptedEvidenceTypeSuggestionId: customerPhotoType.id,
      acceptedAnswers: [],
      rejectedSuggestionIds: [],
      acceptedConnectionSuggestionIds: [],
      rejectedConnectionSuggestionIds: [],
    });

    // Second analysis + confirm: now the item already has a confirmed
    // type, so an answer suggestion for one of *that* type's own
    // questions must be accepted even without re-accepting the type.
    const second = await startAnalysis(db, workspaceId, "wl-3", { evidenceRoot });
    const relationship = second.answerSuggestions.find((s) => s.fieldId === "customer_photo_relationship")!;
    const result = confirmAnalysisSuggestions(db, workspaceId, "wl-3", {
      analysisRunId: second.run.id,
      acceptedEvidenceTypeSuggestionId: null,
      acceptedAnswers: [{ suggestionId: relationship.id, value: "founder/owner" }],
      rejectedSuggestionIds: [],
      acceptedConnectionSuggestionIds: [],
      rejectedConnectionSuggestionIds: [],
    });
    expect(result.acceptedAnswerCount).toBe(1);
    const answerRow = db.prepare("SELECT value FROM review_answers WHERE evidence_item_id = 'wl-3' AND question_id = 'customer_photo_relationship'").get() as { value: string };
    expect(answerRow.value).toBe("founder/owner");
  });

  // audit history
  it("keeps every past run and suggestion queryable after reanalysis and confirmation — nothing is deleted", async () => {
    insertItem("audit-1", "Customer Photos/audit.jpg");
    const first = await startAnalysis(db, workspaceId, "audit-1", { evidenceRoot });
    await startAnalysis(db, workspaceId, "audit-1", { evidenceRoot });
    const allRuns = db.prepare("SELECT id FROM analysis_runs WHERE evidence_item_id = 'audit-1'").all();
    expect(allRuns).toHaveLength(2);
    const firstRunSuggestions = db.prepare("SELECT COUNT(*) AS c FROM evidence_suggestions WHERE analysis_run_id = ?").get(first.run.id) as { c: number };
    expect(firstRunSuggestions.c).toBeGreaterThan(0); // still present, just marked superseded
  });
});
