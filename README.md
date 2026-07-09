# Trademark Evidence Assistant

Trademark Evidence Assistant is a focused review tool for helping determine
which files are useful for supporting a trademark evidence package.

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

## Repository structure

```
app/          Application source code
docs/         Project documentation (including evidence handling policy)
specs/        Specifications and design documents
prompts/      AI prompts used by the application
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

## Status

This repository currently contains only the project structure, `.gitignore`,
evidence handling policy, and this README. The application itself has not
been built yet.
