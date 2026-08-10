import { forwardRef, type InputHTMLAttributes } from "react";

import { cn } from "../../lib/cn";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return <input className={cn("ui-input", className)} ref={ref} {...props} />;
});
