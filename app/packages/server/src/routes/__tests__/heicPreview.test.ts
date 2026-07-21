import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import request from "supertest";

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

import { createApp } from "../../app.js";
import { runMigrations } from "../../db/migrate.js";
import type { ResolvedWorkspace } from "../../config/workspaceConfig.js";
import type { HeicBackfillJobStatus, HeicPreviewInfo } from "@trademark-evidence-assistant/shared";

function installDefaultDecoders() {
  libheifCheckCapability.mockResolvedValue({ available: true, version: "1.19.8", failureReason: null });
  libheifDecode.mockImplementation(async (_input: string, outputDir: string, itemId: string) => {
    mkdirSync(outputDir, { recursive: true });
    const outputPath = join(outputDir, `${itemId}.jpg`);
    writeFileSync(outputPath, "fake-jpeg-bytes");
    return { ok: true, outputPath, outputFormat: "jpeg", mimeType: "image/jpeg", width: 100, height: 100, reason: null };
  });
  magickCheckCapability.mockResolvedValue({ available: true, version: "7.1.2-24", failureReason: null });
  magickDecode.mockImplementation(async (_input: string, outputDir: string, itemId: string) => {
    mkdirSync(outputDir, { recursive: true });
    const outputPath = join(outputDir, `${itemId}.webp`);
    writeFileSync(outputPath, "fake-webp-bytes");
    return { ok: true, outputPath, outputFormat: "webp", mimeType: "image/webp", width: 100, height: 100, reason: null };
  });
}

async function pollUntil<T>(fn: () => T, predicate: (v: T) => boolean, maxIterations = 100): Promise<T> {
  for (let i = 0; i < maxIterations; i++) {
    const v = fn();
    if (predicate(v)) return v;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("condition never became true");
}

describe("HEIC preview routes", () => {
  const workspaceId = 1;
  let db: Database.Database;
  let workDir: string;
  let workspace: ResolvedWorkspace;

  beforeEach(() => {
    vi.clearAllMocks();
    installDefaultDecoders();

    db = new Database(":memory:");
    runMigrations(db);
    db.prepare("INSERT INTO workspaces (id, name, evidence_root) VALUES (1, 'Test', 'unused')").run();

    workDir = mkdtempSync(join(tmpdir(), "heic-route-test-"));
    const evidenceRoot = join(workDir, "evidence");
    mkdirSync(evidenceRoot, { recursive: true });
    workspace = { name: "Test", evidenceRoot, evidenceRootExists: true, databasePath: join(workDir, "generated", "app.db") };
  });

  afterEach(() => {
    db.close();
    rmSync(workDir, { recursive: true, force: true });
  });

  function buildApp() {
    return createApp(db, workspace, workspaceId);
  }

  function insertHeicItem(id: string, filename: string) {
    db.prepare(
      `INSERT INTO evidence_items (id, workspace_id, original_path, original_filename, extension, mime_type, file_size, sha256)
       VALUES (?, ?, ?, ?, 'heic', 'image/heic', 100, 'sha-1')`,
    ).run(id, workspaceId, filename, filename);
    writeFileSync(join(workspace.evidenceRoot, filename), "not-really-heic");
  }

  it("404s the status endpoint for a non-HEIC/HEIF or nonexistent item", async () => {
    db.prepare(
      `INSERT INTO evidence_items (id, workspace_id, original_path, original_filename, extension, mime_type, file_size, sha256)
       VALUES ('jpg-1', ?, 'a.jpg', 'a.jpg', 'jpg', 'image/jpeg', 10, 'sha')`,
    ).run(workspaceId);
    const app = buildApp();
    expect((await request(app).get("/api/evidence-items/jpg-1/heic-preview/status")).status).toBe(404);
    expect((await request(app).get("/api/evidence-items/does-not-exist/heic-preview/status")).status).toBe(404);
  });

  it("status starts not_requested for a fresh HEIC item, then generate produces a ready preview via the preferred decoder", async () => {
    insertHeicItem("heic-1", "IMG_1.heic");
    const app = buildApp();

    const statusRes = await request(app).get("/api/evidence-items/heic-1/heic-preview/status");
    expect(statusRes.status).toBe(200);
    expect((statusRes.body as HeicPreviewInfo).status).toBe("not_requested");

    const generateRes = await request(app).post("/api/evidence-items/heic-1/heic-preview/generate");
    expect(generateRes.status).toBe(200);
    const generated = generateRes.body as HeicPreviewInfo;
    expect(generated.status).toBe("ready");
    expect(generated.previewGenerator).toBe("libheif-js");
    expect(generated.decoderSelection).toBe("auto");
    expect(magickDecode).not.toHaveBeenCalled();

    const fileRes = await request(app).get("/api/evidence-items/heic-1/heic-preview/file");
    expect(fileRes.status).toBe(200);
    expect(fileRes.headers["content-type"]).toBe("image/jpeg");
  });

  it('"Retry with Alternate Decoder" (decoderId in the request body) regenerates using that specific decoder and records decoder_selection "manual"', async () => {
    insertHeicItem("heic-manual", "IMG_manual.heic");
    const app = buildApp();

    await request(app).post("/api/evidence-items/heic-manual/heic-preview/generate"); // auto -> libheif-js

    const retryRes = await request(app).post("/api/evidence-items/heic-manual/heic-preview/generate").send({ decoderId: "imagemagick" });
    expect(retryRes.status).toBe(200);
    const retried = retryRes.body as HeicPreviewInfo;
    expect(retried.previewGenerator).toBe("imagemagick");
    expect(retried.decoderSelection).toBe("manual");
    expect(magickDecode).toHaveBeenCalledTimes(1);
  });

  it("rejects an unknown decoderId with 400 and never calls a decoder", async () => {
    insertHeicItem("heic-bad-decoder", "IMG_bad.heic");
    const app = buildApp();

    const res = await request(app).post("/api/evidence-items/heic-bad-decoder/heic-preview/generate").send({ decoderId: "not-a-real-decoder" });
    expect(res.status).toBe(400);
    expect(libheifDecode).not.toHaveBeenCalled();
    expect(magickDecode).not.toHaveBeenCalled();
  });

  it('"Regenerate Preview" (force: true) re-runs generation even though a ready preview already exists', async () => {
    insertHeicItem("heic-force", "IMG_force.heic");
    const app = buildApp();

    await request(app).post("/api/evidence-items/heic-force/heic-preview/generate");
    expect(libheifDecode).toHaveBeenCalledTimes(1);

    const forcedRes = await request(app).post("/api/evidence-items/heic-force/heic-preview/generate").send({ force: true });
    expect(forcedRes.status).toBe(200);
    expect((forcedRes.body as HeicPreviewInfo).status).toBe("ready");
    expect(libheifDecode).toHaveBeenCalledTimes(2);
  });

  it("a preview row left by the previous ImageMagick-only pipeline is never served as ready — it's regenerated with the preferred decoder on first read", async () => {
    insertHeicItem("heic-legacy", "IMG_legacy.heic");
    db.prepare(
      `INSERT INTO heic_previews (evidence_item_id, preview_relative_path, preview_mime_type, preview_status, preview_generated_at, preview_generator, preview_generator_version, source_fingerprint, decoder_selection)
       VALUES ('heic-legacy', 'heic-legacy.webp', 'image/webp', 'ready', datetime('now'), 'imagemagick', '7.1.2-24', 'sha-1', 'auto')`,
    ).run();
    const app = buildApp();

    const statusRes = await request(app).get("/api/evidence-items/heic-legacy/heic-preview/status");
    expect((statusRes.body as HeicPreviewInfo).status).toBe("stale");

    const generateRes = await request(app).post("/api/evidence-items/heic-legacy/heic-preview/generate");
    const generated = generateRes.body as HeicPreviewInfo;
    expect(generated.status).toBe("ready");
    expect(generated.previewGenerator).toBe("libheif-js");
    expect(magickDecode).not.toHaveBeenCalled();
  });

  it("the preview file route 404s before a preview has ever been generated", async () => {
    insertHeicItem("heic-2", "IMG_2.heic");
    const app = buildApp();
    const res = await request(app).get("/api/evidence-items/heic-2/heic-preview/file");
    expect(res.status).toBe(404);
  });

  it("the original evidence item and the total evidence count are unaffected by preview generation", async () => {
    insertHeicItem("heic-3", "IMG_3.heic");
    const app = buildApp();
    const before = await request(app).get("/api/evidence-items/heic-3");

    await request(app).post("/api/evidence-items/heic-3/heic-preview/generate");

    const after = await request(app).get("/api/evidence-items/heic-3");
    expect(after.body.originalFilename).toBe(before.body.originalFilename);
    expect(after.body.sha256).toBe(before.body.sha256);
    const count = db.prepare("SELECT COUNT(*) AS c FROM evidence_items WHERE workspace_id = ?").get(workspaceId) as { c: number };
    expect(count.c).toBe(1); // the preview never becomes a second evidence item
  });

  it("backfill starts a job and reports progress via polling, not one request per file", async () => {
    insertHeicItem("heic-4", "IMG_4.heic");
    insertHeicItem("heic-5", "IMG_5.heic");
    const app = buildApp();

    const startRes = await request(app).post("/api/heic-previews/backfill");
    expect(startRes.status).toBe(202);
    const jobId = startRes.body.jobId as number;

    const finalJob = await pollUntil(
      () => db.prepare("SELECT status, succeeded_count, total_count FROM heic_backfill_jobs WHERE id = ?").get(jobId) as { status: string; succeeded_count: number; total_count: number },
      (j) => j.status !== "running",
    );
    expect(finalJob.status).toBe("completed");
    expect(finalJob.total_count).toBe(2);
    expect(finalJob.succeeded_count).toBe(2);

    const statusRes = await request(app).get(`/api/heic-previews/backfill/${jobId}`);
    expect(statusRes.status).toBe(200);
    expect((statusRes.body as HeicBackfillJobStatus).status).toBe("completed");
  });

  it("404s a backfill status request for an unknown job id", async () => {
    const app = buildApp();
    const res = await request(app).get("/api/heic-previews/backfill/999999");
    expect(res.status).toBe(404);
  });
});
