import type { ReactNode } from "react";
import { AlertIcon, CheckCircleIcon, InfoIcon } from "./icons.js";

interface StatusMessageProps {
  tone: "info" | "success" | "warning" | "error";
  children: ReactNode;
}

const ICONS: Record<StatusMessageProps["tone"], ReactNode> = {
  info: <InfoIcon size={18} />,
  success: <CheckCircleIcon size={18} />,
  warning: <AlertIcon size={18} />,
  error: <AlertIcon size={18} />,
};

/**
 * Errors use alert roles without exposing stack traces; everything else
 * is a polite status region (docs/ui/UI_RESPONSIVE_ACCESSIBILITY.md).
 */
export function StatusMessage({ tone, children }: StatusMessageProps) {
  return (
    <div className={`status-message status-message--${tone}`} role={tone === "error" ? "alert" : "status"}>
      {ICONS[tone]}
      <span>{children}</span>
    </div>
  );
}
