import { describe, expect, it } from "vitest";
import { inferDateFromFilename } from "../filenameDateInference.js";

describe("inferDateFromFilename", () => {
  it("parses the IMG_YYYYMMDD_HHMMSS Android/Google Camera convention", () => {
    expect(inferDateFromFilename("IMG_20260717_020251.heic")).toBe("2026-07-17T02:02:51");
  });

  it("10. returns null for a filename with no recognized camera pattern — never guesses", () => {
    expect(inferDateFromFilename("vacation_photo.heic")).toBeNull();
    expect(inferDateFromFilename("0_0 (1).heic")).toBeNull();
  });

  it("returns null for an invalid month/day rather than a wrapped/incorrect date", () => {
    expect(inferDateFromFilename("IMG_20261399_020251.heic")).toBeNull();
    expect(inferDateFromFilename("IMG_20260732_020251.heic")).toBeNull();
  });

  it("returns null for an out-of-range time component", () => {
    expect(inferDateFromFilename("IMG_20260717_995999.heic")).toBeNull();
  });

  it("defaults the time to midnight for a date-only pattern", () => {
    expect(inferDateFromFilename("PXL_20260717.heic")).toBe("2026-07-17T00:00:00");
  });

  it("is case-insensitive on the prefix", () => {
    expect(inferDateFromFilename("img_20260717_020251.heic")).toBe("2026-07-17T02:02:51");
  });
});
