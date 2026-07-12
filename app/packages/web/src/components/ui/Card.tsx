import type { ReactNode } from "react";

interface CardProps {
  eyebrow?: string;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
  as?: "div" | "section";
  "aria-label"?: string;
}

/** One purpose per card (docs/ui/UI_DESIGN_SYSTEM.md "Cards"). */
export function Card({ eyebrow, title, children, className, as: As = "div", ...rest }: CardProps) {
  return (
    <As className={["card", className].filter(Boolean).join(" ")} {...rest}>
      {eyebrow && <div className="card__eyebrow">{eyebrow}</div>}
      {title && <div className="card__title">{title}</div>}
      {children && <div className="card__body">{children}</div>}
    </As>
  );
}
