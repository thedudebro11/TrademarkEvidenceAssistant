import { useState } from "react";
import {
  EVIDENCE_TYPE_CATEGORIES,
  EVIDENCE_TYPE_CATEGORY_LABELS,
  EVIDENCE_TYPE_REGISTRY,
  SUGGESTION_CONFIDENCES,
  getEvidenceType,
  getPreviewKind,
  type DraftEvidenceType,
  type DraftInterviewAnswer,
  type EvidenceItemDetail,
  type OcrExtraction,
  type SuggestionConfidence,
} from "@trademark-evidence-assistant/shared";
import { fetchOcrExtraction } from "./api.js";
import { Button } from "./components/ui/Button.js";
import { Badge } from "./components/ui/Badge.js";
import { StatusMessage } from "./components/ui/StatusMessage.js";
import { CheckCircleIcon } from "./components/ui/icons.js";

interface EvidenceTypePanelProps {
  item: EvidenceItemDetail;
  draftEvidenceType: DraftEvidenceType | null;
  draftAnswers: Record<string, DraftInterviewAnswer>;
  onConfirmType: (typeId: string, source: "suggested" | "user", confidence: SuggestionConfidence | null, reason: string | null) => void;
  onAnswerChange: (questionId: string, patch: Partial<DraftInterviewAnswer>) => void;
}

type OcrState = { status: "idle" } | { status: "loading" } | { status: "error"; message: string } | { status: "done"; result: OcrExtraction };

function looksLikeDateQuestion(id: string, text: string): boolean {
  return /date/i.test(id) || /date/i.test(text);
}
function looksLikeOrderNumberQuestion(id: string, text: string): boolean {
  return /order[_\s]?number/i.test(id) || /order number/i.test(text);
}

/**
 * Fully controlled by the parent Review Draft (ReviewQueue.tsx) — every
 * value a user can edit here (confirmed type, every interview answer)
 * lives in `draftEvidenceType`/`draftAnswers`, not in local component
 * state, so it survives this panel unmounting when the accordion
 * section collapses (Accordion only renders the open section's content
 * — see Accordion.tsx). The only state kept locally is the in-progress,
 * not-yet-confirmed dropdown selection in the manual picker, and the
 * on-demand OCR result — neither is an "entered value," so losing
 * either on remount is fine (re-extracting is one click away).
 */
export function EvidenceTypePanel({ item, draftEvidenceType, draftAnswers, onConfirmType, onAnswerChange }: EvidenceTypePanelProps) {
  const [pickerValue, setPickerValue] = useState("");
  const [ocr, setOcr] = useState<OcrState>({ status: "idle" });
  // Set by the confirmed view's "Change" button — `picking` used to be
  // driven only by `confirmedTypeId === null`, so once a type was
  // confirmed, clicking "Change" (which only ever set `pickerValue`) had
  // no way to bring the picker UI back at all.
  const [isChangingType, setIsChangingType] = useState(false);

  const confirmedTypeId = draftEvidenceType?.typeId ?? item.evidenceType?.typeId ?? null;
  const confirmedType = confirmedTypeId ? getEvidenceType(confirmedTypeId) : null;
  const picking = confirmedTypeId === null || isChangingType;
  const isImage = getPreviewKind(item.extension) === "image";

  function handleConfirmSuggestion() {
    if (!item.evidenceTypeSuggestion) return;
    onConfirmType(
      item.evidenceTypeSuggestion.typeId,
      "suggested",
      item.evidenceTypeSuggestion.confidence,
      item.evidenceTypeSuggestion.reasons.join("; "),
    );
  }

  function handleConfirmPicked() {
    if (!pickerValue) return;
    onConfirmType(pickerValue, "user", null, null);
    setPickerValue("");
    setIsChangingType(false);
  }

  async function handleExtractText() {
    setOcr({ status: "loading" });
    try {
      const result = await fetchOcrExtraction(item.id);
      setOcr({ status: "done", result });
    } catch (err) {
      setOcr({ status: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  if (picking) {
    return (
      <div aria-label="Identify this evidence" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {item.evidenceTypeSuggestion && (
          <div className="evidence-type-suggestion">
            <p>
              We think this is a <strong>{getEvidenceType(item.evidenceTypeSuggestion.typeId)?.displayName ?? item.evidenceTypeSuggestion.typeId}</strong>.{" "}
              <Badge tone="info">{item.evidenceTypeSuggestion.confidence} confidence</Badge>
            </p>
            <ul>
              {item.evidenceTypeSuggestion.reasons.map((reason) => (
                <li key={reason}>
                  <small>{reason}</small>
                </li>
              ))}
            </ul>
            <div style={{ display: "flex", gap: 10 }}>
              <Button variant="primary" icon={<CheckCircleIcon size={18} />} onClick={handleConfirmSuggestion}>
                Confirm
              </Button>
              <Button variant="secondary" onClick={() => setPickerValue(item.evidenceTypeSuggestion!.typeId)}>
                Change
              </Button>
            </div>
          </div>
        )}

        <div>
          <label htmlFor="evidence-type-picker">Or choose the evidence type directly</label>
          <select id="evidence-type-picker" value={pickerValue} onChange={(e) => setPickerValue(e.target.value)}>
            <option value="">Select an evidence type…</option>
            {EVIDENCE_TYPE_CATEGORIES.map((category) => (
              <optgroup key={category} label={EVIDENCE_TYPE_CATEGORY_LABELS[category]}>
                {EVIDENCE_TYPE_REGISTRY.filter((t) => t.category === category).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.displayName}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <Button variant="primary" onClick={handleConfirmPicked} disabled={!pickerValue}>
            Confirm Evidence Type
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div aria-label="Identified evidence type" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Badge tone="success">{confirmedType?.displayName ?? confirmedTypeId}</Badge>
        <Button
          variant="tertiary"
          onClick={() => {
            setPickerValue(confirmedTypeId ?? "");
            setIsChangingType(true);
          }}
        >
          Change
        </Button>
      </div>

      {confirmedType && confirmedType.suggestedConnections.length > 0 && (
        <p className="evidence-type-related">
          <small>
            Typically related to:{" "}
            {confirmedType.suggestedConnections.map((id) => getEvidenceType(id)?.displayName ?? id).join(", ")}
          </small>
        </p>
      )}

      {isImage && confirmedType && (
        <div className="evidence-type-ocr">
          {ocr.status !== "loading" && (
            <Button variant="tertiary" onClick={() => void handleExtractText()}>
              Extract Text From This Image
            </Button>
          )}
          {ocr.status === "loading" && (
            <StatusMessage tone="info">Reading text from the image… this can take a few seconds.</StatusMessage>
          )}
          {ocr.status === "error" && <StatusMessage tone="error">Could not extract text: {ocr.message}</StatusMessage>}
          {ocr.status === "done" && (
            <div className="evidence-type-ocr__result">
              <p>
                <small>
                  Extracted {ocr.result.dateCandidates.length} date{ocr.result.dateCandidates.length === 1 ? "" : "s"} and{" "}
                  {ocr.result.orderNumberCandidates.length} order number{ocr.result.orderNumberCandidates.length === 1 ? "" : "s"} —
                  click any question below labeled "Fill from image" to use one. Nothing is filled in automatically.
                </small>
              </p>
              <details>
                <summary>Show all extracted text</summary>
                <pre className="evidence-type-ocr__raw">{ocr.result.rawText || "(no text detected)"}</pre>
              </details>
            </div>
          )}
        </div>
      )}

      {confirmedType && confirmedType.interview.length > 0 && (
        <ul>
          {confirmedType.interview.map((q) => (
            <InterviewQuestionRow
              key={q.id}
              questionId={q.id}
              text={q.text}
              reason={q.reason}
              placeholder={q.placeholder}
              answer={draftAnswers[q.id] ?? item.answers.find((a) => a.questionId === q.id) ?? null}
              onChange={(patch) => onAnswerChange(q.id, patch)}
              ocrCandidates={
                ocr.status === "done"
                  ? looksLikeDateQuestion(q.id, q.text)
                    ? ocr.result.dateCandidates
                    : looksLikeOrderNumberQuestion(q.id, q.text)
                      ? ocr.result.orderNumberCandidates
                      : []
                  : []
              }
            />
          ))}
        </ul>
      )}
    </div>
  );
}

interface InterviewQuestionRowProps {
  questionId: string;
  text: string;
  reason: string;
  /** Example answer text shown as the input's placeholder — "answer expectations" per docs/DESIGN_LANGUAGE.md. */
  placeholder?: string;
  answer: { value: string; confidence: SuggestionConfidence | null; note: string | null } | null;
  onChange: (patch: Partial<DraftInterviewAnswer>) => void;
  /** Extracted values worth offering for this specific question, e.g. dates for a "date" question. Empty unless OCR has run and this question looks date/order-number-related. */
  ocrCandidates: string[];
}

function InterviewQuestionRow({ text, reason, placeholder, answer, onChange, ocrCandidates }: InterviewQuestionRowProps) {
  const value = answer?.value ?? "";
  const confidence = answer?.confidence ?? "";
  const note = answer?.note ?? "";

  return (
    <li>
      <p>{text}</p>
      <p>
        <small>{reason}</small>
      </p>
      <input aria-label={text} placeholder={placeholder} value={value} onChange={(e) => onChange({ value: e.target.value })} />
      {ocrCandidates.length > 0 && (
        <div className="evidence-type-ocr__candidates">
          <small>Fill from image:</small>
          {ocrCandidates.map((candidate) => (
            <button key={candidate} type="button" onClick={() => onChange({ value: candidate })}>
              {candidate}
            </button>
          ))}
        </div>
      )}
      <select
        aria-label={`${text} confidence`}
        value={confidence}
        onChange={(e) => onChange({ confidence: (e.target.value || null) as SuggestionConfidence | null })}
      >
        <option value="">Confidence: not set</option>
        {SUGGESTION_CONFIDENCES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <input
        aria-label={`${text} note`}
        placeholder="Optional note"
        value={note}
        onChange={(e) => onChange({ note: e.target.value || null })}
      />
    </li>
  );
}
