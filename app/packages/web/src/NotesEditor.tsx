import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { saveItemNotes } from "./api.js";

const AUTOSAVE_DEBOUNCE_MS = 800;

interface NotesEditorProps {
  itemId: string;
  initialNotes: string | null;
}

export interface NotesEditorHandle {
  /** Immediately saves any pending edit. Call before navigating away. */
  flush: () => Promise<void>;
}

type SaveState = "idle" | "pending" | "saving" | "saved" | "error";

/**
 * Presentation + a small amount of local debounce timing — no review
 * business logic here (the decision of what "notes" means to the
 * review workflow lives in ReviewService). Visible save-state indicator
 * per docs/DESIGN_LANGUAGE.md "autosave visibility".
 */
export const NotesEditor = forwardRef<NotesEditorHandle, NotesEditorProps>(function NotesEditor(
  { itemId, initialNotes },
  ref,
) {
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestNotesRef = useRef(notes);

  const saveStateRef = useRef<SaveState>("idle");
  saveStateRef.current = saveState;

  useEffect(() => {
    setNotes(initialNotes ?? "");
    latestNotesRef.current = initialNotes ?? "";
    setSaveState("idle");
  }, [itemId, initialNotes]);

  async function doSave(value: string) {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    setSaveState("saving");
    try {
      await saveItemNotes(itemId, value);
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }

  useImperativeHandle(ref, () => ({
    flush: async () => {
      if (saveStateRef.current === "pending") {
        await doSave(latestNotesRef.current);
      }
    },
  }));

  function handleChange(value: string) {
    setNotes(value);
    latestNotesRef.current = value;
    setSaveState("pending");
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      void doSave(latestNotesRef.current);
    }, AUTOSAVE_DEBOUNCE_MS);
  }

  return (
    <div>
      <label htmlFor={`notes-${itemId}`}>Notes</label>
      <textarea
        id={`notes-${itemId}`}
        value={notes}
        onChange={(e) => handleChange(e.target.value)}
      />
      <p role="status">
        {saveState === "idle" && " "}
        {saveState === "pending" && "Unsaved changes…"}
        {saveState === "saving" && "Saving…"}
        {saveState === "saved" && "Saved"}
        {saveState === "error" && "Could not save — your original files were not affected."}
      </p>
    </div>
  );
});
