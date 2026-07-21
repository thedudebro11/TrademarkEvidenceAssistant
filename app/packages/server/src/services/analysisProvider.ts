/**
 * AI provider boundary for Evidence Intelligence (Phase 1). No real
 * provider is wired up in this phase — this exists so the rest of the
 * system (analysisService.ts, the confirmation flow, the UI) has a
 * real, typed seam to call through, without pretending a provider
 * exists that doesn't. Deterministic extraction (analysisEngine.ts)
 * never depends on this file at all; an analysis run completes fully
 * using deterministic results alone regardless of what this reports.
 *
 * Configuration is opt-in and environment-variable-only — no API key
 * is ever required for deterministic analysis, no evidence file or OCR
 * text is ever sent anywhere unless `ANALYSIS_PROVIDER_API_KEY` (or an
 * equivalent future variable) is actually set, and nothing here commits
 * a secret or hardcodes a vendor endpoint.
 */

export interface AnalysisProviderCapability {
  available: boolean;
  providerId: string | null;
  model: string | null;
  version: string | null;
  /** A short, safe-to-display reason `available` is false. `null` when available. */
  reason: string | null;
}

export interface AnalysisProvider {
  id: string;
  checkAvailability(): Promise<AnalysisProviderCapability>;
}

const UNAVAILABLE_REASON = "No AI provider is configured for this workspace. Deterministic analysis results above are unaffected.";

/**
 * The only provider Phase 1 ships with. Always reports unavailable —
 * there is deliberately no code path here that could ever transmit
 * evidence content anywhere, since no real provider integration has
 * been implemented or reviewed yet (see the task's own explicit "do not
 * fabricate an existing provider" boundary).
 */
export const nullAnalysisProvider: AnalysisProvider = {
  id: "none",
  async checkAvailability(): Promise<AnalysisProviderCapability> {
    return { available: false, providerId: null, model: null, version: null, reason: UNAVAILABLE_REASON };
  },
};

/**
 * Resolves the configured provider for this process. Checks only for
 * the presence of an opt-in environment variable — never assumes a
 * provider exists just because this module was imported. Always
 * `nullAnalysisProvider` today; a real provider implementation is a
 * later phase's concern, added here without changing any caller.
 */
export function getConfiguredAnalysisProvider(): AnalysisProvider {
  const configured = process.env.ANALYSIS_PROVIDER_API_KEY;
  if (!configured) {
    return nullAnalysisProvider;
  }
  // No real provider is implemented in Phase 1 even when a key is
  // present — reaching this branch is a configuration no-op, not a
  // silent capability upgrade.
  return nullAnalysisProvider;
}
