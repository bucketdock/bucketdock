'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/cn';
import { X } from 'lucide-react';
import { Button } from './button';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  className?: string;
}

export function Modal({ open, onClose, title, children, className }: ModalProps) {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || !mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Dialog */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        className={cn(
          'relative z-10 w-full max-w-md rounded-2xl bg-white/95 dark:bg-neutral-900/95 backdrop-blur-xl shadow-2xl border border-black/10 dark:border-white/10 overflow-hidden',
          className,
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-black/8 dark:border-white/8">
          <h2 id="modal-title" className="text-sm font-semibold">{title}</h2>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X className="w-4 h-4" />
          </Button>
        </div>
        {/* Body */}
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
