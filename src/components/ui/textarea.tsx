import * as React from 'react';
import { cn } from '@/lib/cn';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'no-drag w-full rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-neutral-800 px-3 py-2 text-sm text-foreground placeholder:text-neutral-400 dark:placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-[#007AFF] focus:border-transparent disabled:opacity-50 resize-y min-h-[80px]',
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';
