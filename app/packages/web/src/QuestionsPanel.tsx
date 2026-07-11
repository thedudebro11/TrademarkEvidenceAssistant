import { useEffect, useRef, useState } from "react";
import {
  FILE_ROLES,
  SUGGESTION_CONFIDENCES,
  getQuestionsForRole,
  type EvidenceItemDetail,
  type FileRole,
  type ReviewAnswer,
  type SuggestionConfidence,
} from "@trademark-evidence-assistant/shared";
import { saveAnswer, setItemRole } from "./api.js";

const AUTOSAVE_DEBOUNCE_MS = 800;

interface QuestionsPanelProps {
  item: EvidenceItemDetail;
  onRoleChange: (updated: EvidenceItemDetail) => void;
}

/**
 * Presentation only — role assignment is always a direct user choice in
 * v1 (Phase 0 decision 4: no automatic suggestion exists to confirm or
 * override). Question content lives in the shared question catalog, not
 * here, so server and client can never disagree on what's being asked.
 */
export function QuestionsPanel({ item, onRoleChange }: QuestionsPanelProps) {
  const [roleSaving, setRoleSaving] = useState(false);

  async function handleRoleChange(role: string) {
    if (!role) return;
    setRoleSaving(true);
    try {
      const updated = await setItemRole(item.id, role as FileRole);
      onRoleChange(updated);
    } finally {
      setRoleSaving(false);
    }
  }

  const questions = getQuestionsForRole(item.fileRole);
  const answersByQuestion = new Map(item.answers.map((a) => [a.questionId, a]));

  return (
    <div aria-label="Guided questions">
      <label htmlFor="file-role-select">File role</label>
      <select
        id="file-role-select"
        value={item.fileRole ?? ""}
        onChange={(e) => void handleRoleChange(e.target.value)}
        disabled={roleSaving}
      >
        <option value="">Not yet assigned</option>
        {FILE_ROLES.map((role) => (
          <option key={role} value={role}>
            {role.replace(/_/g, " ")}
          </option>
        ))}
      </select>

      <ul>
        {questions.map((q) => (
          <QuestionRow
            key={`${item.id}:${q.id}`}
            itemId={item.id}
            questionId={q.id}
            text={q.text}
            reason={q.reason}
            existingAnswer={answersByQuestion.get(q.id) ?? null}
          />
        ))}
      </ul>
    </div>
  );
}

type SaveState = "idle" | "pending" | "saving" | "saved" | "error";

interface QuestionRowProps {
  itemId: string;
  questionId: string;
  text: string;
  reason: string;
  existingAnswer: ReviewAnswer | null;
}

function QuestionRow({ itemId, questionId, text, reason, existingAnswer }: QuestionRowProps) {
  const [value, setValue] = useState(existingAnswer?.value ?? "");
  const [confidence, setConfidence] = useState<SuggestionConfidence | "">(existingAnswer?.confidence ?? "");
  const [note, setNote] = useState(existingAnswer?.note ?? "");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setValue(existingAnswer?.value ?? "");
    setConfidence(existingAnswer?.confidence ?? "");
    setNote(existingAnswer?.note ?? "");
    setSaveState("idle");
  }, [itemId, questionId, existingAnswer]);

  async function flush(nextValue: string, nextConfidence: SuggestionConfidence | "", nextNote: string) {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    setSaveState("saving");
    try {
      await saveAnswer(itemId, questionId, nextValue, nextConfidence || null, nextNote || null);
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }

  function scheduleSave(nextValue: string, nextConfidence: SuggestionConfidence | "", nextNote: string) {
    setSaveState("pending");
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      void flush(nextValue, nextConfidence, nextNote);
    }, AUTOSAVE_DEBOUNCE_MS);
  }

  return (
    <li>
      <p>{text}</p>
      <p>
        <small>{reason}</small>
      </p>
      <input
        aria-label={text}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          scheduleSave(e.target.value, confidence, note);
        }}
        onBlur={() => void flush(value, confidence, note)}
      />
      <select
        aria-label={`${text} confidence`}
        value={confidence}
        onChange={(e) => {
          const next = e.target.value as SuggestionConfidence | "";
          setConfidence(next);
          void flush(value, next, note);
        }}
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
        onChange={(e) => {
          setNote(e.target.value);
          scheduleSave(value, confidence, e.target.value);
        }}
        onBlur={() => void flush(value, confidence, note)}
      />
      <span role="status">
        {saveState === "pending" && "Unsaved changes…"}
        {saveState === "saving" && "Saving…"}
        {saveState === "saved" && "Saved"}
        {saveState === "error" && "Could not save"}
      </span>
    </li>
  );
}
