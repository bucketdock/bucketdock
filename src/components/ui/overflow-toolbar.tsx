"use client";

import * as React from "react";
import { MoreHorizontal } from "lucide-react";
import { Button } from "./button";
import { cn } from "@/lib/cn";

/**
 * One slot in an OverflowToolbar.
 *
 * `render` is what we paint inline when the slot fits, `menu` is the
 * compact representation we drop into the "…" overflow menu when it
 * doesn't. Both flavors should describe the *same* action; the menu
 * version is intentionally minimal so it doesn't reproduce icons that
 * become noisy in a dense dropdown.
 */
export interface OverflowItem {
  /** Stable React key. */
  key: string;
  /** Inline rendering (typically a `<Button />`). */
  render: () => React.ReactNode;
  /** Dropdown menu fallback. Omit to make the item *never* overflow. */
  menu?: {
    label: string;
    onClick: () => void;
    icon?: React.ReactNode;
    disabled?: boolean;
    danger?: boolean;
  };
  /**
   * Drop priority — items with the *lowest* priority are pushed into the
   * overflow menu first when space runs out. Defaults to 0.
   */
  priority?: number;
}

export interface OverflowToolbarProps {
  items: OverflowItem[];
  className?: string;
  /** Optional className for the inline visible row container. */
  innerClassName?: string;
}

/**
 * Render a horizontal toolbar that *never* wraps onto a second row. As the
 * container shrinks, items are progressively hidden into a "…" dropdown
 * (lowest-priority first, then right-to-left) instead of wrapping. This
 * keeps the chrome looking like a real macOS toolbar even on narrow
 * windows.
 *
 * Implementation notes:
 *  - We render an off-screen "measurement" copy of the row to learn each
 *    item's natural width, then on each container resize we compute the
 *    largest prefix of the (priority-ordered) item list that fits.
 *  - We always reserve room for a 32px overflow trigger so the algorithm
 *    doesn't oscillate when adding/removing the chevron flips the layout.
 *  - The visible row uses `flex-nowrap` and `overflow-hidden` as a belt
 *    on top of the JS measurement: even mid-resize, nothing escapes onto
 *    a second line.
 */
export function OverflowToolbar({
  items,
  className,
  innerClassName,
}: OverflowToolbarProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const measureRef = React.useRef<HTMLDivElement>(null);
  const [hiddenIdxs, setHiddenIdxs] = React.useState<ReadonlySet<number>>(
    () => new Set(),
  );
  const [menuOpen, setMenuOpen] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);

  // Items that would never appear in the overflow menu (no `menu` provided)
  // are pinned to the right of the toolbar and always rendered.
  const overflowable = React.useMemo(
    () => items.filter((it) => it.menu),
    [items],
  );
  const pinned = React.useMemo(() => items.filter((it) => !it.menu), [items]);

  // Order in which overflowable items are *dropped*: lowest priority first,
  // ties broken by right-to-left visual order so the right edge collapses
  // first (matching how Finder collapses its toolbar).
  const dropOrder = React.useMemo(() => {
    return overflowable
      .map((it, idx) => ({ idx, priority: it.priority ?? 0 }))
      .sort(
        (a, b) => a.priority - b.priority || b.idx - a.idx, // tie-break: rightmost first
      )
      .map((x) => x.idx);
  }, [overflowable]);

  const recompute = React.useCallback(() => {
    const container = containerRef.current;
    const measure = measureRef.current;
    if (!container || !measure) return;
    const available = container.clientWidth;

    // Measure pinned items first; they always take their share.
    const pinnedNodes = Array.from(
      measure.querySelectorAll<HTMLElement>("[data-overflow-pinned]"),
    );
    const pinnedWidth = pinnedNodes.reduce((s, n) => s + n.offsetWidth, 0);

    const itemNodes = Array.from(
      measure.querySelectorAll<HTMLElement>("[data-overflow-item]"),
    );
    if (itemNodes.length !== overflowable.length) return;

    const widths = itemNodes.map((n) => n.offsetWidth);

    // Reserve room for the trigger if we'll need it.
    const triggerWidth = 32;

    // Try keeping everything visible first.
    const totalAll = pinnedWidth + widths.reduce((s, w) => s + w, 0);
    if (totalAll <= available) {
      setHiddenIdxs((prev) => (prev.size === 0 ? prev : new Set()));
      return;
    }

    // Otherwise, drop items from the back of `dropOrder` until it fits,
    // accounting for the trigger button.
    const hidden = new Set<number>();
    let used = pinnedWidth + widths.reduce((s, w) => s + w, 0) + triggerWidth;
    for (const idx of dropOrder) {
      if (used <= available) break;
      hidden.add(idx);
      used -= widths[idx];
    }
    setHiddenIdxs((prev) => {
      if (prev.size === hidden.size) {
        let same = true;
        for (const i of hidden) {
          if (!prev.has(i)) {
            same = false;
            break;
          }
        }
        if (same) return prev;
      }
      return hidden;
    });
  }, [overflowable.length, dropOrder]);

  React.useLayoutEffect(() => {
    recompute();
  }, [recompute, items]);

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => recompute());
    ro.observe(container);
    return () => ro.disconnect();
  }, [recompute]);

  // Close the overflow menu on outside click / Escape.
  React.useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const visibleSet = React.useMemo(() => {
    const set = new Set<number>();
    for (let i = 0; i < overflowable.length; i++) {
      if (!hiddenIdxs.has(i)) set.add(i);
    }
    return set;
  }, [hiddenIdxs, overflowable.length]);

  const hiddenItems = overflowable.filter((_, i) => !visibleSet.has(i));

  return (
    <div
      ref={containerRef}
      className={cn("relative flex-1 min-w-0 overflow-hidden", className)}
      data-testid="overflow-toolbar"
    >
      {/* Visible row (single line, never wraps) */}
      <div
        className={cn(
          "flex items-center gap-1.5 flex-nowrap justify-end",
          innerClassName,
        )}
      >
        {overflowable.map((it, i) =>
          visibleSet.has(i) ? (
            <React.Fragment key={it.key}>{it.render()}</React.Fragment>
          ) : null,
        )}
        {hiddenItems.length > 0 && (
          <div className="relative shrink-0" ref={menuRef}>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="More actions"
              title="More actions"
              data-testid="overflow-menu-trigger"
            >
              <MoreHorizontal className="w-4 h-4" />
            </Button>
            {menuOpen && (
              <div
                role="menu"
                className="absolute right-0 top-full mt-1 z-60 min-w-44 rounded-lg border border-black/10 dark:border-white/10 bg-white/95 dark:bg-neutral-800/95 backdrop-blur-xl shadow-lg py-1"
                data-testid="overflow-menu"
              >
                {hiddenItems.map((it) => (
                  <button
                    key={it.key}
                    type="button"
                    role="menuitem"
                    disabled={it.menu?.disabled}
                    onClick={() => {
                      setMenuOpen(false);
                      it.menu?.onClick();
                    }}
                    className={cn(
                      "w-full flex items-center gap-2 text-left px-3 py-1.5 text-[13px] hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-50 disabled:pointer-events-none",
                      it.menu?.danger &&
                        "text-red-600 dark:text-red-400 hover:bg-red-500/10",
                    )}
                  >
                    {it.menu?.icon}
                    <span className="truncate">{it.menu?.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {pinned.map((it) => (
          <React.Fragment key={it.key}>{it.render()}</React.Fragment>
        ))}
      </div>

      {/* Off-screen measurement copy. Mirrors the visible row layout so
          the natural widths we read match what would appear on screen. */}
      <div
        ref={measureRef}
        aria-hidden="true"
        className="absolute -top-[9999px] left-0 flex items-center gap-1.5 flex-nowrap pointer-events-none invisible"
      >
        {overflowable.map((it) => (
          <span data-overflow-item key={`m-${it.key}`}>
            {it.render()}
          </span>
        ))}
        {pinned.map((it) => (
          <span data-overflow-pinned key={`p-${it.key}`}>
            {it.render()}
          </span>
        ))}
      </div>
    </div>
  );
}
