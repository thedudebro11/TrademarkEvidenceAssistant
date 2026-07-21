import { useEffect, useState } from "react";
import type { AnalysisResultResponse, ConfirmAnalysisRequest, EvidenceSuggestionView } from "@trademark-evidence-assistant/shared";
import { getEvidenceType } from "@trademark-evidence-assistant/shared";
import { analyzeEvidenceItem, confirmAnalysisSuggestions, fetchLatestAnalysis } from "../../api.js";
import { Badge } from "../ui/Badge.js";
import { Button } from "../ui/Button.js";
import { StatusMessage } from "../ui/StatusMessage.js";

interface AnalysisPanelProps {
  evidenceItemId: string;
  /** Called after a successful confirm — the caller (ReviewQueue) reloads the item's confirmed review state, since analysis and manual review share the same underlying evidence_items/review_answers/connections data. */
  onConfirmed?: () => void;
}

type AnswerDecision = "unset" | "accept" | "edit" | "reject";
type ConnectionDecision = "unset" | "accept" | "reject";

function confidenceTone(confidence: string): "info" | "success" | "warning" | "danger" | "neutral" {
  return confidence === "high" ? "success" : confidence === "medium" ? "info" : "neutral";
}

function typeLabel(typeId: string): string {
  return getEvidenceType(typeId)?.displayName ?? typeId;
}

/**
 * Evidence Intelligence Phase 1 — the current-item "Analyze Evidence"
 * flow, replacing the old empty AI Analysis placeholder. Every value
 * shown here is a *suggestion* until this component's own explicit
 * "Save Accepted" action sends exactly what the user accepted/edited to
 * `POST .../analysis/confirm` — nothing is ever saved automatically,
 * and nothing here calls the manual review save path directly (that
 * happens server-side, inside analysisService.ts's confirmation
 * transaction, only for fields the user actually accepted).
 */
export function AnalysisPanel({ evidenceItemId, onConfirmed }: AnalysisPanelProps) {
  const [analysis, setAnalysis] = useState<AnalysisResultResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typeDecisionId, setTypeDecisionId] = useState<number | null>(null);
  const [answerDecisions, setAnswerDecisions] = useState<Record<number, AnswerDecision>>({});
  const [answerEdits, setAnswerEdits] = useState<Record<number, string>>({});
  const [connectionDecisions, setConnectionDecisions] = useState<Record<number, ConnectionDecision>>({});
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  /** Guards against a malformed/unexpected response ever reaching render — a response missing the shape this component actually needs is treated as "no analysis available" rather than crashing the whole Review page. */
  function isValidAnalysisResult(value: unknown): value is AnalysisResultResponse {
    if (!value || typeof value !== "object") return false;
    const v = value as Partial<AnalysisResultResponse>;
    return Boolean(v.run) && Boolean(v.summary) && Array.isArray(v.evidenceTypeSuggestions) && Array.isArray(v.answerSuggestions) && Array.isArray(v.entities) && Array.isArray(v.dates) && Array.isArray(v.connectionSuggestions);
  }

  function resetDecisions() {
    setTypeDecisionId(null);
    setAnswerDecisions({});
    setAnswerEdits({});
    setConnectionDecisions({});
    setSaveMessage(null);
  }

  useEffect(() => {
    let cancelled = false;
    resetDecisions();
    fetchLatestAnalysis(evidenceItemId)
      .then((result) => {
        if (!cancelled) setAnalysis(isValidAnalysisResult(result) ? result : null);
      })
      .catch(() => {
        if (!cancelled) setAnalysis(null);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evidenceItemId]);

  async function handleAnalyze() {
    setLoading(true);
    setError(null);
    try {
      const result = await analyzeEvidenceItem(evidenceItemId);
      if (!isValidAnalysisResult(result)) throw new Error("The server returned an unexpected response");
      setAnalysis(result);
      resetDecisions();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!analysis) return;
    setSaving(true);
    setSaveMessage(null);
    try {
      const acceptedAnswers = analysis.answerSuggestions
        .filter((s) => answerDecisions[s.id] === "accept" || answerDecisions[s.id] === "edit")
        .map((s) => ({ suggestionId: s.id, value: answerDecisions[s.id] === "edit" ? (answerEdits[s.id] ?? s.proposedValue) : s.proposedValue }));
      const rejectedSuggestionIds = analysis.answerSuggestions.filter((s) => answerDecisions[s.id] === "reject").map((s) => s.id);
      const acceptedConnectionSuggestionIds = analysis.connectionSuggestions.filter((c) => connectionDecisions[c.id] === "accept").map((c) => c.id);
      const rejectedConnectionSuggestionIds = analysis.connectionSuggestions.filter((c) => connectionDecisions[c.id] === "reject").map((c) => c.id);

      const request: ConfirmAnalysisRequest = {
        analysisRunId: analysis.run.id,
        acceptedEvidenceTypeSuggestionId: typeDecisionId,
        acceptedAnswers,
        rejectedSuggestionIds,
        acceptedConnectionSuggestionIds,
        rejectedConnectionSuggestionIds,
      };
      const result = await confirmAnalysisSuggestions(evidenceItemId, request);
      setSaveMessage(
        `Saved: ${result.acceptedEvidenceType ? "1 evidence type, " : ""}${result.acceptedAnswerCount} answer${result.acceptedAnswerCount === 1 ? "" : "s"}, ${result.acceptedConnectionCount} connection${result.acceptedConnectionCount === 1 ? "" : "s"} accepted.`,
      );
      // Refresh from the server so accepted suggestions now show as 'accepted' and unaccepted ones remain staged.
      const refreshed = await fetchLatestAnalysis(evidenceItemId);
      setAnalysis(isValidAnalysisResult(refreshed) ? refreshed : null);
      resetDecisions();
      onConfirmed?.();
    } catch (err) {
      setSaveMessage(`Could not save: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  }

  const hasAnyDecision =
    typeDecisionId !== null ||
    Object.values(answerDecisions).some((d) => d !== "unset") ||
    Object.values(connectionDecisions).some((d) => d !== "unset");

  return (
    <details className="evidence-viewer__ai-section" open={Boolean(analysis)}>
      <summary>Evidence Intelligence</summary>
      <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Button variant="secondary" onClick={() => void handleAnalyze()} disabled={loading}>
            {loading ? "Analyzing…" : analysis ? "Re-Analyze Evidence" : "Analyze Evidence"}
          </Button>
          {analysis && !analysis.providerAvailable && <small>No AI provider is configured — showing deterministic results only.</small>}
        </div>

        {error && <StatusMessage tone="error">Could not analyze this item. {error}</StatusMessage>}

        {analysis && (
          <>
            <p role="status">
              Analysis ready: {analysis.summary.answerCount} answer{analysis.summary.answerCount === 1 ? "" : "s"}, {analysis.summary.dateCount} date{analysis.summary.dateCount === 1 ? "" : "s"},{" "}
              {analysis.summary.identifierCount} identifier{analysis.summary.identifierCount === 1 ? "" : "s"}, and {analysis.summary.connectionCount} connection{analysis.summary.connectionCount === 1 ? "" : "s"} suggested.
              {analysis.run.stale && (
                <>
                  {" "}
                  <Badge tone="warning">Stale — re-analyze</Badge>
                </>
              )}
            </p>

            <IdentifySection analysis={analysis} typeDecisionId={typeDecisionId} onSelectType={setTypeDecisionId} />

            <AnswersSection
              suggestions={analysis.answerSuggestions}
              decisions={answerDecisions}
              edits={answerEdits}
              onDecide={(id, d) => setAnswerDecisions((prev) => ({ ...prev, [id]: d }))}
              onEdit={(id, v) => setAnswerEdits((prev) => ({ ...prev, [id]: v }))}
            />

            <DatesAndEntitiesSection analysis={analysis} />

            <ConnectSection connections={analysis.connectionSuggestions} decisions={connectionDecisions} onDecide={(id, d) => setConnectionDecisions((prev) => ({ ...prev, [id]: d }))} />

            {saveMessage && <StatusMessage tone={saveMessage.startsWith("Could not") ? "error" : "success"}>{saveMessage}</StatusMessage>}

            <div>
              <Button variant="primary" onClick={() => void handleSave()} disabled={!hasAnyDecision || saving}>
                {saving ? "Saving…" : "Save Accepted Suggestions"}
              </Button>
            </div>
          </>
        )}
      </div>
    </details>
  );
}

function IdentifySection({ analysis, typeDecisionId, onSelectType }: { analysis: AnalysisResultResponse; typeDecisionId: number | null; onSelectType: (id: number | null) => void }) {
  const candidates = analysis.evidenceTypeSuggestions.filter((s) => s.state !== "superseded" && s.state !== "rejected");
  if (candidates.length === 0) return null;
  return (
    <section aria-label="Identify">
      <h4>Identify</h4>
      <ul style={{ display: "flex", flexDirection: "column", gap: 8, listStyle: "none", padding: 0 }}>
        {candidates.map((c) => (
          <li key={c.id}>
            <label style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
              <input type="radio" name="analysis-evidence-type" checked={typeDecisionId === c.id} onChange={() => onSelectType(c.id)} disabled={c.state === "stale"} />
              <span>
                <strong>{typeLabel(c.proposedValue)}</strong> <Badge tone={confidenceTone(c.confidence)}>{c.confidence}</Badge>
                {c.state === "stale" && <Badge tone="warning">Stale</Badge>}
                <br />
                <small>{c.rationale}</small>
              </span>
            </label>
          </li>
        ))}
      </ul>
      {typeDecisionId !== null && (
        <Button variant="tertiary" onClick={() => onSelectType(null)}>
          Clear selection
        </Button>
      )}
    </section>
  );
}

function AnswersSection({
  suggestions,
  decisions,
  edits,
  onDecide,
  onEdit,
}: {
  suggestions: EvidenceSuggestionView[];
  decisions: Record<number, AnswerDecision>;
  edits: Record<number, string>;
  onDecide: (id: number, decision: AnswerDecision) => void;
  onEdit: (id: number, value: string) => void;
}) {
  const visible = suggestions.filter((s) => s.state !== "superseded" && s.state !== "rejected");
  if (visible.length === 0) return null;
  return (
    <section aria-label="Answer suggestions">
      <h4>Suggested Answers</h4>
      <ul style={{ display: "flex", flexDirection: "column", gap: 10, listStyle: "none", padding: 0 }}>
        {visible.map((s) => {
          const decision = decisions[s.id] ?? "unset";
          const alreadyAccepted = s.state === "accepted" || s.state === "edited";
          return (
            <li key={s.id} style={{ borderBottom: "1px solid var(--border-subtle, #33333340)", paddingBottom: 8 }}>
              <p>
                <strong>{s.fieldId}</strong> {s.state === "unresolved" && <Badge tone="neutral">Unresolved — needs your input</Badge>}
                {s.confidence && <Badge tone={confidenceTone(s.confidence)}>{s.confidence}</Badge>}
                {s.state === "stale" && <Badge tone="warning">Stale</Badge>}
                {alreadyAccepted && <Badge tone="success">Confirmed</Badge>}
              </p>
              {s.proposedValue ? (
                <p>
                  Proposed: <strong>{s.proposedValue}</strong>
                </p>
              ) : (
                <p>
                  <small>No value proposed — this is left for you to answer.</small>
                </p>
              )}
              <p>
                <small>{s.rationale}</small>
              </p>
              {s.sourceLocations.length > 0 && (
                <p>
                  <small>Source: {s.sourceLocations.join(", ")}</small>
                </p>
              )}
              {!alreadyAccepted && s.state !== "stale" && (
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  <Button variant={decision === "accept" ? "primary" : "tertiary"} onClick={() => onDecide(s.id, "accept")} disabled={!s.proposedValue}>
                    Accept
                  </Button>
                  <Button variant={decision === "edit" ? "primary" : "tertiary"} onClick={() => onDecide(s.id, "edit")}>
                    Edit
                  </Button>
                  <Button variant={decision === "reject" ? "primary" : "tertiary"} onClick={() => onDecide(s.id, "reject")}>
                    Reject
                  </Button>
                  <Button variant={decision === "unset" ? "primary" : "tertiary"} onClick={() => onDecide(s.id, "unset")}>
                    Leave unresolved
                  </Button>
                </div>
              )}
              {decision === "edit" && (
                <input aria-label={`Edit answer for ${s.fieldId}`} value={edits[s.id] ?? s.proposedValue} onChange={(e) => onEdit(s.id, e.target.value)} style={{ marginTop: 6, width: "100%" }} />
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function DatesAndEntitiesSection({ analysis }: { analysis: AnalysisResultResponse }) {
  if (analysis.dates.length === 0 && analysis.entities.length === 0) return null;
  return (
    <section aria-label="Dates and identifiers">
      {analysis.dates.length > 0 && (
        <>
          <h4>Dates</h4>
          <dl>
            {analysis.dates.map((d) => (
              <div key={d.id} style={{ display: "contents" }}>
                <dt>
                  {d.sourceType.replace(/_/g, " ")} <Badge tone={confidenceTone(d.confidence)}>{d.confidence}</Badge>
                  {d.conflictState === "conflicts_with_other_assertion" && <Badge tone="warning">Conflicts with another date</Badge>}
                </dt>
                <dd>
                  {d.rawValue} — <small>{d.explanation}</small>
                </dd>
              </div>
            ))}
          </dl>
        </>
      )}
      {analysis.entities.length > 0 && (
        <>
          <h4>Extracted Identifiers</h4>
          <dl>
            {analysis.entities.map((e) => (
              <div key={e.id} style={{ display: "contents" }}>
                <dt>
                  {e.entityType.replace(/_/g, " ")} <Badge tone={confidenceTone(e.confidence)}>{e.confidence}</Badge>
                </dt>
                <dd>
                  {e.rawText} <small>({e.sourceLocation ?? e.extractionMethod})</small>
                </dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </section>
  );
}

function ConnectSection({ connections, decisions, onDecide }: { connections: AnalysisResultResponse["connectionSuggestions"]; decisions: Record<number, ConnectionDecision>; onDecide: (id: number, decision: ConnectionDecision) => void }) {
  const visible = connections.filter((c) => c.state === "proposed" || c.state === "stale");
  if (visible.length === 0) return null;
  return (
    <section aria-label="Connect">
      <h4>Connect</h4>
      <ul style={{ display: "flex", flexDirection: "column", gap: 8, listStyle: "none", padding: 0 }}>
        {visible.map((c) => (
          <li key={c.id}>
            <label style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
              <input type="checkbox" checked={decisions[c.id] === "accept"} onChange={(e) => onDecide(c.id, e.target.checked ? "accept" : "unset")} disabled={c.state === "stale"} />
              <span>
                <strong>{c.targetFilename}</strong> <Badge tone={confidenceTone(c.confidence)}>{c.confidence}</Badge>
                {c.state === "stale" && <Badge tone="warning">Stale</Badge>}
                {c.contradictionWarning && <Badge tone="danger">{c.contradictionWarning}</Badge>}
                <br />
                <small>{c.rationale}</small>
              </span>
            </label>
            {decisions[c.id] !== "accept" && (
              <Button variant="tertiary" onClick={() => onDecide(c.id, "reject")}>
                Reject
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
