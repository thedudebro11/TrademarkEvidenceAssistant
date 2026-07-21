interface NotesEditorProps {
  itemId: string;
  value: string;
  onChange: (value: string) => void;
}

/**
 * Fully controlled — notes live in the parent Review Draft
 * (ReviewQueue.tsx), not here. No independent autosave/debounce: the
 * whole draft (including notes) is only persisted by the atomic
 * Save & Next / decision flow. The item-level "Unsaved changes"/"Saved"
 * indicator ReviewQueue shows above the accordion covers this field too
 * — there is deliberately no second, per-field indicator here, to avoid
 * the "conflicting save paths" this change was asked to eliminate.
 */
export function NotesEditor({ itemId, value, onChange }: NotesEditorProps) {
  return (
    <div>
      <label htmlFor={`notes-${itemId}`}>Notes</label>
      <textarea id={`notes-${itemId}`} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
