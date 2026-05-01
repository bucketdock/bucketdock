'use client';

import * as React from 'react';
import { cn } from '@/lib/cn';

export interface TooltipProps {
  content: string;
  children: React.ReactNode;
  className?: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
}

export function Tooltip({ content, children, className, side = 'top' }: TooltipProps) {
  const [visible, setVisible] = React.useState(false);

  const positionClass = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-1.5',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-1.5',
    left: 'right-full top-1/2 -translate-y-1/2 mr-1.5',
    right: 'left-full top-1/2 -translate-y-1/2 ml-1.5',
  }[side];

  return (
    <span
      className={cn('relative inline-flex', className)}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      {children}
      {visible && (
        <span
          className={cn(
            'absolute z-50 whitespace-nowrap rounded-md bg-neutral-900 dark:bg-neutral-100 px-2 py-1 text-xs text-white dark:text-neutral-900 shadow-lg pointer-events-none',
            positionClass,
          )}
          role="tooltip"
        >
          {content}
        </span>
      )}
    </span>
  );
}
