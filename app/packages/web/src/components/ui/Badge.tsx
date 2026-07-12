import type { ReactNode } from "react";

interface BadgeProps {
  tone?: "info" | "success" | "warning" | "danger" | "neutral";
  icon?: ReactNode;
  children: ReactNode;
}

/** Decisions/status are never communicated by color alone — always pair with a label or icon. */
export function Badge({ tone = "neutral", icon, children }: BadgeProps) {
  return (
    <span className={`badge badge--${tone}`}>
      {icon}
      {children}
    </span>
  );
}
