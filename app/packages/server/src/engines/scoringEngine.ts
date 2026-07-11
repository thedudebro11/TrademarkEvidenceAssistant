import type { ConnectionType, FileRole, ReviewAnswer, UsefulnessBand } from "@trademark-evidence-assistant/shared";

export interface ScoringInput {
  answers: ReviewAnswer[];
  fileRole: FileRole | null;
  hasDuplicates: boolean;
  hasNotes: boolean;
  connectionTypes: ConnectionType[];
}

export interface UsefulnessResult {
  score: number;
  band: UsefulnessBand;
  /** Each satisfied positive factor, in plain language — spec 08 "explanation". */
  positiveFactors: string[];
  /** Each unsatisfied factor that would have helped — spec 08 "missing elements". */
  missingElements: string[];
}

const COMMERCE_DOCUMENT_ROLES: FileRole[] = ["printful_invoice", "printful_order", "shipping_record", "payment_record"];
const DESIGN_ROLES: FileRole[] = ["logo_source", "product_design", "packaging"];

function answerValue(answers: ReviewAnswer[], questionId: string): string {
  return answers.find((a) => a.questionId === questionId)?.value.trim() ?? "";
}

/**
 * Deliberately simple keyword matching (`\byes\b` / `\bno\b`), not
 * language understanding — spec 08 requires "no hidden AI". This is a
 * documented limitation: a free-text answer's literal wording is
 * checked, not its meaning. See docs/IMPROVEMENT_PROPOSALS.md.
 */
function saysYes(text: string): boolean {
  return /\byes\b/i.test(text);
}
function saysNo(text: string): boolean {
  return /\bno\b/i.test(text);
}

/**
 * Computes a v1 usefulness score from an Evidence Item's existing
 * guided-question answers, role, duplicate status, and connections.
 * Pure and deterministic — same input always produces the same output.
 * Formula (documented per spec 08 — every point below is intentional,
 * not tuned/hidden):
 *
 *   +20  commerce link ("offer, sale, shipment, customer, or public
 *        promotion") answered yes
 *   +15  mark visibility answered yes
 *   +15  connected to a real product, answered yes
 *   +15  a real-world date is documented (non-empty answer)
 *   +15  at least one corroborating connection to another item exists
 *   +10  file role is a commerce document (invoice/order/shipping/payment)
 *   +10  a "supports_continuous_use" connection exists
 *
 *   -15  mark visibility explicitly answered no
 *   -15  commerce link explicitly answered no
 *   -10  no real-world date documented at all
 *   -10  exact duplicate of another file with no distinguishing
 *        context (no notes, no answers, no connections)
 *   -10  a design-source file with zero connections to any commerce
 *        record (conceptual-only)
 *
 * Score is clamped to 0-100. Never labels anything legally sufficient
 * (spec 08) — bands are organizational language only.
 */
export function computeUsefulness(input: ScoringInput): UsefulnessResult {
  const positiveFactors: string[] = [];
  const missingElements: string[] = [];
  let score = 0;
  let questionsAnswered = 0;

  const markVisible = answerValue(input.answers, "universal_mark_visible");
  const commerceLink = answerValue(input.answers, "universal_commerce_link");
  const realProduct = answerValue(input.answers, "universal_real_product");
  const realWorldDate = answerValue(input.answers, "universal_real_world_date");

  if (markVisible) questionsAnswered++;
  if (commerceLink) questionsAnswered++;
  if (realProduct) questionsAnswered++;
  if (realWorldDate) questionsAnswered++;

  if (saysYes(commerceLink)) {
    score += 20;
    positiveFactors.push("Connected to an offer, sale, shipment, customer, or public promotion.");
  } else if (saysNo(commerceLink)) {
    score -= 15;
    missingElements.push("Not connected to any commercial use.");
  } else {
    missingElements.push("Commercial-use connection not yet documented.");
  }

  if (saysYes(markVisible)) {
    score += 15;
    positiveFactors.push("The mark is clearly visible.");
  } else if (saysNo(markVisible)) {
    score -= 15;
    missingElements.push("The mark is not clearly visible.");
  } else {
    missingElements.push("Mark visibility not yet documented.");
  }

  if (saysYes(realProduct)) {
    score += 15;
    positiveFactors.push("Connected to a real product.");
  } else {
    missingElements.push("Connection to a real product not yet documented.");
  }

  if (realWorldDate) {
    score += 15;
    positiveFactors.push("A real-world date is documented, not just a filesystem timestamp.");
  } else {
    score -= 10;
    missingElements.push("No real-world date documented — filesystem timestamps alone are not proof of the event date.");
  }

  if (input.connectionTypes.length > 0) {
    score += 15;
    positiveFactors.push("Corroborated by at least one linked piece of evidence.");
  } else {
    missingElements.push("Not yet linked to any corroborating evidence.");
  }

  if (input.fileRole && COMMERCE_DOCUMENT_ROLES.includes(input.fileRole)) {
    score += 10;
    positiveFactors.push("File role indicates a commerce document (invoice, order, shipping, or payment record).");
  }

  if (input.connectionTypes.includes("supports_continuous_use")) {
    score += 10;
    positiveFactors.push("Linked as support for continuous use over time.");
  }

  if (input.hasDuplicates && input.connectionTypes.length === 0 && !input.hasNotes && input.answers.length === 0) {
    score -= 10;
    missingElements.push("This is an exact duplicate of another file with no added context of its own.");
  }

  if (input.fileRole && DESIGN_ROLES.includes(input.fileRole) && input.connectionTypes.length === 0) {
    score -= 10;
    missingElements.push("A design source file not yet connected to any product, export, or order — may be conceptual-only.");
  }

  score = Math.max(0, Math.min(100, score));

  const band: UsefulnessBand =
    questionsAnswered < 2
      ? "Undetermined"
      : score >= 70
        ? "Strong"
        : score >= 45
          ? "Moderate"
          : score >= 20
            ? "Weak"
            : "None";

  return { score, band, positiveFactors, missingElements };
}
