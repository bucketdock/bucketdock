"use client";

import * as React from "react";
import ConnectionsSidebar from "./connections-sidebar";
import ObjectBrowser from "./object-browser";
import TransferQueue from "./transfer-queue";
import { isTauri, listConnections } from "@/lib/tauri";
import { useAppStore } from "@/store/app-store";

const SIDEBAR_KEY = "bucketdock.sidebarWidth";
const SIDEBAR_MIN = 180;
const SIDEBAR_MAX = 520;
const SIDEBAR_DEFAULT = 260;

export default function AppShell() {
  const setConnections = useAppStore((s) => s.setConnections);
  const [sidebarWidth, setSidebarWidth] = React.useState(SIDEBAR_DEFAULT);
  const [dragging, setDragging] = React.useState(false);

  React.useEffect(() => {
    if (!isTauri()) return;
    listConnections()
      .then(setConnections)
      .catch(() => {
        /* silently ignore */
      });
  }, [setConnections]);

  // Restore persisted width
  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(SIDEBAR_KEY);
      if (raw) {
        const n = parseInt(raw, 10);
        if (Number.isFinite(n))
          setSidebarWidth(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, n)));
      }
    } catch {
      /* ignore */
    }
  }, []);

  // Drag handler
  React.useEffect(() => {
    if (!dragging) return;
    function onMove(e: MouseEvent) {
      const w = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, e.clientX));
      setSidebarWidth(w);
    }
    function onUp() {
      setDragging(false);
      try {
        localStorage.setItem(SIDEBAR_KEY, String(sidebarWidth));
      } catch {
        /* ignore */
      }
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [dragging, sidebarWidth]);

  return (
    <div className="flex flex-col h-full bg-[var(--background)]">
      {/* Titlebar */}
      <div
        className="titlebar-drag flex items-center shrink-0 h-9"
        style={{ paddingLeft: 80 }}
      >
        <span className="no-drag text-xs font-semibold text-neutral-500 dark:text-neutral-400 select-none">
          BucketDock
        </span>
      </div>

      {/* Main pane */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Sidebar */}
        <aside
          style={{ width: sidebarWidth }}
          className="shrink-0 flex flex-col bg-white/60 dark:bg-neutral-900/60 backdrop-blur-xl border-r border-black/10 dark:border-white/10 overflow-y-auto"
        >
          <div data-slot="connections-sidebar">
            <ConnectionsSidebar />
          </div>
        </aside>

        {/* Resize handle */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          onMouseDown={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDoubleClick={() => {
            setSidebarWidth(SIDEBAR_DEFAULT);
            try {
              localStorage.setItem(SIDEBAR_KEY, String(SIDEBAR_DEFAULT));
            } catch {
              /* ignore */
            }
          }}
          className={`relative w-1 shrink-0 cursor-col-resize group ${dragging ? "bg-blue-500/40" : "hover:bg-blue-500/20"}`}
          title="Drag to resize · double-click to reset"
        >
          {/* Wider invisible hit area */}
          <div className="absolute inset-y-0 -left-1 -right-1" />
        </div>

        {/* Content */}
        <main className="flex-1 min-w-0 overflow-hidden">
          <ObjectBrowser />
        </main>
      </div>
      <TransferQueue />
    </div>
  );
}
