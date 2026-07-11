# Risks

Findings from Phase 0 inspection, ranked by how much they could derail
later phases if not addressed.

## 1. Path-safety bugs are the highest-blast-radius risk in this system

Because the backend is the only thing allowed to touch the filesystem,
and originals must never be modified, a single unvalidated path (from a
scan result, an export request, a preview request) could write into or
read outside `workspaces/<name>/evidence/`. This isn't hypothetical for
this specific evidence set: folder and file names contain spaces,
parentheses (`Extras (Images)`, `13080129_20613013_proof (1).pdf`),
mixed case, and at least one double extension (`fatletic big order promo
vid.mp4.mkv`). Any path handling that isn't strict from Phase 1 onward
(see `ARCHITECTURE.md` Security boundary) risks silently breaking on
these real names or, worse, succeeding somewhere it shouldn't.

**Mitigation:** build and test the path-resolve-and-validate guard in
Phase 1, before the scanner exists, and run it against these exact
filenames as test fixtures (not just clean synthetic names).

## 2. npm environment issue found in this workspace

Running `npm --version` in this WSL environment surfaced:

```
npm error config prefix cannot be changed from project config: /mnt/c/Users/oscar/.npmrc.
```

The Windows-side `~/.npmrc` (`/mnt/c/Users/oscar/.npmrc`) sets
`prefix=C:\Users\oscar\AppData\Roaming\npm` — a Windows path. When npm
runs inside WSL, it appears to pick this file up in a way that conflicts
with project-level config resolution. `npm --version` itself still
printed `10.8.2` (the error didn't hard-fail that command), but this is
exactly the kind of thing that can break `npm install`/`npm run` once
Phase 1 actually needs to install dependencies.

**Mitigation:** resolve this before or at the start of Phase 1 — likely
either running Node/npm from the Windows side consistently, or scoping
an in-repo `.npmrc` / `NPM_CONFIG_PREFIX` override for WSL use. Flagging
now so it doesn't surface as a confusing failure mid-Phase-1.

## 3. Folder/filename organization only weakly signals evidence role

There is no dedicated "customer photos," "invoices," or "orders" folder.
`Proof Files/` holds two numerically-named PDFs that look like a
print-vendor proof export but aren't labeled as invoices; `Extras
(Images)` likely mixes several roles. This means the app cannot lean on
folder-name heuristics for role/category assignment — it has to rely on
the guided-question workflow (spec 06) doing real work, and the user
answering honestly and completely. If role assignment is ever tempted to
guess from folder/file names as a shortcut, that guess will be wrong
often enough to matter for a legal-adjacent output.

**Mitigation:** treat automatic role inference (if built at all, and
specs don't call for it) as a *suggestion* the user confirms via guided
questions, never as the stored role itself.

## 4. Filename-only "duplicates" won't be caught by hashing

Several video files look like the same source content in different
encodes (`fatletic big order promo vid.mp4` vs. `...mp4.mkv` vs. `(1).mkv`
variants). SHA-256 duplicate detection (spec 04) will correctly treat
these as distinct items, which is correct behavior — but the user may
expect the app to notice "these are basically the same clip." Spec 07
has a `duplicate_of` connection type and `related_to` as a separate type
precisely for this; worth confirming the UI nudges the user toward
`related_to` for near-duplicates rather than expecting the app to detect
them automatically (it shouldn't — spec explicitly has no AI/similarity
detection in v1).

**Mitigation:** none needed beyond confirming this is understood — see
`QUESTIONS.md`.

## 5. Tooling can contaminate the evidence directory if not careful

During this inspection, changing the working directory into
`workspaces/Fatletic/evidence/` caused this session's own memory
subsystem to auto-create a `.claude/mind.mv2.lock` file inside it. It was
empty and has been removed, and it did not touch any original file, but
it's a concrete example of "external tooling writes into the evidence
directory as a side effect" — exactly what
`docs/EVIDENCE_HANDLING_POLICY.md` prohibits for the application itself.

**Mitigation:** the application's own code will only ever open files
under evidence for reading (per `ARCHITECTURE.md`), so this specific
mechanism doesn't recur in-app. Worth remembering as a reason to avoid
running arbitrary dev tooling with its cwd inside an evidence folder
during future work on this repo.

**Update (Phase 1):** the same `.claude/mind.mv2.lock` artifact
reappeared during Phase 1 build/verification work — once inside
`workspaces/Fatletic/evidence/` again and once inside `app/`. Both were
empty, contained no evidence data, and were removed; evidence item
count/size were re-verified unaffected (25 items, 1013 MB) after each
cleanup. This is confirmed to be an artifact of the Claude Code session
tooling's own memory subsystem reacting to working-directory changes —
not this project's application code, which does not exist yet as of
Phase 1. Anyone (human or agent) running shell commands with cwd inside
`workspaces/*/evidence/` should check for and remove stray `.claude/`
directories there afterward, since it recurs across sessions.

## 6. Large binary evidence (1013 MB) and local dev performance

`Photoshop Files/` alone is 387 MB, `Gimp Files/` 216 MB, plus a 65 MB
PSD and several video files. Hashing and metadata extraction across the
full set (Phase 2) will take real wall-clock time locally. Not a
correctness risk, but worth setting expectations: scan progress UI
(spec 15 Phase 2) should show real progress, not appear to hang, and
scan should be resumable/idempotent rather than something the user fears
re-running.

**Mitigation:** covered by existing Phase 2 plan (progress UI,
incremental rescan); flagging so it isn't deprioritized as cosmetic.

## Non-risks (checked, found fine)

- All file extensions present in the evidence set map to spec-supported
  groups (spec 01) — no unknown/unsupported file types to plan around.
- No repository history/commits to worry about disrupting — this repo
  has no commits yet, so structural changes so far carry no history risk.
