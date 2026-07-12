import type { ButtonHTMLAttributes, ReactNode } from "react";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required — icon-only controls must always have an accessible name. */
  "aria-label": string;
  icon: ReactNode;
  pressed?: boolean;
}

export function IconButton({ icon, pressed, className, ...rest }: IconButtonProps) {
  const classes = ["icon-btn", className].filter(Boolean).join(" ");
  return (
    <button className={classes} aria-pressed={pressed} {...rest}>
      {icon}
    </button>
  );
}
