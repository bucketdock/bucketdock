"use client";

import * as React from "react";
import { ChevronDown, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

export interface UploadSplitButtonProps {
  /** Invoked when the user picks "Files…". */
  onUploadFiles: () => void;
  /** Invoked when the user picks "Folder…". */
  onUploadFolder: () => void;
  /** Disable the whole control (e.g. no bucket selected). */
  disabled?: boolean;
}

/**
 * Primary "Upload" toolbar action — a split button whose dropdown lets the
 * user choose between picking individual files or a whole folder.
 *
 * The component owns its open/close state and outside-click handling so it
 * works correctly anywhere in the layout, including inside containers that
 * render the same JSX twice for measurement (where a shared parent ref
 * would be clobbered by the second render).
 */
export function UploadSplitButton({
  onUploadFiles,
  onUploadFolder,
  disabled,
}: UploadSplitButtonProps) {
  const [open, setOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative shrink-0" ref={containerRef}>
      <Button
        variant="default"
        size="sm"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="upload-button"
      >
        <Upload className="w-3.5 h-3.5" />
        Upload
        <ChevronDown className="w-3 h-3 ml-0.5" />
      </Button>
      {open && (
        <div
          role="menu"
          data-testid="upload-menu"
          className={cn(
            "absolute right-0 top-full mt-1 z-60 min-w-36 rounded-lg",
            "border border-black/10 dark:border-white/10",
            "bg-white dark:bg-neutral-800 shadow-lg py-1",
          )}
        >
          <button
            type="button"
            role="menuitem"
            data-testid="upload-files"
            onClick={() => {
              setOpen(false);
              onUploadFiles();
            }}
            className="w-full text-left px-3 py-1.5 text-[13px] hover:bg-black/5 dark:hover:bg-white/5"
          >
            Files…
          </button>
          <button
            type="button"
            role="menuitem"
            data-testid="upload-folder"
            onClick={() => {
              setOpen(false);
              onUploadFolder();
            }}
            className="w-full text-left px-3 py-1.5 text-[13px] hover:bg-black/5 dark:hover:bg-white/5"
          >
            Folder…
          </button>
        </div>
      )}
    </div>
  );
}
