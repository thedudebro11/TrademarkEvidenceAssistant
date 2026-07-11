# Improvement Proposals

Ideas identified while building that would improve the product but are
not necessary to complete the current phase and are out of documented
Version 1 scope. Per the engineering rules, these are recorded here
rather than built.

## From Phase 2 (Scanner)

### Video technical metadata (duration, resolution, codec)

Spec 01 lists video as a supported evidence group, but extracting
duration/resolution deterministically requires either an external binary
(ffprobe) or a heavy native/WASM decoding dependency. v1's Metadata
Engine extracts filesystem facts only for video files (size, timestamps,
MIME type) — no technical metadata. Adding ffprobe would mean a new
runtime dependency with PATH/platform concerns on Windows (the project's
canonical dev environment), which is a real cost, not a trivial addition.
Worth revisiting once there's a concrete need for video metadata in
guided questions (spec 06 already asks the user directly for what a
video shows, timestamps, and event type — the app doesn't strictly need
the technical metadata to support that workflow).

### Skip re-hashing unchanged files on rescan

Every scan currently re-hashes every file, every time, with no
shortcuts. For the real Fatletic evidence (192 files, 1013 MB) this
takes about 7 seconds — fine today. A future optimization could skip
re-hashing a file whose path, size, and modification time are all
unchanged since the last scan, trusting that combination as a proxy for
"content unchanged." Deliberately not built now: it would trade a small
amount of correctness (a file edited without changing mtime, however
unlikely, would go undetected) for speed that isn't needed yet. Always
re-hashing is the "never trade correctness for convenience" choice.

### Streaming scan progress

`USER_JOURNEY.md` describes a scan that "communicates exactly what it is
doing" with granular status like "Reading metadata... Calculating
hashes...". v1's scan is a single blocking HTTP request that returns a
final summary — acceptable given real scan time (~7s for the full real
evidence set), but for a much larger workspace this could feel opaque.
A future version could stream progress via Server-Sent Events, with
`scan_runs` (already tracking counters) as the natural backing store.
Not built now because Phase 2's plan explicitly scopes this as "minimal
scan-trigger + progress UI," and a blocking call with a loading state
satisfies that at current data volumes.

### Concurrent scan queuing

`ScanService.runScan` currently rejects a second scan request outright
if one is already running for the workspace (simple, safe, correct). A
future version could instead queue the second request. Not built now —
rejecting is simpler and there's no evidence yet that users trigger
concurrent scans in practice.
