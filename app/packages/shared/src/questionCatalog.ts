import type { FileRole } from "./enums.js";

export interface QuestionDefinition {
  id: string;
  text: string;
  /** Shown alongside the question per docs/USER_JOURNEY.md's "every question includes a reason" pattern. */
  reason: string;
}

/**
 * Question catalog from specs/06_GUIDED_QUESTIONS.md. Lives in `shared`
 * (not server) because it is pure data with no side effects, and both
 * the server (answer validation) and the web client (rendering) need
 * the exact same list — one source, per
 * docs/ARCHITECTURE_CONSTITUTION.md #2 ("business rules exist exactly
 * once").
 *
 * Spec 06's 8th universal question, "Include in trademark package?", is
 * deliberately omitted here — that decision is already captured by the
 * Include/Maybe/Follow-Up/Archive buttons built in Phase 3
 * (docs/IMPLEMENTATION_PLAN.md Phase 3). Asking it again as a guided
 * question would create two different places recording the same
 * decision, which could disagree with each other.
 */
const UNIVERSAL_QUESTIONS: QuestionDefinition[] = [
  { id: "universal_what_is_this", text: "What is this file?", reason: "Establishes the basic identity of the evidence before anything else." },
  { id: "universal_shows_fatletic", text: "Does it show or reference FATLETIC?", reason: "Core to whether this file documents use of the mark at all." },
  { id: "universal_mark_visible", text: "Is the mark clearly visible?", reason: "Visibility affects how strong this evidence is as a specimen." },
  { id: "universal_real_product", text: "Is it connected to a real product?", reason: "Distinguishes concept/design work from actual commercial use." },
  { id: "universal_commerce_link", text: "Is it connected to an offer, sale, shipment, customer, or public promotion?", reason: "This is what turns a file into evidence of commercial use." },
  { id: "universal_real_world_date", text: "What real-world date applies, and what supports it?", reason: "Filesystem timestamps alone are not proof of the real-world event date." },
  { id: "universal_supporting_file", text: "Which other file supports this answer?", reason: "Corroborating evidence strengthens the overall package." },
];

const IMAGE_QUESTIONS: QuestionDefinition[] = [
  { id: "image_who_what_shown", text: "Who or what is shown in this image?", reason: "Establishes what the image actually documents." },
  { id: "image_sold_gifted_sample", text: "Was this item sold, gifted, or a sample?", reason: "Distinguishes a genuine sale from promotional giveaways." },
  { id: "image_date_taken", text: "What date was this taken or posted?", reason: "Supports the timeline of brand use." },
  { id: "image_publicly_posted", text: "Was this publicly posted?", reason: "Public use is generally stronger evidence than private records." },
  { id: "image_platform", text: "Which platform was this posted to, if any?", reason: "Helps corroborate the date and public nature of the use." },
  { id: "image_matching_record", text: "Does this match an invoice, order, message, or shipment you have?", reason: "Connecting records strengthens the evidence chain." },
  { id: "image_original_or_screenshot", text: "Is this an original photo or a screenshot?", reason: "Affects how the file should be described in the evidence binder." },
];

const INVOICE_ORDER_QUESTIONS: QuestionDefinition[] = [
  { id: "invoice_doc_type", text: "What type of document is this?", reason: "Clarifies whether this is a proof, order, or invoice." },
  { id: "invoice_order_number", text: "What is the order number?", reason: "Allows this document to be matched to other records." },
  { id: "invoice_date", text: "What date is on this document?", reason: "Supports the timeline of commercial use." },
  { id: "invoice_products", text: "What products are listed?", reason: "Ties this document to specific evidence of the product line." },
  { id: "invoice_quantity", text: "What quantity was involved?", reason: "Helps distinguish a one-off sample from a real order." },
  { id: "invoice_purpose", text: "What was the purpose of this order (sale, sample, gift)?", reason: "Distinguishes genuine commerce from promotional activity." },
  { id: "invoice_matching_record", text: "Does this match any images, customers, or posts you have?", reason: "Connecting records strengthens the evidence chain." },
];

const DESIGN_FILE_QUESTIONS: QuestionDefinition[] = [
  { id: "design_version", text: "What version is this design?", reason: "Distinguishes early concepts from the design actually used commercially." },
  { id: "design_printed_or_sold", text: "Was this design printed or sold?", reason: "A design that was never produced is weaker evidence of use." },
  { id: "design_matching_record", text: "Does this match any exports, products, or orders you have?", reason: "Connecting records strengthens the evidence chain." },
  { id: "design_history_or_commerce", text: "Is this brand-history-only, or does it relate to actual commerce?", reason: "Affects how this file should be categorized in the package." },
];

const VIDEO_QUESTIONS: QuestionDefinition[] = [
  { id: "video_what_shown", text: "What is shown in this video?", reason: "The app does not analyze video content — only you can describe it." },
  { id: "video_timestamps", text: "What are the relevant timestamps?", reason: "Helps a reviewer find the important moment without watching the whole file." },
  { id: "video_event_type", text: "What type of event is this (e.g. sale, promotion, event)?", reason: "Clarifies what kind of use this video documents." },
  { id: "video_date_basis", text: "What is the basis for the date of this video?", reason: "Filesystem timestamps alone are not proof of the real-world event date." },
  { id: "video_linked_evidence", text: "Is there other evidence linked to this video?", reason: "Corroborating evidence strengthens the overall package." },
];

const IMAGE_ROLES: FileRole[] = ["product_photo", "customer_photo", "marketing_photo", "social_post_export", "logo_export"];
const INVOICE_ORDER_ROLES: FileRole[] = ["printful_invoice", "printful_order", "payment_record", "shipping_record", "print_vendor_proof"];
const DESIGN_FILE_ROLES: FileRole[] = ["logo_source", "product_design", "packaging"];
const VIDEO_ROLES: FileRole[] = ["video"];

/**
 * Returns the full question set for a file role: universal questions
 * (always asked) plus the category-specific set that role maps to, if
 * any. Roles with no clear category (message, document,
 * specimen_candidate, duplicate, unknown, or no role assigned yet) get
 * universal questions only — spec 06 does not define a dedicated
 * question set for these, and it would be guessing to invent one.
 */
export function getQuestionsForRole(role: FileRole | null): QuestionDefinition[] {
  const categoryQuestions = role && IMAGE_ROLES.includes(role)
    ? IMAGE_QUESTIONS
    : role && INVOICE_ORDER_ROLES.includes(role)
      ? INVOICE_ORDER_QUESTIONS
      : role && DESIGN_FILE_ROLES.includes(role)
        ? DESIGN_FILE_QUESTIONS
        : role && VIDEO_ROLES.includes(role)
          ? VIDEO_QUESTIONS
          : [];

  return [...UNIVERSAL_QUESTIONS, ...categoryQuestions];
}
