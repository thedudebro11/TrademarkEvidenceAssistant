/**
 * Builds the structured content of an Evidence Binder (spec 10) from
 * already-exported items. Pure — no DB, no filesystem — so citation
 * discipline and factual-language rules can be tested directly against
 * plain data. Formatting to Markdown/HTML/JSON/CSV happens separately in
 * binderFormatters.ts; this module only decides *what to say*.
 *
 * Every sentence here is a fixed template filled with real data, using
 * only spec 10's approved factual verbs (supports, documents, appears
 * to show, user identified as, metadata indicates, connected to) —
 * never generated free text. This is what makes the forbidden-phrase
 * list enforceable: the vocabulary is closed by construction, not
 * merely checked after the fact (though it is also checked — see
 * FORBIDDEN_PHRASES below — as a second line of defense).
 */

export interface BinderItemInput {
  exportRelativePath: string;
  originalFilename: string;
  fileRole: string | null;
  whatIsThisAnswer: string; // universal_what_is_this
  realWorldDateAnswer: string; // universal_real_world_date
  publiclyPostedAnswer: string; // image_publicly_posted
  fsModifiedAt: string | null;
  usefulnessBand: string;
  usefulnessScore: number;
  reviewStatus: string;
  connectionTypes: string[];
  sha256: string;
}

export interface BinderExhibit {
  exhibitNumber: number;
  exportRelativePath: string;
  originalFilename: string;
  fileRole: string | null;
  description: string;
  usefulnessBand: string;
  usefulnessScore: number;
  sha256: string;
}

export interface BinderDocument {
  workspaceName: string;
  generatedAt: string;
  disclaimer: string;
  executiveSummary: string[];
  timeline: { statement: string; exhibitRef: string }[];
  earliestEvidence: string[];
  publicPromotion: string[];
  customerEvidence: string[];
  continuousUse: string[];
  gaps: string[];
  followUp: string[];
  exhibits: BinderExhibit[];
  hashIndex: { exhibitRef: string; sha256: string }[];
}

export const DISCLAIMER =
  "This binder is an organizational aid. It is not legal advice and does not establish or guarantee any trademark right. " +
  "It summarizes evidence the user selected and describes what the evidence appears to show, based on information the user " +
  "provided during review. A qualified attorney should evaluate whether this evidence supports any legal filing.";

/** Phrases that must never appear anywhere in a generated binder (spec 10 + spec 08). */
export const FORBIDDEN_PHRASES = [
  "proves ownership",
  "guarantees registration",
  "legally establishes",
  "conclusive",
  "uspto approved",
  "proves",
  "guarantees",
  "legally sufficient",
];

export function findForbiddenLanguage(text: string): string[] {
  const lower = text.toLowerCase();
  return FORBIDDEN_PHRASES.filter((phrase) => lower.includes(phrase));
}

function exhibitRef(n: number): string {
  return `Exhibit ${n}`;
}

function describeDate(item: BinderItemInput): { statement: string; hasUserDate: boolean } {
  if (item.realWorldDateAnswer) {
    return {
      statement: `the user documented the date as "${item.realWorldDateAnswer}"`,
      hasUserDate: true,
    };
  }
  if (item.fsModifiedAt) {
    return {
      statement: `metadata indicates a filesystem timestamp of ${item.fsModifiedAt} (not proof of the real-world event date)`,
      hasUserDate: false,
    };
  }
  return { statement: "no date information is available", hasUserDate: false };
}

export function generateBinder(
  workspaceName: string,
  items: BinderItemInput[],
  followUpCount: number,
  excludedCount: number,
): BinderDocument {
  const exhibits: BinderExhibit[] = items.map((item, index) => ({
    exhibitNumber: index + 1,
    exportRelativePath: item.exportRelativePath,
    originalFilename: item.originalFilename,
    fileRole: item.fileRole,
    description: item.whatIsThisAnswer || "No description provided by the reviewer.",
    usefulnessBand: item.usefulnessBand,
    usefulnessScore: item.usefulnessScore,
    sha256: item.sha256,
  }));

  const executiveSummary = [
    `This package documents ${items.length} evidence item${items.length === 1 ? "" : "s"} the user selected for inclusion.`,
    `${items.filter((i) => i.usefulnessBand === "Strong").length} item(s) scored Strong, ${items.filter((i) => i.usefulnessBand === "Moderate").length} scored Moderate.`,
    followUpCount > 0
      ? `${followUpCount} additional item(s) are marked Needs Follow-Up and are not included in this package.`
      : "No items are currently marked Needs Follow-Up.",
    `${excludedCount} item(s) were reviewed and archived (not included).`,
  ];

  const timeline = items
    .map((item, index) => {
      const { statement } = describeDate(item);
      return {
        statement: `${item.originalFilename}: ${statement}.`,
        exhibitRef: exhibitRef(index + 1),
      };
    })
    .sort((a, b) => a.statement.localeCompare(b.statement));

  const withUserDates = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => describeDate(item).hasUserDate)
    .sort((a, b) => a.item.realWorldDateAnswer.localeCompare(b.item.realWorldDateAnswer));

  const earliestEvidence =
    withUserDates.length > 0
      ? [
          `${exhibitRef(withUserDates[0].index + 1)} (${withUserDates[0].item.originalFilename}) documents the earliest user-supplied date in this package: "${withUserDates[0].item.realWorldDateAnswer}".`,
        ]
      : ["No item in this package has a user-documented real-world date; the earliest use date is undetermined."];

  const publicPromotion = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => /\byes\b/i.test(item.publiclyPostedAnswer) || item.fileRole === "social_post_export")
    .map(
      ({ item, index }) =>
        `${exhibitRef(index + 1)} (${item.originalFilename}) appears to show a public promotion or social media post.`,
    );

  const customerEvidence = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.fileRole === "customer_photo" || item.fileRole === "message")
    .map(({ item, index }) => `${exhibitRef(index + 1)} (${item.originalFilename}) is connected to a customer.`);

  const continuousUseItems = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.connectionTypes.includes("supports_continuous_use"));
  const continuousUse =
    continuousUseItems.length > 0
      ? continuousUseItems.map(
          ({ item, index }) => `${exhibitRef(index + 1)} (${item.originalFilename}) supports continuous use over time.`,
        )
      : ["No items in this package are linked as support for continuous use."];

  const gaps = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => !item.realWorldDateAnswer || !item.fileRole)
    .map(({ item, index }) => {
      const missing: string[] = [];
      if (!item.realWorldDateAnswer) missing.push("a documented real-world date");
      if (!item.fileRole) missing.push("an assigned file role");
      return `${exhibitRef(index + 1)} (${item.originalFilename}) is missing ${missing.join(" and ")}.`;
    });

  const followUp =
    followUpCount > 0
      ? [`${followUpCount} evidence item(s) are marked Needs Follow-Up and were not included in this export.`]
      : ["No items are currently marked Needs Follow-Up."];

  return {
    workspaceName,
    generatedAt: new Date().toISOString(),
    disclaimer: DISCLAIMER,
    executiveSummary,
    timeline,
    earliestEvidence,
    publicPromotion,
    customerEvidence,
    continuousUse,
    gaps,
    followUp,
    exhibits,
    hashIndex: exhibits.map((e) => ({ exhibitRef: exhibitRef(e.exhibitNumber), sha256: e.sha256 })),
  };
}
