# Project Analysis

Phase 0 output. Read-only inspection of the repository and the Fatletic
evidence workspace, performed without altering any original file.

## Repository state

- Single authoritative spec set at repo root: `specs/` (17 numbered files,
  00–16), `docs/PRODUCT_DECISIONS.md`, `docs/EVIDENCE_HANDLING_POLICY.md`,
  `prompts/CLAUDE_MASTER_PROMPT.md`, root `README.md`.
- `app/`, `scripts/`, `tests/` exist but are empty (placeholder only).
- No `package.json`, no backend, no frontend, no database, no tests exist
  yet. Nothing built.
- Node v20.20.2, npm 10.8.2, Python 3.10.12 are available in this
  environment. See `docs/RISKS.md` for an npm configuration issue found
  during this inspection.
- `workspaces/Fatletic/evidence/` is git-ignored (`workspaces/*/evidence/`
  in `.gitignore`) and contains the only real evidence workspace, per
  `docs/PRODUCT_DECISIONS.md` ("Primary v1 workspace: Fatletic").

## Evidence workspace inventory (read-only survey)

`workspaces/Fatletic/evidence/` — 25 top-level items, 193 files total,
~1013 MB.

Top-level items:

| Item | Type | Files | Size |
|---|---|---|---|
| Edits For Phase 2 Fatletic Logo.jpg | file | 1 | 492K |
| Extras (Images) | dir | 26 | 39M |
| Extras (Video) | dir | 9 | 84M |
| Extras Docs | dir | 2 | 1008K |
| Faletic New Mascot Foward Facing.xcf | file | 1 | 7.6M |
| Fatletic Barbell Gone Logo.jpg | file | 1 | 4.4M |
| Fatletic Insta Logo.png | file | 1 | 3.5M |
| Fatletic Offical Logo Clothing Promo | dir | 51 | 16M |
| Fatletic Offical Logos | dir | 21 | 95M |
| Fatletic wrestling stance human arms.psd | file | 1 | 65M |
| Gimp Files | dir | 11 | 216M |
| Mission Statement.txt | file | 1 | 4.0K |
| Photoshop Files | dir | 9 | 387M |
| Proof Files | dir | 9 | 8.1M |
| Random Fatletic Fonts | dir | 10 | 8.4M |
| Rash Guards | dir | 3 | 436K |
| Screenshot 2024-09-25 193507.jpg | file | 1 | 128K |
| T-Shirt Designs | dir | 3 | 512K |
| Text Docs | dir | 13 | 52K |
| UPDATED FATLETIC LOGOS | dir | 8 | 35M |
| Variations of Offical Logo | dir | 6 | 13M |
| another arm desgin for logo.psd | file | 1 | 8.5M |
| bitmap.svg | file | 1 | 7.7M |
| fatletic inspiration.jpg | file | 1 | 52K |
| fatletic t shirt edit.xcf | file | 1 | 17M |

File-extension breakdown (recursive, 193 files):

| Extension | Count |
|---|---|
| jpg | 77 |
| png | 51 |
| xcf | 15 |
| txt | 15 |
| psd | 10 |
| mp4 | 7 |
| webp | 4 |
| pdf | 4 |
| svg | 3 |
| jpeg | 3 |
| mkv | 2 |
| rtf | 1 |

All extensions map to spec-supported groups (spec 01: images, videos, PDFs,
text, PSD/XCF/SVG). No unsupported file types found.

## Notable content observed

- `Text Docs/` contains business-planning material: mission statement,
  revenue/roll-out plans, tax plan, pricing plan, a Fiverr/design-brief
  note, and a ChatGPT logo-fix transcript. These read as
  `business_history` per spec 03, not automatic `trademark_core` — most
  don't show the mark in commercial use, they document internal planning.
- `Extras Docs/` contains two PDFs (`Fatletic.pdf`, `fatletic sticker.pdf`)
  — likely design/print artifacts, not confirmed invoices.
- `Proof Files/` contains two PDFs named
  `13080129_20613013_proof (1).pdf` and `13095296_20639157_proof.pdf` —
  numeric-ID naming consistent with a print-on-demand vendor's proof
  export (e.g. Printful), but not labeled as invoices or orders. This
  needs a guided-question answer from the user, not an inferred role.
- `Extras (Video)/` has near-duplicate video names, e.g.
  `fatletic big order promo vid.mp4` and
  `fatletic big order promo vid.mp4.mkv` (a `.mp4.mkv` double extension)
  and `fatletic big order promo vid (1).mkv` — likely re-encodes or
  re-exports of the same source, not confirmed duplicates by hash.
- No spreadsheet/CSV files, no explicit "invoice" or "order" filenames, no
  dedicated "customer photos" folder. Customer evidence, if present, is
  most likely intermixed in `Extras (Images)` and will depend on the
  guided-question workflow to identify rather than filename inference.
- No repeated exact filenames were found at the top level; true duplicate
  detection still requires SHA-256 (spec 04), not filename comparison —
  several files described above look like near-duplicates that hashing
  will *not* catch (re-encoded video, resaved image).

## Housekeeping performed during this inspection

- Found and removed a stray, empty `.claude/mind.mv2.lock` file that had
  been auto-created inside the evidence directory by this tooling's
  memory subsystem when the working directory was changed into it during
  inspection. It was not a Fatletic file and contained no data; it has
  been deleted. See `docs/RISKS.md` for the underlying cause and how to
  avoid recurrence.

## Conclusion

The evidence set is well within the file types and volume the specs
anticipate. The main real risk is not file support — it's that the
existing folder/file organization only weakly signals evidence role
(commerce vs. design-history vs. planning), so most classification will
depend on the guided-question workflow (spec 06) and user-entered answers
rather than filename or folder heuristics. See `docs/QUESTIONS.md` for
specific open questions this raises for scope/build decisions.
