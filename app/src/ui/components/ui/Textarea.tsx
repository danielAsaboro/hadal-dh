import { forwardRef, type TextareaHTMLAttributes } from "react";

import { cn } from "../../lib/cn";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...props },
  ref,
) {
  return <textarea className={cn("ui-textarea", className)} ref={ref} {...props} />;
});
