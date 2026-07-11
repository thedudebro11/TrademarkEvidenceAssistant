# Trademark Evidence Assistant

Trademark Evidence Assistant is a focused local review tool for helping
determine which files are useful for supporting a trademark evidence
package. It reviews business files one at a time, helps fill in missing
context, connects related evidence, and produces an organized evidence
package and a factual binder.

## What this is

- A tool to help organize, classify, review, and connect evidence files
  (logos, product photos, marketing materials, correspondence, etc.)
  gathered in support of a trademark matter.
- A way to reduce manual sifting through large, messy folders of raw
  business files by surfacing what's relevant and how pieces relate to
  one another.

## What this is not

- **Not legal advice.** Nothing produced by this tool should be treated as
  a legal opinion or a substitute for advice from a qualified attorney.
- **Not proof of trademark rights.** This tool does not determine,
  establish, or certify trademark ownership, priority, or validity. It
  helps prepare and organize material for human and legal review — it does
  not make legal determinations itself.

## Fixed decisions

- Local browser app — no cloud, no collaboration.
- React + TypeScript + Vite frontend.
- Node + TypeScript + Express backend.
- SQLite for application data.
- Originals are read-only; approved evidence is copied, never moved.
- No AI in v1.
- One-item-at-a-time guided review is the primary workflow.
- Tight scope; no platform-style expansion.

See [`specs/`](specs/) for the full specification set and
[`docs/PRODUCT_DECISIONS.md`](docs/PRODUCT_DECISIONS.md) for the complete
list of confirmed decisions and non-goals.

## Repository structure

```
app/          npm workspace: packages/server, packages/web, packages/shared
docs/         Project documentation (product decisions, evidence handling policy, planning docs)
specs/        Numbered specification documents (product vision through acceptance criteria)
prompts/      Prompts used to drive AI-assisted implementation of this project
scripts/      Utility / automation scripts
tests/        Test suites and lightweight test fixtures
workspaces/   Per-client working areas
  Fatletic/
    evidence/ Raw evidence for the Fatletic matter (git-ignored, read-only)
reports/      Generated reports (git-ignored contents)
exports/      Generated exports (git-ignored contents)
generated/    Other generated artifacts (git-ignored contents)
```

Raw evidence is never committed to this repository. See
[`docs/EVIDENCE_HANDLING_POLICY.md`](docs/EVIDENCE_HANDLING_POLICY.md) for
the full policy on how evidence is stored and handled.

## Getting started

See [`docs/SETUP.md`](docs/SETUP.md) for local setup and run commands
(Windows PowerShell is the canonical development environment).

## Status

Phase 4 (Conditional Questions) is complete. The app can scan a
workspace's evidence, then review it one file at a time: preview, known
metadata, duplicate notices, a manually-assigned file role, role-driven
guided questions with autosave, free-text notes, and Include / Maybe /
Needs Follow-Up / Archive decisions with keyboard shortcuts — verified
against the real Fatletic evidence (192 files, 1013 MB) with zero
modification. There are still no evidence connections, scoring, export,
or binder generation. See
[`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) for phase
status. No review functionality (scanning, preview, guided questions,
scoring, export, binder) exists yet.
