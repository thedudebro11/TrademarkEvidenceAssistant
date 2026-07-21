import type { EvidenceCategory, FileRole, SuggestionConfidence } from "./enums.js";

/**
 * Evidence Classification Framework (docs/IMPLEMENTATION_PLAN.md Phase
 * 3.5). This registry is the single source of truth for "what kind of
 * file is this" throughout the application — the Review Queue,
 * Connections, Scoring, Reports, and Export all reference it rather than
 * hardcoding a document-type list of their own
 * (docs/ARCHITECTURE_CONSTITUTION.md #2, "business rules exist exactly
 * once").
 *
 * This supersedes Phase 4's `FileRole`/`questionCatalog.ts` system as the
 * *primary* classification the user interacts with. `FileRole` is not
 * deleted — Phase 6's `scoringEngine` still reads it, and rewriting a
 * working, tested scoring formula is out of scope for an architectural
 * phase (docs/ARCHITECTURE_CONSTITUTION.md #10: "do not rewrite working
 * code"). Instead every `EvidenceTypeDefinition` below carries a
 * `legacyFileRole` bridge: confirming an evidence type also sets the
 * item's `file_role` to that mapped value, so Scoring keeps receiving a
 * real signal without this phase touching `scoringEngine.ts`. See the
 * ADR (docs/ADR_0001_EVIDENCE_CLASSIFICATION_FRAMEWORK.md) for the full
 * reasoning and the follow-up this creates.
 *
 * Question wording pass (post-1.0, no version bump — see the note above
 * EVIDENCE_TYPE_REGISTRY_META): every interview question was rewritten
 * for plain-English clarity, per docs/DESIGN_LANGUAGE.md's new
 * principle "every question should teach the user how to think about
 * trademark evidence." Question ids, counts, and every non-wording
 * field are unchanged — existing saved answers still validate against
 * the same ids.
 */

export const EVIDENCE_TYPE_CATEGORIES = [
  "design",
  "products",
  "commerce",
  "marketing",
  "customers",
  "business",
  "legal",
  "media",
  "archive",
] as const;
export type EvidenceTypeCategoryId = (typeof EVIDENCE_TYPE_CATEGORIES)[number];

export const EVIDENCE_TYPE_CATEGORY_LABELS: Record<EvidenceTypeCategoryId, string> = {
  design: "Design",
  products: "Products",
  commerce: "Commerce",
  marketing: "Marketing",
  customers: "Customers",
  business: "Business",
  legal: "Legal",
  media: "Media",
  archive: "Archive",
};

/**
 * One category-level icon key (not a per-type icon — 45 bespoke icons
 * was judged not worth the cost/benefit for a v1 registry; see the ADR's
 * "scope reductions" section). The web layer maps these keys to the
 * existing hand-drawn icon set — `shared` cannot reference JSX.
 */
export const EVIDENCE_TYPE_CATEGORY_ICON: Record<EvidenceTypeCategoryId, string> = {
  design: "identify",
  products: "package",
  commerce: "note",
  marketing: "link",
  customers: "review",
  business: "settings",
  legal: "details",
  media: "scan",
  archive: "duplicate",
};

/** Reuses Badge's existing tone vocabulary rather than inventing a parallel color system. */
export type EvidenceTypeColorTone = "info" | "success" | "warning" | "danger" | "neutral";

export const EVIDENCE_TYPE_CATEGORY_TONE: Record<EvidenceTypeCategoryId, EvidenceTypeColorTone> = {
  design: "info",
  products: "success",
  commerce: "success",
  marketing: "info",
  customers: "success",
  business: "neutral",
  legal: "warning",
  media: "info",
  archive: "neutral",
};

export interface EvidenceInterviewQuestion {
  id: string;
  text: string;
  /** Shown alongside the question, per docs/USER_JOURNEY.md "every question includes a reason". One sentence, plain English. */
  reason: string;
  /** Optional example answer(s) shown as input placeholder text — "answer expectations" per docs/DESIGN_LANGUAGE.md. Omitted for questions where an example wouldn't reduce uncertainty (e.g. a plain yes/no). */
  placeholder?: string;
}

export interface EvidenceTypeDefinition {
  id: string;
  displayName: string;
  category: EvidenceTypeCategoryId;
  description: string;
  /** Per-type interview — configuration data, never hardcoded into a component (Part 3). */
  interview: EvidenceInterviewQuestion[];
  /** Other evidence type ids this type typically connects to. Suggestions only — never auto-linked (Part 5). */
  suggestedConnections: string[];
  /** Feeds the existing evidence_category concept (spec 03) — informational, not auto-applied. */
  suggestedCategory: EvidenceCategory;
  /** Advisory notes for a future scoring phase to consult. Not read by scoringEngine.ts in this phase. */
  scoringHints: string[];
  /** Export folder path this type would live under (spec 09 folder names, same vocabulary as exportEngine.ts's folderForRole). Informational; export still routes by file_role until a later phase rewires it. */
  exportDestination: string;
  /** Bridges a confirmed evidence type to the legacy FileRole scoring reads, so Phase 6 keeps working unchanged. Null where no reasonable legacy role exists. */
  legacyFileRole: FileRole | null;
  deprecated: boolean;
  versionIntroduced: string;
}

export interface EvidenceTypeRegistryMeta {
  version: string;
  createdDate: string;
  updatedDate: string;
  compatibilityVersion: string;
  migrationNotes: string[];
}

export const EVIDENCE_TYPE_REGISTRY_META: EvidenceTypeRegistryMeta = {
  version: "1.0",
  createdDate: "2026-07-12",
  updatedDate: "2026-07-15",
  compatibilityVersion: "1.0",
  migrationNotes: [
    "1.0 — initial registry. No prior versions exist; nothing to migrate from.",
    "1.0 (2026-07-15) — interview question wording rewritten for clarity (question/reason/placeholder). No ids, questions, or types were added or removed, so this did not warrant a version bump; existing saved answers are unaffected.",
  ],
};

function q(id: string, text: string, reason: string, placeholder?: string): EvidenceInterviewQuestion {
  return placeholder ? { id, text, reason, placeholder } : { id, text, reason };
}

export const EVIDENCE_TYPE_REGISTRY: EvidenceTypeDefinition[] = [
  // ---------- Design ----------
  {
    id: "design_mockup",
    displayName: "Design Mockup",
    category: "design",
    description: "An in-progress or concept design that may or may not have been used commercially.",
    interview: [
      q(
        "design_mockup_internal_concept",
        "Was this an early, internal idea — or did anyone outside the team ever see it?",
        "Shows whether this was private exploration or something the public could have seen.",
      ),
      q(
        "design_mockup_final_design",
        "Did this concept become the final design that was actually used?",
        "A concept that became final is stronger evidence than one that was dropped.",
      ),
      q("design_mockup_creator", "Who created this design?", "Establishes who's responsible for the design and roughly when it originated.", "e.g. Fiverr designer, in-house team, Oscar V."),
      q(
        "design_mockup_publicly_released",
        "Was this ever released publicly?",
        "Public release is stronger evidence of use than a private draft.",
      ),
      q(
        "design_mockup_creation_date",
        "Roughly when was this created?",
        "Filesystem timestamps alone aren't proof of the real-world date, so your own knowledge matters here.",
        "e.g. March 2025, or 'around when the hoodie line launched'",
      ),
      q(
        "design_mockup_related_psd",
        "Is there a working PSD file behind this design?",
        "Connects this mockup to the source file it was built from.",
      ),
      q(
        "design_mockup_related_final_logo",
        "Did this concept lead to the final logo you actually use?",
        "Shows whether this early idea became the mark you use today.",
      ),
    ],
    suggestedConnections: ["psd_source", "final_logo", "product_mockup"],
    suggestedCategory: "trademark_supporting",
    scoringHints: ["A mockup that never became a final design or product is weaker specimen evidence than one that did."],
    exportDestination: "05_PRODUCTS_AND_DESIGNS/Source_Files",
    legacyFileRole: "logo_source",
    deprecated: false,
    versionIntroduced: "1.0",
  },
  {
    id: "final_logo",
    displayName: "Final Logo",
    category: "design",
    description: "The logo actually adopted and used to represent the brand.",
    interview: [
      q(
        "final_logo_official",
        "Is this your official, adopted logo?",
        "Separates the mark you actually use from alternates that were only considered.",
      ),
      q(
        "final_logo_current",
        "Is this the logo you're currently using?",
        "A retired logo can still count as evidence, but it should be labeled accurately.",
      ),
      q(
        "final_logo_replaced_previous",
        "Did this logo replace an earlier version?",
        "Helps build an accurate timeline of how your mark has evolved.",
      ),
      q(
        "final_logo_where_used",
        "Where does this logo actually appear — products, website, packaging?",
        "Establishes the real-world places your mark is actually used.",
        "e.g. hoodies, t-shirts, website header, hang tags",
      ),
      q(
        "final_logo_linked_website",
        "Does this logo appear on your website?",
        "Connects the mark to a public, independently verifiable use.",
      ),
      q(
        "final_logo_linked_products",
        "Which products carry this logo?",
        "Connects the mark to real, sellable goods.",
        "e.g. FATLETIC Hoodie, Black T-Shirt, Sticker Pack",
      ),
    ],
    suggestedConnections: ["design_mockup", "logo_variations", "product_mockup", "website_screenshot"],
    suggestedCategory: "trademark_core",
    scoringHints: ["A confirmed Final Logo is a strong candidate for a specimen exhibit.", "Distinguish clearly from unreleased mockups or retired variants."],
    exportDestination: "05_PRODUCTS_AND_DESIGNS/Exports",
    legacyFileRole: "logo_export",
    deprecated: false,
    versionIntroduced: "1.0",
  },
  {
    id: "psd_source",
    displayName: "PSD Source",
    category: "design",
    description: "A Photoshop working file behind a design.",
    interview: [
      q(
        "psd_source_produces_what",
        "What finished design came out of this working file?",
        "Connects the working file to the design it was used to create.",
        "e.g. the final FATLETIC mascot logo",
      ),
      q(
        "psd_source_layers_note",
        "Is there anything worth noting inside the file — earlier versions, alternate layouts, unused ideas?",
        "Working files often hold more history than the exported image shows.",
      ),
      q(
        "psd_source_creation_date",
        "Roughly when was this file created?",
        "Supports the timeline of when this design work happened.",
        "e.g. February 2025",
      ),
    ],
    suggestedConnections: ["design_mockup", "final_logo"],
    suggestedCategory: "trademark_supporting",
    scoringHints: ["Source files corroborate authorship and timeline but are rarely specimens themselves."],
    exportDestination: "05_PRODUCTS_AND_DESIGNS/Source_Files",
    legacyFileRole: "logo_source",
    deprecated: false,
    versionIntroduced: "1.0",
  },
  {
    id: "illustrator_source",
    displayName: "Illustrator Source",
    category: "design",
    description: "An Adobe Illustrator working file behind a design.",
    interview: [
      q(
        "illustrator_source_produces_what",
        "What finished design came out of this working file?",
        "Connects the working file to the design it was used to create.",
        "e.g. the final FATLETIC logo",
      ),
      q(
        "illustrator_source_vector_final",
        "Is this the vector source behind the final logo?",
        "Confirms this is the authoritative source, not an early draft.",
      ),
      q(
        "illustrator_source_creation_date",
        "Roughly when was this file created?",
        "Supports the timeline of when this design work happened.",
        "e.g. February 2025",
      ),
    ],
    suggestedConnections: ["final_logo", "svg_source"],
    suggestedCategory: "trademark_supporting",
    scoringHints: ["Source files corroborate authorship and timeline but are rarely specimens themselves."],
    exportDestination: "05_PRODUCTS_AND_DESIGNS/Source_Files",
    legacyFileRole: "logo_source",
    deprecated: false,
    versionIntroduced: "1.0",
  },
  {
    id: "svg_source",
    displayName: "SVG Source",
    category: "design",
    description: "A vector export of a design, typically for web or print use.",
    interview: [
      q(
        "svg_source_final_or_draft",
        "Is this the finished version, or still a work in progress?",
        "Distinguishes production-ready artwork from something still being drafted.",
      ),
      q(
        "svg_source_where_used",
        "Where is this used — web, print, or on a product?",
        "Establishes the real-world context this file is used in.",
        "e.g. website, hoodie print file, hang tag",
      ),
    ],
    suggestedConnections: ["final_logo", "website_screenshot"],
    suggestedCategory: "trademark_supporting",
    scoringHints: [],
    exportDestination: "05_PRODUCTS_AND_DESIGNS/Exports",
    legacyFileRole: "logo_export",
    deprecated: false,
    versionIntroduced: "1.0",
  },
  {
    id: "brand_guide",
    displayName: "Brand Guide",
    category: "design",
    description: "A document defining how the brand's marks and assets should be used.",
    interview: [
      q(
        "brand_guide_date",
        "When was this brand guide created or last updated?",
        "Supports the timeline of when your brand standards were formalized.",
        "e.g. January 2025",
      ),
      q(
        "brand_guide_covers_logo",
        "Does this document the logo you actually use, not just a proposal?",
        "Confirms the guide reflects your real, adopted mark.",
      ),
    ],
    suggestedConnections: ["final_logo", "logo_variations"],
    suggestedCategory: "trademark_supporting",
    scoringHints: [],
    exportDestination: "08_SUPPORTING_DOCUMENTS",
    legacyFileRole: "document",
    deprecated: false,
    versionIntroduced: "1.0",
  },
  {
    id: "logo_variations",
    displayName: "Logo Variations",
    category: "design",
    description: "Alternate versions of the logo (color, monochrome, icon-only, etc.).",
    interview: [
      q(
        "logo_variations_actively_used",
        "Is this variation actually in use, or was it explored and dropped?",
        "Separates real alternates from ideas that never went anywhere.",
      ),
      q(
        "logo_variations_where_used",
        "Where does this variation appear?",
        "Establishes the real-world context this version is used in.",
        "e.g. favicon, monochrome print, social avatar",
      ),
    ],
    suggestedConnections: ["final_logo", "brand_guide"],
    suggestedCategory: "trademark_supporting",
    scoringHints: [],
    exportDestination: "05_PRODUCTS_AND_DESIGNS/Exports",
    legacyFileRole: "logo_export",
    deprecated: false,
    versionIntroduced: "1.0",
  },

  // ---------- Products ----------
  {
    id: "product_photo",
    displayName: "Product Photo",
    category: "products",
    description: "A photo of an actual product bearing the mark.",
    interview: [
      q(
        "product_photo_who_what_shown",
        "What product is shown in this photo, and who — if anyone — is with it?",
        "Establishes exactly what this image documents.",
        "e.g. FATLETIC Black Hoodie, worn by a customer",
      ),
      q(
        "product_photo_sold_gifted_sample",
        "Was this specific item sold, gifted, or just a sample?",
        "A genuine sale is stronger evidence than a promotional giveaway.",
      ),
      q("product_photo_date_taken", "When was this photo taken or posted?", "Supports the timeline of your brand's real-world use.", "e.g. April 2025"),
      q(
        "product_photo_publicly_posted",
        "Was this photo posted anywhere the public could see it?",
        "Public use is generally stronger evidence than a private photo.",
      ),
      q(
        "product_photo_matching_record",
        "Can this be connected to an invoice, order, or shipment you already have?",
        "Linking records together builds a stronger, more complete evidence chain.",
        "e.g. Printful Order #PF116824539",
      ),
    ],
    suggestedConnections: ["product_mockup", "printful_invoice", "customer_photo", "instagram_post"],
    suggestedCategory: "trademark_core",
    scoringHints: ["Product photos tied to a matching invoice or order are strong specimen candidates."],
    exportDestination: "05_PRODUCTS_AND_DESIGNS/Product_Photos",
    legacyFileRole: "product_photo",
    deprecated: false,
    versionIntroduced: "1.0",
  },
  {
    id: "lifestyle_photo",
    displayName: "Lifestyle Photo",
    category: "products",
    description: "A photo showing the product in real-world use rather than as a plain studio shot.",
    interview: [
      q(
        "lifestyle_photo_context",
        "What's happening in this photo — where is the product being used or worn?",
        "Real-world context helps show genuine, non-staged use.",
        "e.g. customer wearing the hoodie at the gym",
      ),
      q(
        "lifestyle_photo_publicly_posted",
        "Was this photo posted anywhere the public could see it?",
        "Public use is generally stronger evidence than a private photo.",
      ),
      q("lifestyle_photo_date_taken", "When was this photo taken or posted?", "Supports the timeline of your brand's real-world use.", "e.g. April 2025"),
    ],
    suggestedConnections: ["product_photo", "instagram_post", "customer_photo"],
    suggestedCategory: "trademark_core",
    scoringHints: [],
    exportDestination: "05_PRODUCTS_AND_DESIGNS/Product_Photos",
    legacyFileRole: "marketing_photo",
    deprecated: false,
    versionIntroduced: "1.0",
  },
  {
    id: "product_mockup",
    displayName: "Product Mockup",
    category: "products",
    description: "A rendered or simulated view of a product before or without an actual physical version.",
    interview: [
      q(
        "product_mockup_ever_produced",
        "Did this mockup ever become a real, physical product?",
        "A mockup that was never produced is weaker evidence than one that became real.",
      ),
      q(
        "product_mockup_matching_record",
        "Do you have a real photo of the finished product this mockup shows?",
        "Connecting the mockup to the real product strengthens this evidence.",
      ),
    ],
    suggestedConnections: ["final_logo", "product_photo"],
    suggestedCategory: "trademark_supporting",
    scoringHints: ["A mockup with no corresponding real product photo is weaker evidence of actual use."],
    exportDestination: "05_PRODUCTS_AND_DESIGNS/Source_Files",
    legacyFileRole: "product_design",
    deprecated: false,
    versionIntroduced: "1.0",
  },
  {
    id: "packaging",
    displayName: "Packaging",
    category: "products",
    description: "Photos or artwork of product packaging bearing the mark.",
    interview: [
      q(
        "packaging_actually_used",
        "Was this packaging actually used to ship a real order, or is it concept artwork?",
        "Packaging that actually shipped is stronger evidence than an unused design.",
      ),
      q(
        "packaging_matching_record",
        "Can this be connected to a product or shipment record you already have?",
        "Linking records together builds a stronger evidence chain.",
        "e.g. Printful Order #PF116824539",
      ),
    ],
    suggestedConnections: ["product_photo", "hang_tag", "label", "shipping_confirmation"],
    suggestedCategory: "trademark_core",
    scoringHints: [],
    exportDestination: "06_PACKAGING_AND_LABELS",
    legacyFileRole: "packaging",
    deprecated: false,
    versionIntroduced: "1.0",
  },
  {
    id: "hang_tag",
    displayName: "Hang Tag",
    category: "products",
    description: "A tag attached to a product bearing the mark.",
    interview: [
      q(
        "hang_tag_actually_used",
        "Was this hang tag actually attached to a real product you sold?",
        "Confirms this is a real, used tag rather than concept artwork.",
      ),
    ],
    suggestedConnections: ["packaging", "product_photo"],
    suggestedCategory: "trademark_core",
    scoringHints: [],
    exportDestination: "06_PACKAGING_AND_LABELS",
    legacyFileRole: "packaging",
    deprecated: false,
    versionIntroduced: "1.0",
  },
  {
    id: "label",
    displayName: "Label",
    category: "products",
    description: "A label affixed to a product or its packaging bearing the mark.",
    interview: [
      q(
        "label_actually_used",
        "Was this label actually used on a real product you sold?",
        "Confirms this is a real, used label rather than concept artwork.",
      ),
    ],
    suggestedConnections: ["packaging", "product_photo"],
    suggestedCategory: "trademark_core",
    scoringHints: [],
    exportDestination: "06_PACKAGING_AND_LABELS",
    legacyFileRole: "packaging",
    deprecated: false,
    versionIntroduced: "1.0",
  },

  // ---------- Commerce ----------
  {
    id: "printful_proof",
    displayName: "Printful Proof",
    category: "commerce",
    description: "A print-vendor proof document, typically identified by a numeric ID rather than invoice language.",
    interview: [
      q("printful_proof_order_number", "What's the order number on this proof?", "Lets this document be matched to your other records.", "e.g. PF116824539"),
      q(
        "printful_proof_products",
        "What products are listed on this proof?",
        "Ties this document to specific evidence of your product line.",
        "e.g. Unisex Long Sleeve Tee, Black Heather, XL",
      ),
      q(
        "printful_proof_matching_record",
        "Can this be connected to any product photos, customers, or posts you already have?",
        "Linking records together builds a stronger evidence chain.",
      ),
    ],
    suggestedConnections: ["product_photo", "printful_invoice", "shipping_confirmation"],
    suggestedCategory: "trademark_core",
    scoringHints: [],
    exportDestination: "02_PRINTFUL/Orders",
    legacyFileRole: "print_vendor_proof",
    deprecated: false,
    versionIntroduced: "1.0",
  },
  {
    id: "printful_invoice",
    displayName: "Printful Invoice",
    category: "commerce",
    description: "An invoice from the Printful print-on-demand vendor.",
    interview: [
      q("printful_invoice_order_number", "What's the order number on this invoice?", "Lets this document be matched to your other records.", "e.g. PF116824539"),
      q("printful_invoice_date", "What date is on this invoice?", "Supports the timeline of your commercial use.", "e.g. February 20, 2025"),
      q(
        "printful_invoice_products",
        "What products are listed on this invoice?",
        "Ties this document to specific evidence of your product line.",
        "e.g. FATLETIC Hoodie, Black T-Shirt",
      ),
      q(
        "printful_invoice_related_shipment",
        "Is there a shipment record for this order?",
        "Connects the sale to its actual fulfillment.",
      ),
      q(
        "printful_invoice_related_product_photos",
        "Do you have product photos from this same order?",
        "Linking records together builds a stronger evidence chain.",
      ),
    ],
    suggestedConnections: ["customer_order", "shipping_confirmation", "product_photo"],
    suggestedCategory: "trademark_core",
    scoringHints: ["Invoices are strong evidence of genuine commercial use when they match a product and a customer."],
    exportDestination: "02_PRINTFUL/Invoices",
    legacyFileRole: "printful_invoice",
    deprecated: false,
    versionIntroduced: "1.0",
  },
  {
    id: "customer_invoice",
    displayName: "Customer Invoice",
    category: "commerce",
    description: "An invoice issued directly to a customer.",
    interview: [
      q("customer_invoice_order_number", "What's the order number on this invoice?", "Lets this document be matched to your other records.", "e.g. Shopify Order #482"),
      q("customer_invoice_date", "What date is on this invoice?", "Supports the timeline of your commercial use.", "e.g. March 3, 2025"),
      q(
        "customer_invoice_products",
        "What products are listed on this invoice?",
        "Ties this document to specific evidence of your product line.",
        "e.g. FATLETIC Hoodie, size L",
      ),
      q(
        "customer_invoice_purpose",
        "Was this a real sale, a sample, or a gift?",
        "Distinguishes genuine commerce from promotional activity.",
      ),
    ],
    suggestedConnections: ["customer_order", "product_photo", "customer_email"],
    suggestedCategory: "trademark_core",
    scoringHints: [],
    exportDestination: "02_PRINTFUL/Invoices",
    legacyFileRole: "payment_record",
    deprecated: false,
    versionIntroduced: "1.0",
  },
  {
    id: "receipt",
    displayName: "Receipt",
    category: "commerce",
    description: "A receipt confirming a completed transaction.",
    interview: [
      q("receipt_date", "What date is on this receipt?", "Supports the timeline of your commercial use.", "e.g. March 3, 2025"),
      q("receipt_products", "What was purchased on this receipt?", "Ties this document to specific evidence of your product line.", "e.g. FATLETIC Sticker Pack"),
    ],
    suggestedConnections: ["customer_invoice", "customer_order"],
    suggestedCategory: "trademark_core",
    scoringHints: [],
    exportDestination: "02_PRINTFUL/Invoices",
    legacyFileRole: "payment_record",
    deprecated: false,
    versionIntroduced: "1.0",
  },
  {
    id: "packing_slip",
    displayName: "Packing Slip",
    category: "commerce",
    description: "A document listing the contents of a shipment.",
    interview: [
      q("packing_slip_order_number", "What's the order number on this packing slip?", "Lets this document be matched to your other records.", "e.g. PF116824539"),
      q(
        "packing_slip_products",
        "What products are listed on this packing slip?",
        "Ties this document to specific evidence of your product line.",
      ),
    ],
    suggestedConnections: ["shipping_confirmation", "customer_order"],
    suggestedCategory: "trademark_core",
    scoringHints: [],
    exportDestination: "02_PRINTFUL/Shipments",
    legacyFileRole: "shipping_record",
    deprecated: false,
    versionIntroduced: "1.0",
  },
  {
    id: "shipping_confirmation",
    displayName: "Shipping Confirmation",
    category: "commerce",
    description: "Confirmation that an order was shipped, e.g. a tracking notice.",
    interview: [
      q("shipping_confirmation_order_number", "What order does this shipment belong to?", "Lets this document be matched to your other records.", "e.g. PF116824539"),
      q("shipping_confirmation_date", "What date did this ship?", "Supports the timeline of your commercial use.", "e.g. February 25, 2025"),
    ],
    suggestedConnections: ["customer_order", "packing_slip", "customer_photo"],
    suggestedCategory: "trademark_core",
    scoringHints: [],
    exportDestination: "02_PRINTFUL/Shipments",
    legacyFileRole: "shipping_record",
    deprecated: false,
    versionIntroduced: "1.0",
  },
  {
    id: "customer_order",
    displayName: "Customer Order",
    category: "commerce",
    description: "A record of an order placed by a customer.",
    interview: [
      q("customer_order_number", "What's the order number?", "Lets this document be matched to your other records.", "e.g. Shopify Order #482"),
      q("customer_order_date", "What date was this order placed?", "Supports the timeline of your commercial use.", "e.g. March 1, 2025"),
      q(
        "customer_order_products",
        "What products were ordered?",
        "Ties this document to specific evidence of your product line.",
        "e.g. FATLETIC Hoodie, Black T-Shirt",
      ),
      q("customer_order_quantity", "How many were ordered?", "Helps distinguish a one-off sample from a genuine order.", "e.g. 4"),
    ],
    suggestedConnections: ["printful_invoice", "shipping_confirmation", "customer_photo"],
    suggestedCategory: "trademark_core",
    scoringHints: [],
    exportDestination: "02_PRINTFUL/Orders",
    legacyFileRole: "printful_order",
    deprecated: false,
    versionIntroduced: "1.0",
  },

  // ---------- Marketing ----------
  {
    id: "website_screenshot",
    displayName: "Website Screenshot",
    category: "marketing",
    description: "A screenshot of the brand's own website showing the mark in use.",
    interview: [
      q("website_screenshot_url", "What page is this a screenshot of?", "Lets anyone independently verify this use.", "e.g. fatletic.com/products/hoodie"),
      q(
        "website_screenshot_date",
        "Roughly when was this screenshot taken?",
        "Filesystem timestamps alone aren't proof of the real-world date.",
        "e.g. April 2025",
      ),
      q(
        "website_screenshot_shows_product",
        "Does this screenshot show a specific product?",
        "Connects this public use to a real, sellable item.",
      ),
    ],
    suggestedConnections: ["final_logo", "product_photo", "shopify_product_page"],
    suggestedCategory: "trademark_core",
    scoringHints: ["Public website use with a visible URL and date is strong specimen evidence."],
    exportDestination: "03_SOCIAL_MEDIA/Other",
    legacyFileRole: "marketing_photo",
    deprecated: false,
    versionIntroduced: "1.0",
  },
  {
    id: "shopify_product_page",
    displayName: "Shopify Product Page",
    category: "marketing",
    description: "A screenshot or export of a live Shopify product listing.",
    interview: [
      q("shopify_product_page_url", "What's the URL of this product page?", "Lets anyone independently verify this use.", "e.g. fatletic.com/products/hoodie"),
      q(
        "shopify_product_page_date",
        "Roughly when was this screenshot taken?",
        "Filesystem timestamps alone aren't proof of the real-world date.",
        "e.g. April 2025",
      ),
      q(
        "shopify_product_page_still_live",
        "Is this listing still live today?",
        "A currently-active listing is stronger evidence of continuous use.",
      ),
    ],
    suggestedConnections: ["product_photo", "printful_invoice"],
    suggestedCategory: "trademark_core",
    scoringHints: [],
    exportDestination: "03_SOCIAL_MEDIA/Other",
    legacyFileRole: "marketing_photo",
    deprecated: false,
    versionIntroduced: "1.0",
  },
  {
    id: "etsy_listing",
    displayName: "Etsy Listing",
    category: "marketing",
    description: "A screenshot or export of a live Etsy product listing.",
    interview: [
      q("etsy_listing_url", "What's the URL of this Etsy listing?", "Lets anyone independently verify this use.", "e.g. etsy.com/listing/..."),
      q(
        "etsy_listing_date",
        "Roughly when was this screenshot taken?",
        "Filesystem timestamps alone aren't proof of the real-world date.",
        "e.g. April 2025",
      ),
    ],
    suggestedConnections: ["product_photo", "customer_review"],
    suggestedCategory: "trademark_core",
    scoringHints: [],
    exportDestination: "03_SOCIAL_MEDIA/Other",
    legacyFileRole: "marketing_photo",
    deprecated: false,
    versionIntroduced: "1.0",
  },
  {
    id: "instagram_post",
    displayName: "Instagram Post",
    category: "marketing",
    description: "A public post on the brand's Instagram account.",
    interview: [
      q("instagram_post_publish_date", "What date was this posted?", "Supports the timeline of your public brand use.", "e.g. April 12, 2025"),
      q(
        "instagram_post_caption",
        "What was the caption on this post?",
        "Captures the public-facing context of the post.",
        "e.g. 'New hoodie drop 🔥 link in bio'",
      ),
      q("instagram_post_url", "What's the public URL of this post?", "Lets anyone independently verify this use.", "e.g. instagram.com/p/..."),
      q(
        "instagram_post_related_product",
        "Which product(s) shown here does this post relate to?",
        "Connects this public post to a real, sellable item.",
        "e.g. FATLETIC Black T-Shirt, Hoodie",
      ),
      q(
        "instagram_post_related_order",
        "Can this be connected to a specific order?",
        "Linking records together builds a stronger evidence chain.",
        "e.g. Printful Order #PF116824539",
      ),
      q(
        "instagram_post_related_customer",
        "Can this be connected to a specific customer?",
        "Linking records together builds a stronger evidence chain.",
      ),
    ],
    suggestedConnections: ["product_photo", "customer_photo", "customer_order"],
    suggestedCategory: "trademark_core",
    scoringHints: ["A dated, public post with a live URL is strong specimen evidence."],
    exportDestination: "03_SOCIAL_MEDIA/Instagram",
    legacyFileRole: "social_post_export",
    deprecated: false,
    versionIntroduced: "1.0",
  },
  {
    id: "facebook_post",
    displayName: "Facebook Post",
    category: "marketing",
    description: "A public post on the brand's Facebook page.",
    interview: [
      q("facebook_post_publish_date", "What date was this posted?", "Supports the timeline of your public brand use.", "e.g. April 12, 2025"),
      q("facebook_post_caption", "What was the caption on this post?", "Captures the public-facing context of the post."),
      q("facebook_post_url", "What's the public URL of this post?", "Lets anyone independently verify this use.", "e.g. facebook.com/..."),
      q(
        "facebook_post_related_product",
        "Which product(s) shown here does this post relate to?",
        "Connects this public post to a real, sellable item.",
        "e.g. FATLETIC Hoodie",
      ),
    ],
    suggestedConnections: ["product_photo", "customer_photo"],
    suggestedCategory: "trademark_core",
    scoringHints: [],
    exportDestination: "03_SOCIAL_MEDIA/Other",
    legacyFileRole: "social_post_export",
    deprecated: false,
    versionIntroduced: "1.0",
  },
  {
    id: "tiktok_post",
    displayName: "TikTok Post",
    category: "marketing",
    description: "A public post on the brand's TikTok account.",
    interview: [
      q("tiktok_post_publish_date", "What date was this posted?", "Supports the timeline of your public brand use.", "e.g. April 12, 2025"),
      q("tiktok_post_caption", "What was the caption on this post?", "Captures the public-facing context of the post."),
      q("tiktok_post_url", "What's the public URL of this post?", "Lets anyone independently verify this use.", "e.g. tiktok.com/@.../video/..."),
      q(
        "tiktok_post_related_product",
        "Which product(s) shown here does this post relate to?",
        "Connects this public post to a real, sellable item.",
        "e.g. FATLETIC Hoodie",
      ),
    ],
    suggestedConnections: ["product_photo", "customer_photo"],
    suggestedCategory: "trademark_core",
    scoringHints: [],
    exportDestination: "03_SOCIAL_MEDIA/Other",
    legacyFileRole: "social_post_export",
    deprecated: false,
    versionIntroduced: "1.0",
  },
  {
    id: "advertisement",
    displayName: "Advertisement",
    category: "marketing",
    description: "A paid or organic advertisement featuring the mark.",
    interview: [
      q("advertisement_platform", "What platform did this ad run on?", "Establishes the real-world context of this public use.", "e.g. Instagram, Facebook, Google"),
      q(
        "advertisement_date",
        "Roughly when did this ad run?",
        "Filesystem timestamps alone aren't proof of the real-world date.",
        "e.g. April 2025",
      ),
      q(
        "advertisement_paid",
        "Was this a paid placement, or an organic post?",
        "Distinguishes paid advertising from organic content.",
      ),
    ],
    suggestedConnections: ["product_photo", "website_screenshot"],
    suggestedCategory: "trademark_core",
    scoringHints: [],
    exportDestination: "03_SOCIAL_MEDIA/Other",
    legacyFileRole: "marketing_photo",
    deprecated: false,
    versionIntroduced: "1.0",
  },
  {
    id: "email_campaign",
    displayName: "Email Campaign",
    category: "marketing",
    description: "A marketing email sent featuring the mark.",
    interview: [
      q("email_campaign_send_date", "What date was this email sent?", "Supports the timeline of your public brand use.", "e.g. April 2025"),
      q(
        "email_campaign_subject",
        "What was the subject line?",
        "Captures the public-facing context of the campaign.",
        "e.g. 'New Hoodie Drop — Shop Now'",
      ),
      q(
        "email_campaign_related_product",
        "Which product(s) does this campaign relate to?",
        "Connects the campaign to a real, sellable item.",
      ),
    ],
    suggestedConnections: ["product_photo", "customer_email"],
    suggestedCategory: "trademark_supporting",
    scoringHints: [],
    exportDestination: "08_SUPPORTING_DOCUMENTS",
    legacyFileRole: "document",
    deprecated: false,
    versionIntroduced: "1.0",
  },

  // ---------- Customers ----------
  {
    id: "customer_photo",
    displayName: "Customer Photo",
    category: "customers",
    description: "A photo of a real customer with the product.",
    interview: [
      // Evidence Intelligence Phase 1 requirement: a Customer Photos
      // folder (or any visual similarity to one) is a *prior*, never
      // proof — this question exists specifically so nothing in the app
      // ever asserts a person is a customer merely because of where the
      // file sits or what it shows. analysisEngine.ts generates a
      // suggestion for this question that is always 'unresolved' with no
      // proposed value; it is never guessed.
      q(
        "customer_photo_relationship",
        "What was this person's relationship to FATLETIC?",
        "A folder name or photo appearance is never proof of who someone is — only you can confirm this.",
        "e.g. customer, gift recipient, founder/owner, employee/team member, friend/family, model, influencer/promotional recipient, or unknown",
      ),
      q(
        "customer_photo_who_shown",
        "Who is shown in this photo, and what are they wearing or holding?",
        "Establishes exactly what this photo documents.",
        "e.g. a customer wearing the FATLETIC Hoodie",
      ),
      q(
        "customer_photo_sold_gifted_sample",
        "Was this a real sale, a gift, or a sample?",
        "A genuine sale is stronger evidence than a promotional giveaway.",
      ),
      q(
        "customer_photo_publicly_posted",
        "Was this photo posted anywhere the public could see it?",
        "Public use is generally stronger evidence than a private photo.",
      ),
      q(
        "customer_photo_matching_record",
        "Can this be connected to an order or shipment you already have?",
        "Linking records together builds a stronger evidence chain.",
      ),
    ],
    suggestedConnections: ["customer_order", "instagram_post", "customer_review"],
    suggestedCategory: "trademark_core",
    scoringHints: ["Customer photos tied to a real order are strong evidence of genuine commercial use."],
    exportDestination: "04_CUSTOMERS/Photos",
    legacyFileRole: "customer_photo",
    deprecated: false,
    versionIntroduced: "1.0",
  },
  {
    id: "customer_review",
    displayName: "Customer Review",
    category: "customers",
    description: "Written feedback left by a real customer.",
    interview: [
      q("customer_review_platform", "Where was this review posted?", "Establishes the real-world context of this evidence.", "e.g. Etsy, Google, Instagram DM"),
      q(
        "customer_review_date",
        "Roughly when was this review posted?",
        "Filesystem timestamps alone aren't proof of the real-world date.",
        "e.g. April 2025",
      ),
      q(
        "customer_review_matching_record",
        "Can this be connected to an order you already have?",
        "Linking records together builds a stronger evidence chain.",
      ),
    ],
    suggestedConnections: ["customer_order", "etsy_listing"],
    suggestedCategory: "trademark_supporting",
    scoringHints: [],
    exportDestination: "04_CUSTOMERS/Messages",
    legacyFileRole: "message",
    deprecated: false,
    versionIntroduced: "1.0",
  },
  {
    id: "customer_message",
    displayName: "Customer Message",
    category: "customers",
    description: "A direct message exchange with a real customer.",
    interview: [
      q(
        "customer_message_date",
        "Roughly when was this message sent?",
        "Filesystem timestamps alone aren't proof of the real-world date.",
        "e.g. April 2025",
      ),
      q(
        "customer_message_topic",
        "What is this conversation about?",
        "Establishes exactly what this correspondence documents.",
        "e.g. asking about hoodie sizing",
      ),
      q(
        "customer_message_matching_record",
        "Can this be connected to an order you already have?",
        "Linking records together builds a stronger evidence chain.",
      ),
    ],
    suggestedConnections: ["customer_order", "customer_photo"],
    suggestedCategory: "trademark_supporting",
    scoringHints: [],
    exportDestination: "04_CUSTOMERS/Messages",
    legacyFileRole: "message",
    deprecated: false,
    versionIntroduced: "1.0",
  },
  {
    id: "customer_email",
    displayName: "Customer Email",
    category: "customers",
    description: "An email exchange with a real customer.",
    interview: [
      q("customer_email_date", "What date was this email sent?", "Supports the timeline of your brand's use.", "e.g. April 2025"),
      q(
        "customer_email_topic",
        "What is this email about?",
        "Establishes exactly what this correspondence documents.",
        "e.g. order confirmation, sizing question",
      ),
      q(
        "customer_email_matching_record",
        "Can this be connected to an order you already have?",
        "Linking records together builds a stronger evidence chain.",
      ),
    ],
    suggestedConnections: ["customer_order", "customer_invoice"],
    suggestedCategory: "trademark_supporting",
    scoringHints: [],
    exportDestination: "04_CUSTOMERS/Messages",
    legacyFileRole: "message",
    deprecated: false,
    versionIntroduced: "1.0",
  },

  // ---------- Business ----------
  {
    id: "business_registration",
    displayName: "Business Registration",
    category: "business",
    description: "A document showing formal registration of the business.",
    interview: [
      q(
        "business_registration_date",
        "What date was the business registered?",
        "Supports your business's documented history and timeline.",
        "e.g. January 2024",
      ),
      q(
        "business_registration_entity_name",
        "What's the registered legal entity name?",
        "Confirms the legal entity behind your mark.",
        "e.g. Fatletic LLC",
      ),
    ],
    suggestedConnections: ["tax_document", "bank_record"],
    suggestedCategory: "business_history",
    scoringHints: [],
    exportDestination: "08_SUPPORTING_DOCUMENTS",
    legacyFileRole: "document",
    deprecated: false,
    versionIntroduced: "1.0",
  },
  {
    id: "bank_record",
    displayName: "Bank Record",
    category: "business",
    description: "A bank statement or record showing business financial activity.",
    interview: [
      q(
        "bank_record_date_range",
        "What date range does this record cover?",
        "Supports your business's documented history and timeline.",
        "e.g. Jan–Mar 2025",
      ),
      q(
        "bank_record_shows_what",
        "What business activity does this record show?",
        "Clarifies exactly what this record documents.",
        "e.g. Printful payments, Shopify payouts",
      ),
    ],
    suggestedConnections: ["business_registration", "tax_document"],
    suggestedCategory: "business_history",
    scoringHints: [],
    exportDestination: "08_SUPPORTING_DOCUMENTS",
    legacyFileRole: "payment_record",
    deprecated: false,
    versionIntroduced: "1.0",
  },
  {
    id: "tax_document",
    displayName: "Tax Document",
    category: "business",
    description: "A tax filing or record related to the business.",
    interview: [
      q(
        "tax_document_period",
        "What tax period does this document cover?",
        "Supports your business's documented history and timeline.",
        "e.g. Tax Year 2025",
      ),
    ],
    suggestedConnections: ["business_registration", "bank_record"],
    suggestedCategory: "business_history",
    scoringHints: [],
    exportDestination: "08_SUPPORTING_DOCUMENTS",
    legacyFileRole: "document",
    deprecated: false,
    versionIntroduced: "1.0",
  },
  {
    id: "business_plan",
    displayName: "Business Plan",
    category: "business",
    description: "A written plan describing the business and its goals.",
    interview: [
      q("business_plan_date", "Roughly when was this written?", "Supports your business's documented history and timeline.", "e.g. late 2024"),
      q(
        "business_plan_mentions_mark",
        "Does this document actually describe your brand name or mark?",
        "Confirms this discusses your mark specifically, not just the business in general.",
      ),
    ],
    suggestedConnections: ["business_registration"],
    suggestedCategory: "business_history",
    scoringHints: [],
    exportDestination: "08_SUPPORTING_DOCUMENTS",
    legacyFileRole: "document",
    deprecated: false,
    versionIntroduced: "1.0",
  },

  // ---------- Legal ----------
  {
    id: "trademark_search",
    displayName: "Trademark Search",
    category: "legal",
    description: "A clearance or availability search performed for the mark.",
    interview: [
      q("trademark_search_date", "What date was this search performed?", "Establishes when clearance was checked.", "e.g. January 2025"),
      q(
        "trademark_search_performed_by",
        "Who performed this search?",
        "Establishes the source and reliability of this document.",
        "e.g. attorney, USPTO TESS, a search service",
      ),
    ],
    suggestedConnections: ["uspto_filing", "attorney_letter"],
    suggestedCategory: "business_history",
    scoringHints: [],
    exportDestination: "08_SUPPORTING_DOCUMENTS",
    legacyFileRole: "document",
    deprecated: false,
    versionIntroduced: "1.0",
  },
  {
    id: "office_action",
    displayName: "Office Action",
    category: "legal",
    description: "A formal communication from the USPTO regarding an application.",
    interview: [
      q("office_action_date", "What date was this issued?", "Establishes the legal timeline.", "e.g. March 2025"),
      q(
        "office_action_application_number",
        "What's the related application number?",
        "Lets this document be matched to the correct filing.",
        "e.g. Serial No. 98/123,456",
      ),
    ],
    suggestedConnections: ["uspto_filing", "attorney_letter"],
    suggestedCategory: "business_history",
    scoringHints: [],
    exportDestination: "08_SUPPORTING_DOCUMENTS",
    legacyFileRole: "document",
    deprecated: false,
    versionIntroduced: "1.0",
  },
  {
    id: "attorney_letter",
    displayName: "Attorney Letter",
    category: "legal",
    description: "Correspondence from legal counsel regarding the mark.",
    interview: [
      q("attorney_letter_date", "What date is on this letter?", "Establishes the legal timeline.", "e.g. March 2025"),
      q(
        "attorney_letter_topic",
        "What does this letter address?",
        "Clarifies exactly what this document covers.",
        "e.g. trademark clearance advice",
      ),
    ],
    suggestedConnections: ["trademark_search", "office_action", "uspto_filing"],
    suggestedCategory: "business_history",
    scoringHints: [],
    exportDestination: "08_SUPPORTING_DOCUMENTS",
    legacyFileRole: "document",
    deprecated: false,
    versionIntroduced: "1.0",
  },
  {
    id: "uspto_filing",
    displayName: "USPTO Filing",
    category: "legal",
    description: "A filing submitted to or received from the USPTO.",
    interview: [
      q("uspto_filing_date", "What date was this filed?", "Establishes the legal timeline.", "e.g. March 2025"),
      q(
        "uspto_filing_application_number",
        "What's the application or registration number?",
        "Lets this document be matched to the correct case.",
        "e.g. Serial No. 98/123,456",
      ),
    ],
    suggestedConnections: ["trademark_search", "office_action", "attorney_letter"],
    suggestedCategory: "business_history",
    scoringHints: [],
    exportDestination: "08_SUPPORTING_DOCUMENTS",
    legacyFileRole: "document",
    deprecated: false,
    versionIntroduced: "1.0",
  },

  // ---------- Media ----------
  {
    id: "video",
    displayName: "Video",
    category: "media",
    description: "A general video file not yet identified as promotional or product-specific.",
    interview: [
      q(
        "video_what_shown",
        "What actually happens in this video?",
        "The app can't watch the video for you — only you can describe what it shows.",
        "e.g. unboxing a hoodie order",
      ),
      q(
        "video_timestamps",
        "Are there specific timestamps worth noting?",
        "Helps a reviewer find the important moment without watching the whole file.",
        "e.g. 0:32 shows the logo clearly",
      ),
      q(
        "video_date_basis",
        "How do you know roughly when this video was made?",
        "Filesystem timestamps alone aren't proof of the real-world date.",
        "e.g. 'recorded the week we launched the hoodie'",
      ),
      q(
        "video_linked_evidence",
        "Is there other evidence connected to this video?",
        "Corroborating evidence strengthens the overall package.",
      ),
    ],
    suggestedConnections: ["promotional_video", "product_video"],
    suggestedCategory: "trademark_supporting",
    scoringHints: [],
    exportDestination: "04_CUSTOMERS/Videos",
    legacyFileRole: "video",
    deprecated: false,
    versionIntroduced: "1.0",
  },
  {
    id: "promotional_video",
    displayName: "Promotional Video",
    category: "media",
    description: "A video created to promote the brand or a product.",
    interview: [
      q("promotional_video_platform", "What platform was this published on?", "Establishes the real-world context of this public use.", "e.g. Instagram, TikTok, YouTube"),
      q("promotional_video_date", "What date was this published?", "Supports the timeline of your public brand use.", "e.g. April 2025"),
      q(
        "promotional_video_url",
        "Is there a public URL for this video?",
        "Lets anyone independently verify this use.",
      ),
    ],
    suggestedConnections: ["product_photo", "instagram_post"],
    suggestedCategory: "trademark_core",
    scoringHints: [],
    exportDestination: "04_CUSTOMERS/Videos",
    legacyFileRole: "video",
    deprecated: false,
    versionIntroduced: "1.0",
  },
  {
    id: "product_video",
    displayName: "Product Video",
    category: "media",
    description: "A video showing a specific product.",
    interview: [
      q("product_video_what_shown", "What product is shown in this video?", "Establishes exactly what this video documents.", "e.g. FATLETIC Hoodie"),
      q(
        "product_video_matching_record",
        "Can this be connected to a product photo or order you already have?",
        "Linking records together builds a stronger evidence chain.",
      ),
    ],
    suggestedConnections: ["product_photo", "customer_order"],
    suggestedCategory: "trademark_core",
    scoringHints: [],
    exportDestination: "04_CUSTOMERS/Videos",
    legacyFileRole: "video",
    deprecated: false,
    versionIntroduced: "1.0",
  },

  // ---------- Archive ----------
  {
    id: "miscellaneous",
    displayName: "Miscellaneous",
    category: "archive",
    description: "A file that does not clearly fit another evidence type.",
    interview: [
      q("miscellaneous_description", "What is this file?", "Establishes the basic identity of this evidence before anything else."),
      q(
        "miscellaneous_relevance",
        "Why might this matter to your trademark evidence package, if at all?",
        "Clarifies whether this file has any real bearing on the review.",
      ),
    ],
    suggestedConnections: [],
    suggestedCategory: "archive_only",
    scoringHints: [],
    exportDestination: "08_SUPPORTING_DOCUMENTS",
    legacyFileRole: "unknown",
    deprecated: false,
    versionIntroduced: "1.0",
  },
  {
    id: "unknown",
    displayName: "Unknown",
    category: "archive",
    description: "Not yet classified.",
    interview: [
      q("unknown_description", "What is this file?", "Establishes the basic identity of this evidence before anything else."),
    ],
    suggestedConnections: [],
    suggestedCategory: "unknown",
    scoringHints: [],
    exportDestination: "08_SUPPORTING_DOCUMENTS",
    legacyFileRole: "unknown",
    deprecated: false,
    versionIntroduced: "1.0",
  },
];

const REGISTRY_BY_ID = new Map(EVIDENCE_TYPE_REGISTRY.map((t) => [t.id, t]));

export function getEvidenceType(id: string): EvidenceTypeDefinition | null {
  return REGISTRY_BY_ID.get(id) ?? null;
}

export function getActiveEvidenceTypes(): EvidenceTypeDefinition[] {
  return EVIDENCE_TYPE_REGISTRY.filter((t) => !t.deprecated);
}

export function getEvidenceTypesByCategory(category: EvidenceTypeCategoryId): EvidenceTypeDefinition[] {
  return EVIDENCE_TYPE_REGISTRY.filter((t) => t.category === category);
}

export function getInterviewForType(id: string): EvidenceInterviewQuestion[] {
  return getEvidenceType(id)?.interview ?? [];
}

export interface EvidenceTypeSuggestionInput {
  filename: string;
  extension: string;
  /** Folder path relative to the evidence root, e.g. "Design Files/Working". */
  folderPath: string;
  width: number | null;
  height: number | null;
  /** Extensions (lowercase, no dot) of other files in the same folder — used for "located beside X files" signals. */
  siblingExtensions: string[];
}

export interface EvidenceTypeSuggestion {
  typeId: string;
  confidence: SuggestionConfidence;
  reasons: string[];
}

interface Candidate {
  typeId: string;
  reasons: string[];
}

function addReason(candidates: Map<string, string[]>, typeId: string, reason: string): void {
  const existing = candidates.get(typeId);
  if (existing) {
    existing.push(reason);
  } else {
    candidates.set(typeId, [reason]);
  }
}

/**
 * Deterministic, explainable evidence-type suggestion (Part 4). Every
 * signal that contributes to a candidate is recorded as a plain-English
 * reason string — nothing is scored without an accompanying explanation
 * (docs/DESIGN_LANGUAGE.md "never display unexplained suggestions").
 * This is never persisted as the confirmed type — see
 * `evidenceTypeService.confirmType` on the server, which always requires
 * an explicit user confirm/change action (Part 4: "never auto-confirm").
 */
export function suggestEvidenceType(input: EvidenceTypeSuggestionInput): EvidenceTypeSuggestion {
  const candidates = collectFilenameFolderCandidates(input);
  return rankCandidates(candidates);
}

/** The filename/folder/extension candidate-collection body shared by `suggestEvidenceType` and `rankEvidenceTypeCandidates` — extracted so there is exactly one place this heuristic is defined (docs/ARCHITECTURE_CONSTITUTION.md #2, "business rules exist exactly once"). */
function collectFilenameFolderCandidates(input: EvidenceTypeSuggestionInput): Map<string, string[]> {
  const name = input.filename.toLowerCase();
  const folder = input.folderPath.toLowerCase();
  const ext = input.extension.toLowerCase().replace(/^\./, "");
  const siblings = input.siblingExtensions.map((e) => e.toLowerCase().replace(/^\./, ""));
  const candidates = new Map<string, string[]>();

  // --- Design ---
  if (ext === "psd") addReason(candidates, "psd_source", "File extension is .psd");
  if (ext === "ai") addReason(candidates, "illustrator_source", "File extension is .ai");
  if (ext === "svg") addReason(candidates, "svg_source", "File extension is .svg");

  // heic/heif included alongside standard raster extensions — this
  // heuristic is filename/folder/extension-based only (never actual
  // pixel content), so it applies identically regardless of whether the
  // browser can render the file inline (docs/ADR_0005_HEIC_PREVIEWS.md).
  if (["jpg", "jpeg", "png", "webp", "gif", "heic", "heif"].includes(ext)) {
    if (name.includes("edit")) addReason(candidates, "design_mockup", 'Filename contains "edit"');
    if (siblings.includes("psd")) addReason(candidates, "design_mockup", "Located beside PSD files");
    if (folder.includes("design")) addReason(candidates, "design_mockup", "Referenced from a Design folder");

    if (name.includes("final") && name.includes("logo")) addReason(candidates, "final_logo", 'Filename contains "final" and "logo"');
    if (folder.includes("final") && name.includes("logo")) addReason(candidates, "final_logo", 'Located in a folder containing "final"');

    if (name.includes("product") || folder.includes("product")) addReason(candidates, "product_photo", 'Filename or folder contains "product"');
    if (name.includes("customer") || folder.includes("customer")) addReason(candidates, "customer_photo", 'Filename or folder contains "customer"');
    if (name.includes("lifestyle") || folder.includes("lifestyle")) addReason(candidates, "lifestyle_photo", 'Filename or folder contains "lifestyle"');
    if (name.includes("mockup") || folder.includes("mockup")) addReason(candidates, "product_mockup", 'Filename or folder contains "mockup"');
    if (name.includes("instagram") || folder.includes("instagram")) addReason(candidates, "instagram_post", 'Filename or folder contains "instagram"');
    if (name.includes("facebook") || folder.includes("facebook")) addReason(candidates, "facebook_post", 'Filename or folder contains "facebook"');
    if (name.includes("tiktok") || folder.includes("tiktok")) addReason(candidates, "tiktok_post", 'Filename or folder contains "tiktok"');
    if (name.includes("hang") && name.includes("tag")) addReason(candidates, "hang_tag", 'Filename contains "hang tag"');
    if (name.includes("label") || folder.includes("label")) addReason(candidates, "label", 'Filename or folder contains "label"');
    if (name.includes("packaging") || folder.includes("packaging")) addReason(candidates, "packaging", 'Filename or folder contains "packaging"');
    if (name.includes("screenshot") && (name.includes("shopify") || folder.includes("shopify"))) {
      addReason(candidates, "shopify_product_page", 'Filename or folder contains "shopify"');
    }
    if (name.includes("screenshot") && (name.includes("etsy") || folder.includes("etsy"))) {
      addReason(candidates, "etsy_listing", 'Filename or folder contains "etsy"');
    }
    if (name.includes("screenshot") && (name.includes("website") || name.includes("site"))) {
      addReason(candidates, "website_screenshot", 'Filename contains "website" or "site"');
    }
    if (name.includes("ad") && (name.includes("advert") || folder.includes("advert"))) {
      addReason(candidates, "advertisement", 'Filename or folder references advertising');
    }
  }

  // --- Media ---
  if (["mp4", "mov", "avi", "webm"].includes(ext)) {
    addReason(candidates, "video", "File extension indicates a video");
    if (name.includes("promo") || folder.includes("promo")) addReason(candidates, "promotional_video", 'Filename or folder contains "promo"');
    if (name.includes("product") || folder.includes("product")) addReason(candidates, "product_video", 'Filename or folder contains "product"');
  }

  // --- Commerce / Business / Legal (mostly PDFs and documents) ---
  if (["pdf", "doc", "docx", "txt"].includes(ext)) {
    // A generic "Proof Files" folder name is weaker evidence than a
    // specific commerce keyword actually in the filename — real Printful
    // Proof documents are typically named by numeric ID alone (see the
    // registry entry's description), so the folder-only signal is
    // suppressed whenever the filename itself already names a more
    // specific document type (invoice/order/receipt/packing/shipping).
    // Without this, a file like "printful_invoice_44821.pdf" sitting in
    // a "Proof Files" folder would tie printful_proof against
    // printful_invoice on reason count and lose to insertion order.
    const hasSpecificCommerceKeyword =
      name.includes("invoice") ||
      name.includes("order") ||
      name.includes("receipt") ||
      name.includes("packing") ||
      name.includes("shipping") ||
      name.includes("shipment");
    if (name.includes("proof")) addReason(candidates, "printful_proof", 'Filename contains "proof"');
    if (folder.includes("proof") && !hasSpecificCommerceKeyword) {
      addReason(candidates, "printful_proof", 'Located in a "Proof" folder');
    }
    if (name.includes("printful") && name.includes("invoice")) addReason(candidates, "printful_invoice", 'Filename contains "printful" and "invoice"');
    if (name.includes("invoice") && !name.includes("printful")) addReason(candidates, "customer_invoice", 'Filename contains "invoice"');
    if (name.includes("receipt")) addReason(candidates, "receipt", 'Filename contains "receipt"');
    if (name.includes("packing") && name.includes("slip")) addReason(candidates, "packing_slip", 'Filename contains "packing slip"');
    if (name.includes("shipping") || name.includes("shipment")) addReason(candidates, "shipping_confirmation", 'Filename references shipping');
    if (name.includes("order")) addReason(candidates, "customer_order", 'Filename contains "order"');
    if (name.includes("registration")) addReason(candidates, "business_registration", 'Filename contains "registration"');
    if (name.includes("tax")) addReason(candidates, "tax_document", 'Filename contains "tax"');
    if (name.includes("bank") || name.includes("statement")) addReason(candidates, "bank_record", 'Filename references a bank statement');
    if (name.includes("business") && name.includes("plan")) addReason(candidates, "business_plan", 'Filename contains "business plan"');
    if (name.includes("trademark") && name.includes("search")) addReason(candidates, "trademark_search", 'Filename contains "trademark search"');
    if (name.includes("office") && name.includes("action")) addReason(candidates, "office_action", 'Filename contains "office action"');
    if (name.includes("attorney")) addReason(candidates, "attorney_letter", 'Filename contains "attorney"');
    if (name.includes("uspto")) addReason(candidates, "uspto_filing", 'Filename contains "uspto"');
    if (name.includes("mission")) addReason(candidates, "business_plan", 'Filename contains "mission"');
  }

  return candidates;
}

function candidateConfidence(reasonCount: number): SuggestionConfidence {
  return reasonCount >= 3 ? "high" : reasonCount === 2 ? "medium" : "low";
}

function rankCandidates(candidates: Map<string, string[]>): EvidenceTypeSuggestion {
  const candidateList: Candidate[] = Array.from(candidates.entries()).map(([typeId, reasons]) => ({ typeId, reasons }));

  if (candidateList.length === 0) {
    return {
      typeId: "miscellaneous",
      confidence: "low",
      reasons: ["No strong signals were found in the filename, folder, or file type."],
    };
  }

  candidateList.sort((a, b) => b.reasons.length - a.reasons.length);
  const winner = candidateList[0];
  return { typeId: winner.typeId, confidence: candidateConfidence(winner.reasons.length), reasons: winner.reasons };
}

/**
 * Every candidate this heuristic found for `input`, ranked highest-signal
 * first — not just the single winner `suggestEvidenceType` returns.
 * Evidence Intelligence Phase 1 (analysisEngine.ts) uses this so a
 * genuinely ambiguous file (e.g. a "mockup"-named screenshot that also
 * OCRs as a Printful order page) can be shown to the user as several
 * ranked options instead of silently collapsing to one. Filename/folder
 * signals are capped at `medium` confidence even for a strong reason
 * count — a folder name is a prior, never proof (Evidence Intelligence
 * Phase 1 requirement) — callers layering in OCR-text-based signals
 * (exact visible identifiers) are what can justify `high`.
 */
export function rankEvidenceTypeCandidates(input: EvidenceTypeSuggestionInput): EvidenceTypeSuggestion[] {
  const candidates = collectFilenameFolderCandidates(input);
  const candidateList: Candidate[] = Array.from(candidates.entries()).map(([typeId, reasons]) => ({ typeId, reasons }));
  candidateList.sort((a, b) => b.reasons.length - a.reasons.length);

  if (candidateList.length === 0) {
    return [{ typeId: "miscellaneous", confidence: "low", reasons: ["No strong signals were found in the filename, folder, or file type."] }];
  }

  return candidateList.map((c) => ({
    typeId: c.typeId,
    // Filename/folder alone is capped below High — see doc comment above.
    confidence: (candidateConfidence(c.reasons.length) === "high" ? "medium" : candidateConfidence(c.reasons.length)) as SuggestionConfidence,
    reasons: c.reasons,
  }));
}
