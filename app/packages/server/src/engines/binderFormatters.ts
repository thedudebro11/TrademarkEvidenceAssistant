import type { BinderDocument } from "./binderEngine.js";

/** Renders a BinderDocument to Markdown. Pure — no I/O. */
export function toMarkdown(doc: BinderDocument): string {
  const lines: string[] = [];
  lines.push(`# Trademark Evidence Binder — ${doc.workspaceName}`);
  lines.push(`Generated: ${doc.generatedAt}`);
  lines.push("");
  lines.push("## Disclaimer");
  lines.push(doc.disclaimer);
  lines.push("");
  lines.push("## Executive Summary");
  doc.executiveSummary.forEach((s) => lines.push(`- ${s}`));
  lines.push("");
  lines.push("## Timeline");
  doc.timeline.forEach((t) => lines.push(`- **${t.exhibitRef}**: ${t.statement}`));
  lines.push("");
  lines.push("## Earliest Evidence");
  doc.earliestEvidence.forEach((s) => lines.push(`- ${s}`));
  lines.push("");
  lines.push("## Public Promotion");
  (doc.publicPromotion.length ? doc.publicPromotion : ["No related evidence has been linked yet."]).forEach((s) =>
    lines.push(`- ${s}`),
  );
  lines.push("");
  lines.push("## Customer Evidence");
  (doc.customerEvidence.length ? doc.customerEvidence : ["No related evidence has been linked yet."]).forEach((s) =>
    lines.push(`- ${s}`),
  );
  lines.push("");
  lines.push("## Continuous Use");
  doc.continuousUse.forEach((s) => lines.push(`- ${s}`));
  lines.push("");
  lines.push("## Gaps");
  (doc.gaps.length ? doc.gaps : ["No gaps identified in the included evidence."]).forEach((s) => lines.push(`- ${s}`));
  lines.push("");
  lines.push("## Follow-Up");
  doc.followUp.forEach((s) => lines.push(`- ${s}`));
  lines.push("");
  lines.push("## Exhibits");
  doc.exhibits.forEach((e) => {
    lines.push(
      `- **Exhibit ${e.exhibitNumber}** (${e.originalFilename}) — ${e.description} Role: ${e.fileRole ?? "not assigned"}. Usefulness: ${e.usefulnessBand} (${e.usefulnessScore}/100). Location: ${e.exportRelativePath}`,
    );
  });
  lines.push("");
  lines.push("## Hash Index");
  doc.hashIndex.forEach((h) => lines.push(`- ${h.exhibitRef}: \`${h.sha256}\``));
  lines.push("");
  return lines.join("\n");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Renders a BinderDocument to print-ready HTML. Pure — no I/O. */
export function toHtml(doc: BinderDocument): string {
  const section = (title: string, items: string[]) =>
    `<h2>${escapeHtml(title)}</h2><ul>${
      (items.length ? items : ["No related evidence has been linked yet."])
        .map((s) => `<li>${escapeHtml(s)}</li>`)
        .join("")
    }</ul>`;

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Trademark Evidence Binder — ${escapeHtml(doc.workspaceName)}</title></head>
<body>
<h1>Trademark Evidence Binder — ${escapeHtml(doc.workspaceName)}</h1>
<p>Generated: ${escapeHtml(doc.generatedAt)}</p>
<h2>Disclaimer</h2>
<p>${escapeHtml(doc.disclaimer)}</p>
${section("Executive Summary", doc.executiveSummary)}
<h2>Timeline</h2>
<ul>${doc.timeline.map((t) => `<li><strong>${escapeHtml(t.exhibitRef)}</strong>: ${escapeHtml(t.statement)}</li>`).join("")}</ul>
${section("Earliest Evidence", doc.earliestEvidence)}
${section("Public Promotion", doc.publicPromotion)}
${section("Customer Evidence", doc.customerEvidence)}
${section("Continuous Use", doc.continuousUse)}
${section("Gaps", doc.gaps)}
${section("Follow-Up", doc.followUp)}
<h2>Exhibits</h2>
<table border="1" cellpadding="4">
<tr><th>Exhibit</th><th>Filename</th><th>Description</th><th>Role</th><th>Usefulness</th><th>Location</th></tr>
${doc.exhibits
  .map(
    (e) =>
      `<tr><td>${e.exhibitNumber}</td><td>${escapeHtml(e.originalFilename)}</td><td>${escapeHtml(e.description)}</td><td>${escapeHtml(e.fileRole ?? "not assigned")}</td><td>${escapeHtml(e.usefulnessBand)} (${e.usefulnessScore}/100)</td><td>${escapeHtml(e.exportRelativePath)}</td></tr>`,
  )
  .join("")}
</table>
<h2>Hash Index</h2>
<ul>${doc.hashIndex.map((h) => `<li>${escapeHtml(h.exhibitRef)}: <code>${escapeHtml(h.sha256)}</code></li>`).join("")}</ul>
</body></html>`;
}

/** Renders a BinderDocument to JSON. Pure — no I/O. */
export function toJson(doc: BinderDocument): string {
  return JSON.stringify(doc, null, 2);
}

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Renders the exhibit list to CSV (the "exhibit index" spec 10 asks for). Pure — no I/O. */
export function toExhibitCsv(doc: BinderDocument): string {
  const header = "Exhibit,Original Filename,Description,Role,Usefulness Band,Usefulness Score,Location,SHA-256";
  const rows = doc.exhibits.map((e) =>
    [
      String(e.exhibitNumber),
      csvEscape(e.originalFilename),
      csvEscape(e.description),
      csvEscape(e.fileRole ?? "not assigned"),
      e.usefulnessBand,
      String(e.usefulnessScore),
      csvEscape(e.exportRelativePath),
      e.sha256,
    ].join(","),
  );
  return [header, ...rows].join("\n");
}
