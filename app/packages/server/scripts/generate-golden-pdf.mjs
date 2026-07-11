// Generates printful_invoice.pdf for the golden test workspace using
// pdf-lib — the same library packages/server uses to read PDF page
// counts, so this fixture is guaranteed to be a real, valid PDF rather
// than a hand-computed byte stream. Two pages, so the fixture actually
// exercises page-count > 1.
//
// Lives here (not tests/fixtures) because it needs pdf-lib to resolve
// via this package's node_modules — Node's ESM resolution is based on
// the importing file's location, not cwd. Run with:
//   node packages/server/scripts/generate-golden-pdf.mjs   (from app/)
import { PDFDocument, StandardFonts } from "pdf-lib";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const outPath = join(
  here,
  "..",
  "..",
  "..",
  "..",
  "tests",
  "fixtures",
  "golden-workspace",
  "printful_invoice.pdf",
);

const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);

const page1 = doc.addPage([200, 260]);
page1.drawText("INVOICE #1001", { x: 20, y: 230, size: 14, font });

const page2 = doc.addPage([200, 260]);
page2.drawText("Page 2 of 2", { x: 20, y: 230, size: 14, font });

const bytes = await doc.save();
await writeFile(outPath, bytes);
console.log(`Wrote ${outPath} (${bytes.length} bytes, 2 pages)`);
