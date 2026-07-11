# Implementation Plan

Elaborates spec 15's phase list into concrete deliverables and exit
criteria. Each phase stops for a summary/checkpoint per the master
prompt; this doc does not itself authorize starting Phase 1.

## Phase 0 — Analysis (this phase)

Deliverables: this file, `PROJECT_ANALYSIS.md`, `ARCHITECTURE.md`,
`RISKS.md`, `QUESTIONS.md`. No app code. Evidence inspected read-only
(counts/sizes/extensions/names only — see `PROJECT_ANALYSIS.md`).

Exit criteria: user has reviewed open questions in `QUESTIONS.md` and
approved proceeding to Phase 1.

**Status: Complete.** All 8 questions resolved (see `QUESTIONS.md`).

## Phase 1 — Foundation

**Status: Complete.** Delivered as an `app/` npm workspace with
`packages/shared`, `packages/server`, `packages/web`. Key implementation
notes:

- `packages/shared` ships compiled `dist/` output (not raw `.ts`) so
  plain `node dist/index.js` can resolve it — pointing `main`/`types` at
  source works for `tsc`/`tsx`/Vite but not for a compiled server running
  under plain Node.
- Root `postinstall` builds `shared` automatically after `npm install`.
- `packages/server`'s build copies `src/db/migrations/*.sql` into
  `dist/` via a small Node script (`scripts/copy-migrations.mjs`) —
  `tsc` only emits compiled `.js` and silently drops non-TS assets.
- `workspace.config.json` at repo root names the active workspace
  (`Fatletic`); `packages/server/src/config/repoRoot.ts` locates the
  repo root by walking up for `.git`, so path resolution doesn't depend
  on source-vs-compiled directory depth.
- `packages/server/src/security/pathGuard.ts` (`resolveSafePath`) was
  built now, ahead of the scanner, per `ARCHITECTURE.md`'s security
  boundary — tested against the real evidence set's filenames (spaces,
  parentheses) as fixtures, not just clean synthetic names.
- Verified end-to-end: typecheck, 15 tests (server 9, shared 4, web 2)
  all pass; `npm run build` produces a working compiled server that was
  actually started and its `/api/health` endpoint hit live, returning
  the real Fatletic evidence root as `evidenceRootExists: true`.

Original scaffold scope (all delivered):

- `app/backend` (Node + TS + Express) and `app/frontend`
  (React + TS + Vite) as two packages (npm workspaces or simple
  sibling folders — decide in Phase 1, not here).
- SQLite connection + migration runner; create the schema from spec 12
  (empty tables, no data yet).
- Config: workspace root path, evidence root path, generated/exports/
  reports paths — all resolved relative to repo root, validated to exist
  at startup.
- Base Express app with a health-check route, error handling, and the
  path-safety guard from `ARCHITECTURE.md` (Security boundary) — this
  guard is foundational, not a later add-on, because every later phase's
  filesystem access depends on it.
- Minimal frontend shell that can call the health-check route.
- Test harness wired up (whatever runner Phase 1 picks) with one real
  passing test per side (backend route test, frontend render test).

Exit criteria: `npm run dev`-equivalent boots both sides locally, DB
migrates cleanly from empty, one backend test and one frontend test pass.

## Phase 2 — Scanner

- Recursive scan of a workspace's `evidence/` folder, skip-list for
  app/cache/db/export/generated per spec 04.
- SHA-256 hashing, stable Evidence Item ID derivation, exact-duplicate
  detection by hash.
- Incremental rescan: unchanged files (same path+hash) keep existing
  review data; new files get new items; missing-on-disk files are
  flagged, not deleted from DB.
- Deterministic metadata extraction per type (images, video, PDF, PSD/XCF
  where practical, filesystem facts always) — label filesystem timestamps
  explicitly as filesystem metadata (spec 04).
- Minimal scan-trigger + progress UI.
- Tests: scanner behavior, ignored paths, incremental rescan preserving
  review data, duplicate detection, using the synthetic golden workspace
  from spec 14 (not the real Fatletic evidence).

Exit criteria: running the scanner against the golden workspace produces
correct item counts, correct duplicate flags, and a second run changes
nothing unexpected.

**Status: Complete.** Delivered per
`docs/ARCHITECTURE_CONSTITUTION.md`'s layered architecture:

- **Engines** (`packages/server/src/engines/`, pure, no DB):
  `scannerEngine` (recursive discovery + ignore rules),
  `hashEngine` (streamed SHA-256), `metadataEngine` (dispatches by
  extension to `psdHeader`/`xcfHeader`/`svgDimensions`/`image-size`/
  `pdf-lib`), `evidenceItemId` (deterministic path-based IDs).
- **Service** (`packages/server/src/services/scanService.ts`):
  orchestrates the engines, persists to SQLite, owns incremental-rescan
  and duplicate-rebuild logic. The `POST /api/scan` route is a thin
  delegate with no business logic.
- New migration `0002_scan.sql`: `evidence_items`, `file_metadata`,
  `duplicates`, `scan_runs`.
- PSD and XCF header parsers were verified against real files in this
  project's own evidence set (read-only, not used as fixtures) before
  being trusted — the XCF parser's assumed byte layout was confirmed
  correct against a real GIMP-produced file before being relied on.
- Golden test workspace built at `tests/fixtures/golden-workspace/`
  (8 files: product/customer/duplicate/unrelated photos, a 2-page PDF
  invoice, a PSD, a PNG, an MP4) using real image/PDF-generation tooling
  rather than hand-crafted binary bytes — see
  `tests/fixtures/generate-golden-workspace.sh` and
  `app/packages/server/scripts/generate-golden-pdf.mjs`.
- 57 tests total (up from 15): 48 server (11 new for Phase 2), 4 shared,
  5 web (1 new — `ScanPanel`).
- Verified against the **real** Fatletic evidence (192 files, 1013 MB):
  scan completed in ~7s, all 192 hashes independently cross-checked
  against `sha256sum` with zero mismatches, and a full before/after
  hash-manifest diff of the entire evidence tree came back empty —
  byte-for-byte proof nothing was modified. Found 11 real exact-duplicate
  groups (all plausible: copy-suffixed files, two independently-empty
  text files, the known root/`Text Docs` Mission Statement duplicate).
- Minimal scan-trigger UI (`ScanPanel.tsx`, presentation-only) added to
  the web shell per Phase 2's "minimal scan-trigger + progress UI" scope
  — deliberately does not show a "Start Reviewing" action, since Review
  Queue (Phase 3) doesn't exist yet.

## Phase 3 — Review Queue

- Review Queue page: load next unreviewed item, preview, metadata
  display, decision actions (Include/Maybe/Follow-Up/Not Useful),
  keyboard shortcuts from spec 05.
- Autosave with visible save-state indicator.
- Required UI states from spec 11: unsupported preview, corrupt file,
  missing original, duplicate, no metadata, incomplete scan.

Exit criteria: full one-item review loop works end-to-end against the
golden workspace with autosave and status transitions covered by tests.

**Status: Complete.**

- **Vocabulary reconciliation** (documented, not silently resolved):
  spec 05 names the fourth decision "Not Useful"; `USER_JOURNEY.md`'s
  button list calls it "Archive". Resolved by reusing the existing
  `review_status = 'excluded'` value (spec 03, unchanged since Phase 1)
  internally while the UI button reads "Archive" — internal state name
  and user-facing label are allowed to differ. Full reasoning in
  migration `0003_review.sql`'s header comment.
- **Engine**: `reviewQueueEngine.ts` (`pickNextUnreviewed`, `pickPrevious`,
  `computeProgress`) — pure, no DB. `pickNextUnreviewed` scans forward
  from the current item's position in the *full* ordered list rather
  than a pre-filtered one; a pre-filtered version would lose track of
  where to resume from immediately after every decision (the item just
  decided on would no longer be in a status-filtered list). Caught and
  fixed during design, before it became a live bug — see the engine's
  test `"the bug this engine specifically avoids"`.
- **Service**: `reviewService.ts` — decision-to-state mapping,
  duplicate-group lookup, metadata joins, and `resolveItemFile` (routes
  every preview request through `resolveSafePath` before touching disk).
- New migration `0003_review.sql`: `inclusion_decision`, `notes`,
  `decided_at`, `notes_updated_at` on `evidence_items`.
- New routes: `GET/POST /api/evidence-items/*` (progress, next, previous,
  detail, file streaming, decision, notes) — all thin, all delegating to
  `ReviewService`.
- Web: `ReviewQueue.tsx` (owns only local UI/loading state — all
  navigation, progress, and decision logic is server-computed, per
  `ARCHITECTURE_CONSTITUTION.md` #3), `PreviewPane.tsx`,
  `MetadataPanel.tsx`, `NotesEditor.tsx` (debounced autosave with a
  visible save-state indicator, plus an imperative `flush()` so pending
  notes are never lost on navigation), `DecisionBar.tsx`,
  `ProgressSummary.tsx` (deliberately shows no time estimate — the app
  has no real data to base one on). Keyboard shortcuts N/P/I/M/F/X wired
  per spec 05; `L` (link) intentionally unbound — Connections are
  Phase 5.
- Implements 5 of spec 11's 6 required states: unsupported preview,
  corrupt file, missing original, duplicate, no metadata. "No links" is
  N/A until Phase 5 introduces connections — deliberately deferred, not
  dropped.
- 46 new tests (102 total, up from 57): 28 server (engine + service +
  route), 18 web (`ReviewQueue`, updated `App`).
- Verified against the **real** Fatletic evidence live: fetched a real
  item (3500×2500 JPEG), streamed its actual bytes with correct
  Content-Type, saved notes, recorded a decision, confirmed progress and
  next/previous navigation, confirmed real duplicate reporting (the
  root/`Text Docs` Mission Statement duplicate found in Phase 2). Full
  before/after hash-manifest diff of all 192 files came back empty.
  Review-state test data was then cleared from the generated database
  (app-owned, not evidence) so the user's real first session starts
  clean.

## Phase 4 — Conditional Questions

- File-role-driven question sets (spec 06), each answer stores
  value/source/confidence/note.
- Role assignment (manual, from spec 03's role list) feeding which
  question set is shown.

Exit criteria: question sets change correctly by role; answers persist
and reload correctly.

**Status: Complete.**

- Question catalog (spec 06's Universal/Images/Invoices-Orders/
  Design-Files/Videos sets) lives in `shared/questionCatalog.ts` as pure
  data + a pure `getQuestionsForRole` function — server and web both
  import it, so the question set can never drift between what's
  validated and what's rendered.
- Deliberately omitted spec 06's 8th universal question ("Include in
  trademark package?") — it duplicates the Include/Maybe/Follow-Up/
  Archive decision already built in Phase 3; asking it twice would let
  the two answers disagree.
- Role assignment is manual only, per Phase 0 decision 4 — no automatic
  role suggestion logic was built.
- New migration `0004_questions.sql`: `file_role` on `evidence_items`,
  new `review_answers` table (upsert-on-conflict, so re-saving a
  question overwrites rather than accumulating history — same pattern as
  Phase 3's notes autosave).
- New routes: `PATCH /api/evidence-items/:id/role`,
  `PUT /api/evidence-items/:id/answers/:questionId`.
- Web: `QuestionsPanel.tsx` (role selector + per-question autosave on
  blur/debounce).
- 31 new tests (128 total, up from 97): 9 shared (question-catalog role
  mapping), 17 server (service + route), 5 web.
- Applied the leaner phase-start reading protocol for the first time:
  reused already-current knowledge of `ARCHITECTURE_CONSTITUTION.md`
  (confirmed unchanged by mtime/git status rather than re-reading it),
  and read only specs 03 and 06 fresh — the two specs this phase
  actually needed.
- Verified against the **real** Fatletic evidence: ran a live scan (192
  items), assigned a real role, saved a real answer, confirmed both
  persisted correctly via a fresh GET, confirmed invalid role/confidence
  values are rejected. Before/after hash-manifest diff of all 192 files
  came back empty. Review-state test data cleared from the generated
  database afterward.

## Phase 5 — Connections

- Create/remove typed connections between items (spec 07's type list).
- Simple chain rendering in Evidence Detail / Link Evidence UI (spec 11).

Exit criteria: connections persist, render, and are included in scoring
inputs (Phase 6 depends on this).

## Phase 6 — Scoring

- Deterministic scoring function (spec 08) with documented formula,
  explanation output, missing-elements output, override with required
  note.

Exit criteria: scoring is a pure, tested function; same inputs always
produce the same score; override path is auditable.

## Phase 7 — Export

- Approved-only copy into `TrademarkEvidencePackage/` structure (spec
  09), safe filename generation, private original-path mapping.
- Byte-identical copy verification (hash source vs. copy).

Exit criteria: export never touches originals, copies match source
hashes, mapping file is generated and kept out of anything meant for
external sharing.

## Phase 8 — Binder

- Markdown/HTML/JSON/CSV binder generation (spec 10) using factual
  language rules; citation discipline tested (spec 14).

Exit criteria: generated binder passes the language-discipline tests
(no forbidden phrases) and correctly cites source evidence for each
claim.

## v1 release gate (spec 16)

Scans real Fatletic evidence unchanged, one item per file, supported
previews render, metadata shown, one-at-a-time review works, conditional
questions work, autosave works, linking works, scoring is explainable,
all four decisions work, export is approved-only and byte-identical,
binder is accurate, local run is documented, tests pass.
