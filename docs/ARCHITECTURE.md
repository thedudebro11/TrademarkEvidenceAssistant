# Architecture

Restates and elaborates spec 02, 03, 07, 08, 09, 10, 12, 13 into a concrete
implementation shape. No code has been written; this is the plan those
phases will follow.

## System shape

```
Browser (React + TS + Vite)
   │  HTTP (localhost only)
   ▼
Express API (Node + TS)
   │                     │
   ▼                     ▼
SQLite (app data)   Filesystem layer (read-only originals,
                     write-only to cache/export/generated dirs)
```

- Single user, single machine, no auth layer needed beyond binding the
  server to localhost.
- The frontend never touches the filesystem or database directly — every
  read/write goes through the Express API, per spec 02.
- The filesystem layer has two distinct capabilities that must not share
  code paths: (a) read-only access to `workspaces/<name>/evidence/`, and
  (b) write access to `generated/`, `reports/`, `exports/` and an
  app-owned cache directory. Mixing these is the single biggest
  correctness risk in the whole system (see Risks).

## Data flow per spec area

- **Scan (04):** walk `workspaces/<workspace>/evidence/` recursively,
  skip `app/cache/database/export/generated` folders, hash each file
  (SHA-256), extract filesystem facts + type-specific metadata, upsert an
  `evidence_items` row keyed by a stable ID. Rescans are incremental and
  must not clobber existing review data for unchanged files.
- **Review (05):** Review Queue loads the next `unreviewed` item, serves
  preview + metadata + guided questions + candidate connections, autosaves
  answers, computes score, records the decision, advances.
- **Questions (06):** question set is selected by file role/type; every
  answer stores `value, source, confidence, note`.
- **Connections (07):** typed directed edges between evidence items,
  stored with explanation/confidence/creator/timestamp; rendered as
  simple chains (no graph UI in v1).
- **Scoring (08):** pure function over an item's metadata + answers +
  connections → `{score 0-100, band, explanation, missing_elements,
  supporting_links}`. Must be deterministic and re-run on demand, not
  cached as the only copy of the result (store it, but keep it
  recomputable).
- **Export (09):** copies only `Include`-decision items into a new
  `TrademarkEvidencePackage/` tree under `exports/`, using generated safe
  filenames, plus a private JSON/CSV mapping from export name back to
  `original_path` (that mapping file itself must stay out of anything
  handed to outside parties, since it reveals original filesystem
  layout).
- **Binder (10):** reads exported package + DB state, renders
  Markdown/HTML/JSON/CSV using the factual-language rules from spec 10.

## Application layering (implemented, Phase 2+)

Per `docs/ARCHITECTURE_CONSTITUTION.md` #2, #3, #8, routes never contain
business logic — they delegate to services, which orchestrate small,
independently-testable engines:

```
routes/<name>.ts        thin HTTP delegate — status codes, error shape
   ↓
services/<name>Service.ts   orchestration: calls engines, persists to
                             SQLite, owns incremental/idempotent logic
   ↓
engines/<name>Engine.ts     pure domain logic, no DB, no HTTP —
                             independently unit-testable
```

Established in Phase 2 (`ScanService` + `scannerEngine`, `hashEngine`,
`metadataEngine`, `evidenceItemId`); the same shape is expected for
`ReviewService`/Review Engine (Phase 3), `ConnectionService` (Phase 5),
`ExportService`/`BinderService` (Phases 7–8).

## Database

Per spec 12: `workspaces, evidence_items, file_metadata, review_answers,
connections, usefulness_scores, review_history, exports, export_items,
binder_generations, scan_runs, duplicates, settings`. Foreign keys and
migrations required; no original file bytes stored in SQLite — only
metadata, hashes, and paths (relative to the workspace evidence root
where practical, so the DB isn't tied to one machine's absolute paths).

## Storage layout this implies

```
app/                     backend + frontend source
generated/<workspace>/   preview cache, extracted metadata cache, DB file
exports/<workspace>/<export-run>/TrademarkEvidencePackage/...
reports/<workspace>/     binder outputs (md/html/json/csv)
workspaces/<name>/evidence/   read-only originals (git-ignored)
```

All four generated roots are already covered by `.gitignore`. The SQLite
file itself should live under `generated/` (or a dedicated `data/`
subfolder within it) so it is covered by the existing `generated/*`
ignore rule without a new `.gitignore` entry.

## Security boundary (13)

- Every filesystem path built from a request must be resolved and checked
  against the workspace evidence root before use — reject any resolved
  path that escapes it (path traversal).
- Evidence files are never executed, only read as bytes for
  hashing/preview generation.
- Preview generation for untrusted file types (SVG in particular) must
  not evaluate scripts — render as static raster or sandbox strictly.
- Export filenames are generated (sanitized), never pass user/original
  filenames through unsanitized into the export tree.
- Exports are never silently overwritten; a new export run gets its own
  directory or an explicit confirm-to-overwrite step.

## What this repo intentionally has no room for (per specs 00/01 and the
master prompt)

No AI/ML pipeline, no cloud sync, no multi-tenant auth, no plugin system,
no generic "platform" abstraction layer, no graph-visualization engine.
Any implementation choice that starts to grow in one of these directions
during Phase 1+ should be treated as scope drift and flagged, not built.
