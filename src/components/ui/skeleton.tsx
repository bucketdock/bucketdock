import * as React from 'react';
import { cn } from '@/lib/cn';

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-black/8 dark:bg-white/8', className)}
      aria-hidden="true"
    />
  );
}
