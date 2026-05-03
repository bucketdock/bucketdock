import * as React from "react";
import { cn } from "@/lib/cn";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    {
      className,
      type,
      autoComplete,
      autoCorrect,
      autoCapitalize,
      spellCheck,
      ...props
    },
    ref,
  ) => {
    // For non-text fields like email/url/search/tel/password the WKWebView
    // autocorrect/autocapitalize popovers are actively unhelpful (they mangle
    // file names, S3 keys, AWS access keys, etc.). Default them off, but
    // still let callers opt back in via the prop.
    const isTextLike = !type || type === "text" || type === "search";
    return (
      <input
        ref={ref}
        type={type}
        autoComplete={autoComplete ?? (isTextLike ? "off" : autoComplete)}
        autoCorrect={autoCorrect ?? "off"}
        autoCapitalize={autoCapitalize ?? "off"}
        spellCheck={spellCheck ?? false}
        className={cn(
          "no-drag w-full rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-neutral-800 px-3 py-1.5 text-sm text-foreground placeholder:text-neutral-400 dark:placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-[#007AFF] focus:border-transparent disabled:opacity-50",
          className,
        )}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";
