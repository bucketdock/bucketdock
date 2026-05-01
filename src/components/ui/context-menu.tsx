'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/cn';

export interface ContextMenuItem {
  label: string;
  icon?: React.ReactNode;
  shortcut?: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}

interface Position { x: number; y: number }

export interface ContextMenuProps {
  position: Position | null;
  items: ContextMenuItem[];
  onClose: () => void;
}

export function ContextMenu({ position, items, onClose }: ContextMenuProps) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  React.useEffect(() => {
    if (!position) return;
    function onDocDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [position, onClose]);

  if (!position || !mounted) return null;

  // Clamp into viewport
  const MENU_W = 200;
  const MENU_H = items.length * 32 + 8;
  const left = Math.min(position.x, window.innerWidth - MENU_W - 8);
  const top = Math.min(position.y, window.innerHeight - MENU_H - 8);

  return createPortal(
    <div
      ref={ref}
      className="fixed z-[200] min-w-[180px] rounded-xl bg-white/95 dark:bg-neutral-800/95 backdrop-blur-xl shadow-xl border border-black/10 dark:border-white/10 py-1 overflow-hidden"
      style={{ left, top }}
    >
      {items.map((item, i) => (
        <button
          key={i}
          type="button"
          disabled={item.disabled}
          onClick={() => { item.onClick(); onClose(); }}
          className={cn(
            'w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-left hover:bg-black/6 dark:hover:bg-white/8 disabled:opacity-40 disabled:cursor-not-allowed transition-colors',
            item.danger && 'text-red-600 dark:text-red-400',
          )}
        >
          {item.icon && <span className="w-4 h-4 flex items-center justify-center shrink-0">{item.icon}</span>}
          <span className="flex-1">{item.label}</span>
          {item.shortcut && (
            <span className="text-xs text-neutral-400 dark:text-neutral-500">{item.shortcut}</span>
          )}
        </button>
      ))}
    </div>,
    document.body,
  );
}
