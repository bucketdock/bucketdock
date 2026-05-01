'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { ShieldCheck, Info, AlertTriangle, X } from 'lucide-react';

type Tone = 'info' | 'security' | 'warning';

interface Props {
  tone?: Tone;
  label?: string;
  children: React.ReactNode;
  className?: string;
}

const toneStyles: Record<Tone, { btn: string; panel: string; Icon: React.ComponentType<{ className?: string }> }> = {
  info: {
    btn: 'text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200',
    panel:
      'border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-700 dark:text-neutral-300',
    Icon: Info,
  },
  security: {
    btn: 'text-emerald-500/70 hover:text-emerald-600 dark:text-emerald-400/70 dark:hover:text-emerald-300',
    panel:
      'border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-200',
    Icon: ShieldCheck,
  },
  warning: {
    btn: 'text-amber-500/80 hover:text-amber-600 dark:text-amber-400/80 dark:hover:text-amber-300',
    panel:
      'border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-200',
    Icon: AlertTriangle,
  },
};

const PANEL_WIDTH = 288;

export function InfoHint({ tone = 'info', label, children, className }: Props) {
  const [open, setOpen] = React.useState(false);
  const [pos, setPos] = React.useState<{ top: number; left: number } | null>(null);
  const btnRef = React.useRef<HTMLButtonElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const styles = toneStyles[tone];
  const { Icon } = styles;

  const updatePosition = React.useCallback(() => {
    if (!btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    const margin = 8;
    let left = rect.left;
    if (left + PANEL_WIDTH + margin > window.innerWidth) {
      left = Math.max(margin, window.innerWidth - PANEL_WIDTH - margin);
    }
    setPos({ top: rect.bottom + 6, left });
  }, []);

  React.useEffect(() => {
    if (!open) return;
    updatePosition();
    function onDocClick(e: MouseEvent) {
      const t = e.target as Node;
      if (
        btnRef.current?.contains(t) ||
        panelRef.current?.contains(t)
      ) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    function onScrollOrResize() { updatePosition(); }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onScrollOrResize);
    window.addEventListener('scroll', onScrollOrResize, true);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onScrollOrResize);
      window.removeEventListener('scroll', onScrollOrResize, true);
    };
  }, [open, updatePosition]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label={label ?? 'More info'}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center justify-center w-4 h-4 rounded-full transition-colors ${styles.btn} ${className ?? ''}`}
      >
        <Icon className="w-3.5 h-3.5" />
      </button>
      {open && pos && typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            style={{ position: 'fixed', top: pos.top, left: pos.left, width: PANEL_WIDTH }}
            className={`z-[100] rounded-md border shadow-xl p-2.5 pr-6 text-[11px] leading-snug ${styles.panel}`}
          >
            <button
              type="button"
              aria-label="Close"
              onClick={() => setOpen(false)}
              className="absolute top-1 right-1 p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10 opacity-60 hover:opacity-100"
            >
              <X className="w-3 h-3" />
            </button>
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}

