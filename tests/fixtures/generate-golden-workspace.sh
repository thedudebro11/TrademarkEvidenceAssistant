#!/usr/bin/env bash
# Regenerates the synthetic golden test workspace (spec 14) used by
# Phase 2 scanner tests. Not part of the app's runtime or build — a
# one-time/occasional authoring tool. Requires ImageMagick (`convert`),
# Ghostscript (`gs`, used by convert for PDF output), and ffmpeg. The
# *output* of this script (small binary fixture files) is committed to
# git; this script itself does not need to run on a normal dev machine.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/golden-workspace"
rm -rf "$DIR"
mkdir -p "$DIR"

# Product photo — a real evidence-of-use candidate.
convert -size 60x40 xc:"#2b6cb0" -gravity center -pointsize 10 -fill white \
  -annotate 0 "PRODUCT" "$DIR/product_photo.jpg"

# Customer photo — different content/size so its hash and dimensions differ.
convert -size 50x50 xc:"#38a169" -gravity center -pointsize 10 -fill white \
  -annotate 0 "CUSTOMER" "$DIR/customer_photo.jpg"

# Exact duplicate of the product photo (same bytes, different filename) —
# exercises exact-duplicate (SHA-256) detection.
cp "$DIR/product_photo.jpg" "$DIR/product_photo_duplicate.jpg"

# Unrelated image — should not be flagged as a duplicate of anything.
convert -size 33x22 xc:"#805ad5" "$DIR/unrelated_image.jpg"

# Social post export — PNG, exercises the PNG metadata path.
convert -size 45x45 xc:"#d69e2e" "$DIR/social_post_export.png"

# Invoice PDF is generated separately:
#   node app/packages/server/scripts/generate-golden-pdf.mjs
# (uses pdf-lib, the same library the metadata engine uses to read page
# counts, so the fixture is guaranteed round-trip valid — ImageMagick's
# PDF output is blocked by this system's Ghostscript security policy.)

# Design source file — real PSD header (via ImageMagick), exercises the
# PSD metadata path without needing an actual Photoshop file.
convert -size 40x30 xc:"#e53e3e" "$DIR/logo_source.psd"

# Video placeholder — real (tiny, silent, 1-frame) MP4. v1 does not
# extract video technical metadata (see docs/IMPROVEMENT_PROPOSALS.md),
# so this only needs to exist as a valid file for filesystem-fact
# extraction and scanning to exercise.
ffmpeg -y -f lavfi -i color=c=black:s=16x16:d=0.1 -frames:v 1 \
  "$DIR/video_placeholder.mp4" -loglevel error

echo "Golden workspace generated at $DIR"
ls -la "$DIR"
