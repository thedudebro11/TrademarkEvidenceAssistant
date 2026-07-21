import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "tertiary" | "destructive";
  fullWidth?: boolean;
  icon?: ReactNode;
}

/** forwardRef so callers can attach a ref (e.g. for focus management after closing a dialog opened from this button) without losing the `btn` styling. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", fullWidth, icon, className, children, ...rest },
  ref,
) {
  const classes = ["btn", `btn--${variant}`, fullWidth ? "btn--full" : "", className].filter(Boolean).join(" ");
  return (
    <button ref={ref} className={classes} {...rest}>
      {icon}
      {children}
    </button>
  );
});
