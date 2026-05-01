import * as React from 'react';
import { cn } from '@/lib/cn';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'secondary' | 'ghost' | 'destructive';
  size?: 'sm' | 'md' | 'icon';
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'md', ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          'no-drag inline-flex items-center justify-center font-medium rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007AFF] focus-visible:ring-offset-1 disabled:opacity-50 disabled:pointer-events-none',
          {
            // variants
            'bg-[#007AFF] text-white hover:bg-[#0066d6] active:bg-[#0055b3]': variant === 'default',
            'bg-black/8 dark:bg-white/10 text-foreground hover:bg-black/12 dark:hover:bg-white/15 active:bg-black/16': variant === 'secondary',
            'text-foreground hover:bg-black/8 dark:hover:bg-white/10 active:bg-black/12': variant === 'ghost',
            'bg-red-500 text-white hover:bg-red-600 active:bg-red-700': variant === 'destructive',
            // sizes
            'h-7 px-2.5 text-xs gap-1.5': size === 'sm',
            'h-9 px-4 text-sm gap-2': size === 'md',
            'h-8 w-8 p-0': size === 'icon',
          },
          className,
        )}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';
