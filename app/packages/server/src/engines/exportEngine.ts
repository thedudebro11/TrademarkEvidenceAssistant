import type { FileRole } from "@trademark-evidence-assistant/shared";

/**
 * Maps a file role to its destination folder inside
 * TrademarkEvidencePackage/, per spec 09's structure. Spec 09 does not
 * give an exact role→folder table, so this mapping is an interpretive
 * judgment call — documented here rather than left implicit. Every
 * role maps to exactly one destination (no duplicate copies of the
 * same file), keeping export mechanics simple and the hash-verification
 * story unambiguous (docs/IMPLEMENTATION_PLAN.md Phase 7).
 */
export function folderForRole(role: FileRole | null, imagePlatformAnswer: string): string[] {
  switch (role) {
    case "specimen_candidate":
      return ["01_CORE_EVIDENCE", "Specimen_Candidates"];
    case "printful_invoice":
      return ["02_PRINTFUL", "Invoices"];
    case "printful_order":
    case "print_vendor_proof":
      return ["02_PRINTFUL", "Orders"];
    case "shipping_record":
      return ["02_PRINTFUL", "Shipments"];
    case "social_post_export":
      return /instagram/i.test(imagePlatformAnswer)
        ? ["03_SOCIAL_MEDIA", "Instagram"]
        : ["03_SOCIAL_MEDIA", "Other"];
    case "customer_photo":
      return ["04_CUSTOMERS", "Photos"];
    case "message":
      return ["04_CUSTOMERS", "Messages"];
    case "logo_source":
    case "product_design":
      return ["05_PRODUCTS_AND_DESIGNS", "Source_Files"];
    case "logo_export":
      return ["05_PRODUCTS_AND_DESIGNS", "Exports"];
    case "product_photo":
    case "marketing_photo":
      return ["05_PRODUCTS_AND_DESIGNS", "Product_Photos"];
    case "packaging":
      return ["06_PACKAGING_AND_LABELS"];
    case "video":
      return ["04_CUSTOMERS", "Videos"];
    case "payment_record":
    case "document":
    case "duplicate":
    case "unknown":
    default:
      return ["08_SUPPORTING_DOCUMENTS"];
  }
}

const UNSAFE_CHARS = /[/\\:*?"<>|\x00-\x1f]/g;

/**
 * Produces a filesystem-safe export filename, resolving collisions
 * within the same destination folder by appending " (2)", " (3)", etc.
 * `usedNames` must be the set already placed in that specific folder —
 * callers own the scoping. Pure and deterministic.
 */
export function generateSafeFilename(originalFilename: string, usedNames: Set<string>): string {
  const sanitized = originalFilename.replace(UNSAFE_CHARS, "_").trim() || "unnamed_file";

  if (!usedNames.has(sanitized)) {
    usedNames.add(sanitized);
    return sanitized;
  }

  const lastDot = sanitized.lastIndexOf(".");
  const base = lastDot > 0 ? sanitized.slice(0, lastDot) : sanitized;
  const ext = lastDot > 0 ? sanitized.slice(lastDot) : "";

  let counter = 2;
  let candidate = `${base} (${counter})${ext}`;
  while (usedNames.has(candidate)) {
    counter++;
    candidate = `${base} (${counter})${ext}`;
  }
  usedNames.add(candidate);
  return candidate;
}
