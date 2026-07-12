import type { ButtonHTMLAttributes, ReactNode } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "tertiary" | "destructive";
  fullWidth?: boolean;
  icon?: ReactNode;
}

export function Button({ variant = "secondary", fullWidth, icon, className, children, ...rest }: ButtonProps) {
  const classes = ["btn", `btn--${variant}`, fullWidth ? "btn--full" : "", className].filter(Boolean).join(" ");
  return (
    <button className={classes} {...rest}>
      {icon}
      {children}
    </button>
  );
}
