import { describe, expect, it } from "vitest";
import { DefaultVideoMetadataProvider } from "../videoMetadataProvider.js";

describe("DefaultVideoMetadataProvider", () => {
  it("returns an honest 'unknown' shape for every field, never a guess", async () => {
    const provider = new DefaultVideoMetadataProvider();
    const metadata = await provider.getVideoMetadata("/some/video.mp4");
    expect(metadata).toEqual({
      durationSeconds: null,
      width: null,
      height: null,
      codec: null,
      fps: null,
      bitrateKbps: null,
      hasAudio: null,
    });
  });

  it("never reads the file — the same result comes back regardless of the path given", async () => {
    const provider = new DefaultVideoMetadataProvider();
    const a = await provider.getVideoMetadata("/does/not/exist.mp4");
    const b = await provider.getVideoMetadata("/another/path.mkv");
    expect(a).toEqual(b);
  });
});
