import { describe, expect, it } from "vitest";
import { FILESYSTEM_DATE_CAVEAT_NOTE, deriveDesignMockupDateAnswer, formatFilesystemDate } from "./filesystemDate.js";

describe("formatFilesystemDate", () => {
  it("formats as M/D/YYYY with no zero-padding", () => {
    const d = new Date(2024, 8, 12); // local September 12, 2024
    expect(formatFilesystemDate(d.toISOString())).toBe("9/12/2024");
  });

  it("uses local calendar getters, not UTC, so the displayed day matches the machine's own clock", () => {
    // A local midnight instant: getMonth/getDate/getFullYear (local) must
    // recover the same local calendar day that produced the ISO string,
    // regardless of what the UTC representation says.
    const local = new Date(2024, 10, 18, 0, 30); // Nov 18, 2024, 12:30am local
    const iso = local.toISOString();
    expect(formatFilesystemDate(iso)).toBe(`${local.getMonth() + 1}/${local.getDate()}/${local.getFullYear()}`);
  });
});

describe("deriveDesignMockupDateAnswer", () => {
  it("9/12. derives a per-item date and caveat note from a valid timestamp", () => {
    const d = new Date(2024, 8, 12);
    const result = deriveDesignMockupDateAnswer(d.toISOString());
    expect(result.available).toBe(true);
    expect(result.answerValue).toBe("9/12/2024");
    expect(result.displayValue).toBe("9/12/2024");
    expect(result.source).toBe("filesystem_last_modified");
    expect(result.confidence).toBe("medium");
    expect(result.note).toBe(FILESYSTEM_DATE_CAVEAT_NOTE);
    expect(result.reasonCode).toBeNull();
  });

  it("12. two different timestamps produce two different answers", () => {
    const a = deriveDesignMockupDateAnswer(new Date(2024, 8, 12).toISOString());
    const b = deriveDesignMockupDateAnswer(new Date(2024, 9, 3).toISOString());
    expect(a.answerValue).not.toBe(b.answerValue);
  });

  it("15. a missing (null) timestamp is unavailable, never a fallback date", () => {
    const result = deriveDesignMockupDateAnswer(null);
    expect(result.available).toBe(false);
    expect(result.answerValue).toBeNull();
    expect(result.reasonCode).toBe("MISSING_FILESYSTEM_DATE");
  });

  it("15b. an empty string timestamp is treated as missing", () => {
    expect(deriveDesignMockupDateAnswer("").reasonCode).toBe("MISSING_FILESYSTEM_DATE");
  });

  it("16. an unparseable timestamp is unavailable, never a fallback date", () => {
    const result = deriveDesignMockupDateAnswer("not-a-real-timestamp");
    expect(result.available).toBe(false);
    expect(result.answerValue).toBeNull();
    expect(result.reasonCode).toBe("INVALID_FILESYSTEM_DATE");
  });

  it("20. confidence always defaults to medium for an available date", () => {
    expect(deriveDesignMockupDateAnswer(new Date().toISOString()).confidence).toBe("medium");
  });
});
