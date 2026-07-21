/**
 * Bounded-concurrency worker pool — runs `tasks` with at most
 * `concurrency` in flight at once, awaiting all of them before
 * resolving. Extracted from heicPreviewService.ts's original private
 * copy (docs/ARCHITECTURE_CONSTITUTION.md #2, "business rules exist
 * exactly once") so batchAnalysisService.ts's batch analysis jobs reuse
 * the exact same pattern rather than a second copy.
 */
export async function runWithConcurrency<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  let index = 0;
  async function next(): Promise<void> {
    const current = index++;
    if (current >= items.length) return;
    await worker(items[current]);
    return next();
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => next()));
}
