import type { ReactNode } from "react";
import { Button } from "./Button.js";
import { CloseIcon } from "./icons.js";
import { IconButton } from "./IconButton.js";

export interface ToastProps {
  tone?: "success" | "info" | "warning" | "error";
  message: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss: () => void;
}

/**
 * No toast/snackbar primitive existed in this codebase before Archive
 * Similar — this is deliberately minimal (glass surface, one message,
 * one optional action) rather than a general notification queue/stack,
 * since nothing else in the app needs one yet. `role="status"` (not
 * "alert") since a completed bulk operation is informational, not an
 * urgent interruption; `aria-live="polite"` is implied by `role="status"`.
 *
 * The toast disappearing does not mean the underlying record is gone —
 * the bulk-operation audit row persists regardless of how long this
 * component stays mounted (docs/ADR_0004_ARCHIVE_SIMILAR.md "toast vs.
 * audit history").
 */
export function Toast({ tone = "info", message, actionLabel, onAction, onDismiss }: ToastProps) {
  return (
    <div className={`toast glass-surface glass-surface--strong toast--${tone}`} role="status">
      <p className="toast__message">{message}</p>
      {actionLabel && onAction && (
        <Button variant="tertiary" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
      <IconButton aria-label="Dismiss" icon={<CloseIcon size={16} />} onClick={onDismiss} />
    </div>
  );
}
