import { describe, expect, it } from "vitest";
import { getAlternateHeicDecoder, getHeicDecoder, getPreferredHeicDecoder, HEIC_DECODERS, PREFERRED_DECODER_ID } from "../index.js";

describe("heicDecoders registry", () => {
  it('the preferred decoder is "libheif-js", not ImageMagick — the decoder proven correct against a real corrupted-by-ImageMagick evidence file', () => {
    expect(PREFERRED_DECODER_ID).toBe("libheif-js");
    expect(getPreferredHeicDecoder().id).toBe("libheif-js");
  });

  it("every decoder id in the registry is unique", () => {
    const ids = HEIC_DECODERS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("getHeicDecoder looks up a known decoder by id and returns undefined for an unknown one", () => {
    expect(getHeicDecoder("imagemagick")?.id).toBe("imagemagick");
    expect(getHeicDecoder("libheif-js")?.id).toBe("libheif-js");
    expect(getHeicDecoder("does-not-exist")).toBeUndefined();
  });

  it("getAlternateHeicDecoder returns a decoder other than the one that produced the current preview", () => {
    expect(getAlternateHeicDecoder("libheif-js").id).not.toBe("libheif-js");
    expect(getAlternateHeicDecoder("imagemagick").id).not.toBe("imagemagick");
  });

  it("getAlternateHeicDecoder falls back to the first registered decoder when there's no current decoder to avoid", () => {
    expect(getAlternateHeicDecoder(null).id).toBe(HEIC_DECODERS[0].id);
  });
});
