import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";

// vi.mock factories are hoisted above regular top-level const
// declarations, so the mock fns they reference must themselves be
// created inside vi.hoisted() — otherwise referencing them below throws
// "Cannot access '...' before initialization".
const { libheifDecode, libheifCheckCapability, magickDecode, magickCheckCapability } = vi.hoisted(() => ({
  libheifDecode: vi.fn(),
  libheifCheckCapability: vi.fn(),
  magickDecode: vi.fn(),
  magickCheckCapability: vi.fn(),
}));

vi.mock("../../engines/heicDecoders/libheifJsDecoder.js", () => ({
  libheifJsDecoder: { id: "libheif-js", checkCapability: libheifCheckCapability, decode: libheifDecode },
}));
vi.mock("../../engines/heicDecoders/imageMagickDecoder.js", () => ({
  imageMagickDecoder: { id: "imagemagick", checkCapability: magickCheckCapability, decode: magickDecode },
}));

import { runMigrations } from "../../db/migrate.js";
import {
  ensureHeicPreview,
  getHeicBackfillJobStatus,
  getHeicPreviewInfo,
  HeicPreviewUnknownDecoderError,
  reconcileAbandonedHeicBackfillJobs,
  resolveReadyHeicPreviewFile,
  runHeicPreviewBackfill,
  type HeicPreviewPaths,
} from "../heicPreviewService.js";

const LIBHEIF_CAP_OK = { available: true, version: "1.19.8", failureReason: null };
const MAGICK_CAP_OK = { available: true, version: "7.1.2-24", failureReason: null };

let libheifCallCount = 0;
let magickCallCount = 0;

function installDefaultDecoders() {
  libheifCallCount = 0;
  magickCallCount = 0;
  libheifCheckCapability.mockResolvedValue(LIBHEIF_CAP_OK);
  libheifDecode.mockImplementation(async (_input: string, outputDir: string, itemId: string) => {
    libheifCallCount++;
    mkdirSync(outputDir, { recursive: true });
    const outputPath = join(outputDir, `${itemId}.jpg`);
    writeFileSync(outputPath, "fake-jpeg-bytes");
    return { ok: true, outputPath, outputFormat: "jpeg", mimeType: "image/jpeg", width: 100, height: 100, reason: null };
  });
  magickCheckCapability.mockResolvedValue(MAGICK_CAP_OK);
  magickDecode.mockImplementation(async (_input: string, outputDir: string, itemId: string) => {
    magickCallCount++;
    mkdirSync(outputDir, { recursive: true });
    const outputPath = join(outputDir, `${itemId}.webp`);
    writeFileSync(outputPath, "fake-webp-bytes");
    return { ok: true, outputPath, outputFormat: "webp", mimeType: "image/webp", width: 100, height: 100, reason: null };
  });
}

async function waitForBackfillDone(db: Database.Database, workspaceId: number, jobId: number, maxIterations = 100) {
  for (let i = 0; i < maxIterations; i++) {
    const job = getHeicBackfillJobStatus(db, workspaceId, jobId)!;
    if (job.status !== "running") return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("backfill did not finish in time");
}

describe("heicPreviewService", () => {
  let db: Database.Database;
  let workDir: string;
  let paths: HeicPreviewPaths;
  const workspaceId = 1;

  beforeEach(() => {
    vi.clearAllMocks();
    installDefaultDecoders();

    db = new Database(":memory:");
    runMigrations(db);
    db.prepare("INSERT INTO workspaces (id, name, evidence_root) VALUES (1, 'Test', 'unused')").run();

    workDir = mkdtempSync(join(tmpdir(), "heic-preview-test-"));
    paths = { evidenceRoot: join(workDir, "evidence"), generatedRoot: join(workDir, "generated", "heic-previews") };
  });

  afterEach(() => {
    db.close();
    rmSync(workDir, { recursive: true, force: true });
  });

  function insertHeicItem(id: string, relativePath: string, sha256 = "sha-1", opts: { missing?: boolean } = {}): void {
    db.prepare(
      `INSERT INTO evidence_items (id, workspace_id, original_path, original_filename, extension, mime_type, file_size, sha256, missing_since)
       VALUES (?, ?, ?, ?, 'heic', 'image/heic', 100, ?, ?)`,
    ).run(id, workspaceId, relativePath, relativePath, sha256, opts.missing ? "2026-01-01T00:00:00.000Z" : null);
  }

  function writeRealFile(relativePath: string) {
    const abs = join(paths.evidenceRoot, relativePath);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, "not-really-a-heic-file");
  }

  /** Simulates a row left behind by the pre-decoder-abstraction, ImageMagick-only pipeline: `auto`-selected, generator "imagemagick", status ready. */
  function insertLegacyImageMagickReadyRow(itemId: string, sha256: string, relativePath: string) {
    db.prepare(
      `INSERT INTO heic_previews (evidence_item_id, preview_relative_path, preview_mime_type, preview_status, preview_generated_at, preview_generator, preview_generator_version, source_fingerprint, decoder_selection)
       VALUES (?, ?, 'image/webp', 'ready', datetime('now'), 'imagemagick', '7.1.2-24', ?, 'auto')`,
    ).run(itemId, relativePath, sha256);
  }

  it("generates a ready preview successfully using the preferred (libheif-js) decoder", async () => {
    insertHeicItem("item-1", "IMG_1.heic");
    writeRealFile("IMG_1.heic");

    const result = await ensureHeicPreview(db, workspaceId, "item-1", paths);
    expect(result.status).toBe("ready");
    expect(result.previewMimeType).toBe("image/jpeg");
    expect(result.previewGenerator).toBe("libheif-js");
    expect(result.decoderSelection).toBe("auto");
    expect(magickCallCount).toBe(0); // never automatically falls back to ImageMagick

    const resolved = resolveReadyHeicPreviewFile(db, workspaceId, "item-1", paths.generatedRoot);
    expect(resolved).not.toBeNull();
    expect(existsSync(resolved!.absolutePath)).toBe(true);
  });

  it("reports unsupported_backend with a safe reason when the preferred decoder is unavailable, and never automatically tries ImageMagick", async () => {
    libheifCheckCapability.mockResolvedValue({ available: false, version: null, failureReason: "libheif-js WASM module failed to initialize: boom" });
    insertHeicItem("item-unsupported", "IMG_2.heic");
    writeRealFile("IMG_2.heic");

    const result = await ensureHeicPreview(db, workspaceId, "item-unsupported", paths);
    expect(result.status).toBe("unsupported_backend");
    expect(result.previewGenerator).toBe("libheif-js");
    expect(result.conversionError).toMatch(/libheif-js/);
    expect(libheifDecode).not.toHaveBeenCalled();
    expect(magickCheckCapability).not.toHaveBeenCalled();
    expect(magickDecode).not.toHaveBeenCalled();
  });

  it("reuses an existing valid preview instead of reconverting", async () => {
    insertHeicItem("item-reuse", "IMG_3.heic");
    writeRealFile("IMG_3.heic");

    await ensureHeicPreview(db, workspaceId, "item-reuse", paths);
    expect(libheifCallCount).toBe(1);

    const second = await ensureHeicPreview(db, workspaceId, "item-reuse", paths);
    expect(second.status).toBe("ready");
    expect(libheifCallCount).toBe(1); // no second conversion
  });

  it("a changed source fingerprint invalidates and regenerates the preview", async () => {
    insertHeicItem("item-stale", "IMG_4.heic", "sha-original");
    writeRealFile("IMG_4.heic");
    await ensureHeicPreview(db, workspaceId, "item-stale", paths);
    expect(libheifCallCount).toBe(1);

    db.prepare("UPDATE evidence_items SET sha256 = ? WHERE id = ?").run("sha-changed", "item-stale");
    const info = getHeicPreviewInfo(db, workspaceId, "item-stale");
    expect(info?.status).toBe("stale");

    const regenerated = await ensureHeicPreview(db, workspaceId, "item-stale", paths);
    expect(regenerated.status).toBe("ready");
    expect(libheifCallCount).toBe(2);
  });

  it("a missing original file is reported as source_missing, never attempted", async () => {
    insertHeicItem("item-missing", "gone.heic", "sha-1", { missing: true });
    const result = await ensureHeicPreview(db, workspaceId, "item-missing", paths);
    expect(result.status).toBe("source_missing");
    expect(libheifCallCount).toBe(0);
  });

  it("prevents duplicate conversion jobs — two concurrent requests for the same item share one conversion", async () => {
    insertHeicItem("item-concurrent", "IMG_6.heic");
    writeRealFile("IMG_6.heic");

    const [a, b] = await Promise.all([ensureHeicPreview(db, workspaceId, "item-concurrent", paths), ensureHeicPreview(db, workspaceId, "item-concurrent", paths)]);
    expect(a.status).toBe("ready");
    expect(b.status).toBe("ready");
    expect(libheifCallCount).toBe(1);
  });

  it("a failed conversion records a safe error and can be retried successfully", async () => {
    insertHeicItem("item-retry", "IMG_7.heic");
    writeRealFile("IMG_7.heic");

    libheifDecode.mockResolvedValueOnce({ ok: false, outputPath: null, outputFormat: null, mimeType: null, width: null, height: null, reason: "libheif-js could not decode this file: corrupt data" });

    const failed = await ensureHeicPreview(db, workspaceId, "item-retry", paths);
    expect(failed.status).toBe("failed");
    expect(failed.conversionError).toBe("libheif-js could not decode this file: corrupt data");

    const retried = await ensureHeicPreview(db, workspaceId, "item-retry", paths);
    expect(retried.status).toBe("ready");
  });

  it("a legacy ImageMagick-generated ready row is reported stale and transparently regenerated with the preferred decoder — this is the corruption-recovery path", async () => {
    insertHeicItem("item-legacy", "IMG_8.heic", "sha-legacy");
    writeRealFile("IMG_8.heic");
    insertLegacyImageMagickReadyRow("item-legacy", "sha-legacy", "item-legacy.webp");

    const info = getHeicPreviewInfo(db, workspaceId, "item-legacy");
    expect(info?.status).toBe("stale"); // never reported ready just because a row exists

    const regenerated = await ensureHeicPreview(db, workspaceId, "item-legacy", paths);
    expect(regenerated.status).toBe("ready");
    expect(regenerated.previewGenerator).toBe("libheif-js");
    expect(regenerated.decoderSelection).toBe("auto");
    expect(libheifCallCount).toBe(1);
    expect(magickCallCount).toBe(0); // corrupted ImageMagick cache is never reused, and never re-tried automatically either
  });

  it('an explicit "Retry with Alternate Decoder" request (decoderId) always regenerates and is recorded as decoder_selection "manual"', async () => {
    insertHeicItem("item-manual", "IMG_9.heic");
    writeRealFile("IMG_9.heic");

    await ensureHeicPreview(db, workspaceId, "item-manual", paths); // auto, libheif-js
    expect(libheifCallCount).toBe(1);

    const manual = await ensureHeicPreview(db, workspaceId, "item-manual", paths, { decoderId: "imagemagick" });
    expect(manual.status).toBe("ready");
    expect(manual.previewGenerator).toBe("imagemagick");
    expect(manual.decoderSelection).toBe("manual");
    expect(magickCallCount).toBe(1);

    // A manual row is never silently overwritten by the decoder-outdated staleness rule.
    const infoAfter = getHeicPreviewInfo(db, workspaceId, "item-manual");
    expect(infoAfter?.status).toBe("ready");
    expect(infoAfter?.previewGenerator).toBe("imagemagick");
  });

  it("an unknown decoderId is rejected without touching any decoder", async () => {
    insertHeicItem("item-unknown-decoder", "IMG_10.heic");
    writeRealFile("IMG_10.heic");

    await expect(ensureHeicPreview(db, workspaceId, "item-unknown-decoder", paths, { decoderId: "does-not-exist" })).rejects.toBeInstanceOf(HeicPreviewUnknownDecoderError);
    expect(libheifDecode).not.toHaveBeenCalled();
    expect(magickDecode).not.toHaveBeenCalled();
  });

  it('"Regenerate Preview" (force) re-runs the preferred decoder even though a ready, current preview already exists', async () => {
    insertHeicItem("item-force", "IMG_11.heic");
    writeRealFile("IMG_11.heic");

    await ensureHeicPreview(db, workspaceId, "item-force", paths);
    expect(libheifCallCount).toBe(1);

    const forced = await ensureHeicPreview(db, workspaceId, "item-force", paths, { force: true });
    expect(forced.status).toBe("ready");
    expect(libheifCallCount).toBe(2);
  });

  it("regenerating with a different decoder removes the orphaned previous preview file", async () => {
    insertHeicItem("item-orphan", "IMG_12.heic");
    writeRealFile("IMG_12.heic");

    await ensureHeicPreview(db, workspaceId, "item-orphan", paths); // libheif-js -> item-orphan.jpg
    const firstFile = resolveReadyHeicPreviewFile(db, workspaceId, "item-orphan", paths.generatedRoot)!;
    expect(existsSync(firstFile.absolutePath)).toBe(true);

    await ensureHeicPreview(db, workspaceId, "item-orphan", paths, { decoderId: "imagemagick" }); // -> item-orphan.webp
    expect(existsSync(firstFile.absolutePath)).toBe(false); // the old .jpg is gone, not left orphaned

    const secondFile = resolveReadyHeicPreviewFile(db, workspaceId, "item-orphan", paths.generatedRoot)!;
    expect(existsSync(secondFile.absolutePath)).toBe(true);
  });

  it("backfill processes existing HEIC records and is idempotent on rerun", async () => {
    insertHeicItem("bf-1", "bf1.heic");
    insertHeicItem("bf-2", "bf2.heic");
    writeRealFile("bf1.heic");
    writeRealFile("bf2.heic");

    const jobId = await runHeicPreviewBackfill(db, workspaceId, paths, 2);
    const job = await waitForBackfillDone(db, workspaceId, jobId);
    expect(job.status).toBe("completed");
    expect(job.totalCount).toBe(2);
    expect(job.succeededCount).toBe(2);
    expect(job.failedCount).toBe(0);
    expect(libheifCallCount).toBe(2);

    const secondJobId = await runHeicPreviewBackfill(db, workspaceId, paths, 2);
    const secondJob = await waitForBackfillDone(db, workspaceId, secondJobId);
    expect(secondJob.totalCount).toBe(2);
    expect(secondJob.skippedCount).toBe(2);
    expect(secondJob.succeededCount).toBe(0);
    expect(libheifCallCount).toBe(2); // unchanged — nothing reconverted
  });

  it("backfill also regenerates legacy ImageMagick-generated rows, not just missing ones", async () => {
    insertHeicItem("bf-legacy", "bf3.heic", "sha-bf-legacy");
    writeRealFile("bf3.heic");
    insertLegacyImageMagickReadyRow("bf-legacy", "sha-bf-legacy", "bf-legacy.webp");

    const jobId = await runHeicPreviewBackfill(db, workspaceId, paths, 2);
    const job = await waitForBackfillDone(db, workspaceId, jobId);
    expect(job.succeededCount).toBe(1);
    expect(job.skippedCount).toBe(0);

    const info = getHeicPreviewInfo(db, workspaceId, "bf-legacy");
    expect(info?.status).toBe("ready");
    expect(info?.previewGenerator).toBe("libheif-js");
  });

  describe("backfill job lifecycle", () => {
    /** Resolves after the given number of macrotask ticks — enough for a real await chain in `runWithConcurrency` to actually run, without a fixed (flaky) millisecond delay. */
    function tick(times = 1): Promise<void> {
      return times <= 1 ? new Promise((resolve) => setTimeout(resolve, 0)) : tick(1).then(() => tick(times - 1));
    }

    it("progress advances from 0 as each item is processed, not only once at the end", async () => {
      insertHeicItem("prog-1", "prog1.heic");
      insertHeicItem("prog-2", "prog2.heic");
      writeRealFile("prog1.heic");
      writeRealFile("prog2.heic");

      let releaseFirst!: () => void;
      const firstGate = new Promise<void>((resolve) => (releaseFirst = resolve));
      libheifDecode.mockImplementation(async (_input: string, outputDir: string, itemId: string) => {
        if (itemId === "prog-1") await firstGate;
        mkdirSync(outputDir, { recursive: true });
        const outputPath = join(outputDir, `${itemId}.jpg`);
        writeFileSync(outputPath, "fake-jpeg-bytes");
        return { ok: true, outputPath, outputFormat: "jpeg", mimeType: "image/jpeg", width: 100, height: 100, reason: null };
      });

      const jobId = await runHeicPreviewBackfill(db, workspaceId, paths, 1); // concurrency 1: strictly sequential
      await tick(3);
      const midway = getHeicBackfillJobStatus(db, workspaceId, jobId)!;
      expect(midway.status).toBe("running");
      expect(midway.processedCount).toBe(0); // still blocked on prog-1

      releaseFirst();
      const job = await waitForBackfillDone(db, workspaceId, jobId);
      expect(job.status).toBe("completed");
      expect(job.processedCount).toBe(2);
      expect(job.succeededCount).toBe(2);
    });

    it("a partial failure produces status completed_with_failures, with the other items still succeeding", async () => {
      insertHeicItem("pf-1", "pf1.heic");
      insertHeicItem("pf-2", "pf2.heic");
      insertHeicItem("pf-3", "pf3.heic");
      writeRealFile("pf1.heic");
      writeRealFile("pf2.heic");
      writeRealFile("pf3.heic");

      libheifDecode.mockImplementation(async (_input: string, outputDir: string, itemId: string) => {
        if (itemId === "pf-2") {
          return { ok: false, outputPath: null, outputFormat: null, mimeType: null, width: null, height: null, reason: "simulated decode failure" };
        }
        mkdirSync(outputDir, { recursive: true });
        const outputPath = join(outputDir, `${itemId}.jpg`);
        writeFileSync(outputPath, "fake-jpeg-bytes");
        return { ok: true, outputPath, outputFormat: "jpeg", mimeType: "image/jpeg", width: 100, height: 100, reason: null };
      });

      const jobId = await runHeicPreviewBackfill(db, workspaceId, paths, 3);
      const job = await waitForBackfillDone(db, workspaceId, jobId);
      expect(job.status).toBe("completed_with_failures");
      expect(job.totalCount).toBe(3);
      expect(job.succeededCount).toBe(2); // one failed item never blocks the other two
      expect(job.failedCount).toBe(1);

      expect(getHeicPreviewInfo(db, workspaceId, "pf-1")?.status).toBe("ready");
      expect(getHeicPreviewInfo(db, workspaceId, "pf-3")?.status).toBe("ready");
    });

    it("a job left 'running' by a previous process is reconciled to 'interrupted' and does not block a new backfill", async () => {
      const staleJobId = db
        .prepare("INSERT INTO heic_backfill_jobs (workspace_id, status, created_at, total_count) VALUES (?, 'running', datetime('now'), 3)")
        .run(workspaceId).lastInsertRowid as number;

      insertHeicItem("recon-1", "recon1.heic");
      writeRealFile("recon1.heic");

      const newJobId = await runHeicPreviewBackfill(db, workspaceId, paths, 2);
      expect(newJobId).not.toBe(staleJobId); // a genuinely new job, not blocked by the stale row

      const stale = getHeicBackfillJobStatus(db, workspaceId, staleJobId)!;
      expect(stale.status).toBe("interrupted");
      expect(stale.errorMessage).toBeTruthy();

      const newJob = await waitForBackfillDone(db, workspaceId, newJobId);
      expect(newJob.status).toBe("completed");
      expect(newJob.succeededCount).toBe(1);
    });

    it("reconcileAbandonedHeicBackfillJobs never touches a job actually still running in this process", async () => {
      insertHeicItem("live-1", "live1.heic");
      writeRealFile("live1.heic");

      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      libheifDecode.mockImplementation(async (_input: string, outputDir: string, itemId: string) => {
        await gate;
        mkdirSync(outputDir, { recursive: true });
        const outputPath = join(outputDir, `${itemId}.jpg`);
        writeFileSync(outputPath, "fake-jpeg-bytes");
        return { ok: true, outputPath, outputFormat: "jpeg", mimeType: "image/jpeg", width: 100, height: 100, reason: null };
      });

      const jobId = await runHeicPreviewBackfill(db, workspaceId, paths, 1);
      await tick(3);

      reconcileAbandonedHeicBackfillJobs(db, workspaceId); // must be a no-op for a job this same process is still running
      expect(getHeicBackfillJobStatus(db, workspaceId, jobId)!.status).toBe("running");

      release();
      const job = await waitForBackfillDone(db, workspaceId, jobId);
      expect(job.status).toBe("completed");
    });

    it("duplicate-job prevention: a second call while a job is genuinely still active returns the same job id, not a new row", async () => {
      insertHeicItem("dup-1", "dup1.heic");
      insertHeicItem("dup-2", "dup2.heic");
      writeRealFile("dup1.heic");
      writeRealFile("dup2.heic");

      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      libheifDecode.mockImplementation(async (_input: string, outputDir: string, itemId: string) => {
        await gate;
        mkdirSync(outputDir, { recursive: true });
        const outputPath = join(outputDir, `${itemId}.jpg`);
        writeFileSync(outputPath, "fake-jpeg-bytes");
        return { ok: true, outputPath, outputFormat: "jpeg", mimeType: "image/jpeg", width: 100, height: 100, reason: null };
      });

      const firstJobId = await runHeicPreviewBackfill(db, workspaceId, paths, 2);
      await tick(3);
      const secondJobId = await runHeicPreviewBackfill(db, workspaceId, paths, 2);
      expect(secondJobId).toBe(firstJobId);

      const rowCount = (db.prepare("SELECT COUNT(*) AS c FROM heic_backfill_jobs").get() as { c: number }).c;
      expect(rowCount).toBe(1); // no duplicate row was ever created

      release();
      await waitForBackfillDone(db, workspaceId, firstJobId);
    });

    it("a new backfill call after a prior job fully completed starts a genuinely new job, not the old one", async () => {
      insertHeicItem("seq-1", "seq1.heic");
      writeRealFile("seq1.heic");
      const firstJobId = await runHeicPreviewBackfill(db, workspaceId, paths, 1);
      await waitForBackfillDone(db, workspaceId, firstJobId);

      insertHeicItem("seq-2", "seq2.heic");
      writeRealFile("seq2.heic");
      const secondJobId = await runHeicPreviewBackfill(db, workspaceId, paths, 1);
      expect(secondJobId).not.toBe(firstJobId);
      await waitForBackfillDone(db, workspaceId, secondJobId);
    });
  });

  it("a non-HEIC evidence item has no heic preview info at all", async () => {
    db.prepare(
      `INSERT INTO evidence_items (id, workspace_id, original_path, original_filename, extension, mime_type, file_size, sha256)
       VALUES ('jpg-item', ?, 'photo.jpg', 'photo.jpg', 'jpg', 'image/jpeg', 100, 'sha-jpg')`,
    ).run(workspaceId);
    expect(getHeicPreviewInfo(db, workspaceId, "jpg-item")).toBeNull();
  });
});
