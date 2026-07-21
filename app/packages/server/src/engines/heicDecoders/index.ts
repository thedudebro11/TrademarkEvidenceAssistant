import { imageMagickDecoder } from "./imageMagickDecoder.js";
import { libheifJsDecoder } from "./libheifJsDecoder.js";
import type { HeicDecoder } from "./types.js";

export type { HeicDecodeOptions, HeicDecodeResult, HeicDecoder, HeicDecoderCapability } from "./types.js";

/**
 * Every decoder this app knows how to invoke, most-preferred first.
 * `heicPreviewService.ts` never automatically uses anything beyond
 * `PREFERRED_DECODER_ID` — see its doc comment for why (a real evidence
 * file proved ImageMagick's HEIC delegate can silently produce corrupt
 * pixels; automatic fallback to a decoder already known to do that
 * defeats the point of having a preferred one).
 */
export const HEIC_DECODERS: readonly HeicDecoder[] = [libheifJsDecoder, imageMagickDecoder];

/** The only decoder ever used automatically (on scan, on first view, on backfill). Manual "Retry with Alternate Decoder" is the sole way any other decoder in `HEIC_DECODERS` runs. */
export const PREFERRED_DECODER_ID = libheifJsDecoder.id;

export function getHeicDecoder(id: string): HeicDecoder | undefined {
  return HEIC_DECODERS.find((d) => d.id === id);
}

export function getPreferredHeicDecoder(): HeicDecoder {
  const preferred = getHeicDecoder(PREFERRED_DECODER_ID);
  if (!preferred) throw new Error(`Preferred HEIC decoder "${PREFERRED_DECODER_ID}" is not registered`);
  return preferred;
}

/** The decoder a manual "Retry with Alternate Decoder" click should use for a given item: the first registered decoder that isn't the one that most recently produced (or attempted) its preview. */
export function getAlternateHeicDecoder(currentDecoderId: string | null): HeicDecoder {
  const alternate = HEIC_DECODERS.find((d) => d.id !== currentDecoderId);
  return alternate ?? HEIC_DECODERS[0];
}
