import * as React from 'react';
import { cn } from '@/lib/cn';

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        'no-drag w-full rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-neutral-800 px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[#007AFF] focus:border-transparent disabled:opacity-50 appearance-none cursor-pointer',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  ),
);
Select.displayName = 'Select';
