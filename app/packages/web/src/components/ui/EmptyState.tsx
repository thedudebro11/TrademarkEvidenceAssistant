import type { ReactNode } from "react";

interface EmptyStateProps {
  icon?: ReactNode;
  message: string;
  action?: ReactNode;
}

/** Guides, doesn't apologize (docs/ui/UI_DESIGN_SYSTEM.md "Empty states"). */
export function EmptyState({ icon, message, action }: EmptyStateProps) {
  return (
    <div className="empty-state">
      {icon && <span className="empty-state__icon">{icon}</span>}
      <p className="empty-state__message">{message}</p>
      {action}
    </div>
  );
}
