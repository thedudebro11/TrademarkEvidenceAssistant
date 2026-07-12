import type { ReactNode } from "react";

interface FieldProps {
  id: string;
  label: string;
  hint?: string;
  saveState?: ReactNode;
  children: ReactNode;
}

/** Labels are always visible (docs/ui/UI_DESIGN_SYSTEM.md "Inputs") — never placeholder-only. */
export function Field({ id, label, hint, saveState, children }: FieldProps) {
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      {children}
      {hint && <p className="field__hint">{hint}</p>}
      {saveState !== undefined && (
        <p className="field__save-state" role="status">
          {saveState}
        </p>
      )}
    </div>
  );
}
