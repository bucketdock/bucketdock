import * as React from 'react';
import { cn } from '@/lib/cn';

export interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {}

export const Label = React.forwardRef<HTMLLabelElement, LabelProps>(
  ({ className, ...props }, ref) => (
    <label
      ref={ref}
      className={cn('block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1', className)}
      {...props}
    />
  ),
);
Label.displayName = 'Label';
