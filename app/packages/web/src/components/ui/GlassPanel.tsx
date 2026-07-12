import type { HTMLAttributes, ReactNode } from "react";

interface GlassPanelProps extends HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "strong" | "subtle";
  floating?: boolean;
  children?: ReactNode;
  as?: "div" | "aside" | "nav" | "header";
}

/** Reserved for sidebar, hero, contextual cards, decision dock, dialogs — never more than two nested. */
export function GlassPanel({ variant = "default", floating, className, children, as: As = "div", ...rest }: GlassPanelProps) {
  const classes = [
    "glass-surface",
    variant !== "default" ? `glass-surface--${variant}` : "",
    floating ? "glass-surface--floating" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <As className={classes} {...rest}>
      {children}
    </As>
  );
}
