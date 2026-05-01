"use client";

import * as React from "react";
import {
  ChevronDown,
  ChevronUp,
  X,
  RotateCw,
  Upload,
  Download,
  ArrowRightLeft,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { useTransfersStore, type Transfer } from "@/store/transfers-store";
import { isTauri, type TransferProgressEvent } from "@/lib/tauri";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function KindIcon({ kind }: { kind: Transfer["kind"] }) {
  if (kind === "upload") return <Upload className="w-3.5 h-3.5" />;
  if (kind === "download") return <Download className="w-3.5 h-3.5" />;
  return <ArrowRightLeft className="w-3.5 h-3.5" />;
}

function StatusIcon({ status }: { status: Transfer["status"] }) {
  if (status === "done")
    return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />;
  if (status === "failed")
    return <AlertCircle className="w-3.5 h-3.5 text-red-500" />;
  if (status === "cancelled")
    return <X className="w-3.5 h-3.5 text-neutral-400" />;
  return <Loader2 className="w-3.5 h-3.5 text-blue-500 animate-spin" />;
}

export default function TransferQueue() {
  const items = useTransfersStore((s) => s.items);
  const open = useTransfersStore((s) => s.open);
  const setOpen = useTransfersStore((s) => s.setOpen);
  const applyProgress = useTransfersStore((s) => s.applyProgress);
  const cancel = useTransfersStore((s) => s.cancel);
  const retry = useTransfersStore((s) => s.retry);
  const remove = useTransfersStore((s) => s.remove);
  const clearFinished = useTransfersStore((s) => s.clearFinished);

  // Subscribe to progress events from the backend.
  React.useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | null = null;
    let mounted = true;
    (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      if (!mounted) return;
      unlisten = await listen<TransferProgressEvent>(
        "transfer://progress",
        (e) => {
          const p = e.payload;
          applyProgress(
            p.id,
            p.loaded,
            p.total,
            p.status,
            p.error ?? undefined,
          );
        },
      );
    })();
    return () => {
      mounted = false;
      unlisten?.();
    };
  }, [applyProgress]);

  if (items.length === 0) return null;

  const running = items.filter(
    (i) => i.status === "running" || i.status === "queued",
  ).length;
  const failed = items.filter((i) => i.status === "failed").length;

  return (
    <div className="fixed bottom-3 right-3 z-50 w-[380px] max-w-[calc(100vw-1.5rem)] rounded-xl border border-black/10 dark:border-white/10 bg-white/95 dark:bg-neutral-900/95 backdrop-blur-xl shadow-2xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2 text-sm border-b border-black/8 dark:border-white/8 hover:bg-black/4 dark:hover:bg-white/5 transition-colors"
      >
        <span className="font-medium flex items-center gap-2">
          Transfers
          <span className="text-xs text-neutral-500">
            {running > 0 ? `${running} running` : `${items.length} total`}
            {failed > 0 && (
              <span className="text-red-500"> · {failed} failed</span>
            )}
          </span>
        </span>
        {open ? (
          <ChevronDown className="w-4 h-4" />
        ) : (
          <ChevronUp className="w-4 h-4" />
        )}
      </button>

      {open && (
        <>
          <div className="max-h-[40vh] overflow-y-auto divide-y divide-black/5 dark:divide-white/5">
            {items.map((t) => {
              const pct =
                t.total > 0
                  ? Math.min(100, Math.round((t.loaded / t.total) * 100))
                  : 0;
              const showBar = t.status === "running" && t.total > 0;
              return (
                <div key={t.id} className="px-3 py-2 text-xs">
                  <div className="flex items-center gap-2">
                    <KindIcon kind={t.kind} />
                    <span className="flex-1 truncate" title={t.name}>
                      {t.name}
                    </span>
                    <StatusIcon status={t.status} />
                    {(t.status === "running" || t.status === "queued") && (
                      <button
                        type="button"
                        onClick={() => cancel(t.id)}
                        className="p-0.5 rounded hover:bg-black/8 dark:hover:bg-white/8"
                        aria-label="Cancel"
                        title="Cancel"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {t.status === "failed" && (
                      <button
                        type="button"
                        onClick={() => retry(t.id)}
                        className="p-0.5 rounded hover:bg-black/8 dark:hover:bg-white/8"
                        aria-label="Retry"
                        title="Retry"
                      >
                        <RotateCw className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {(t.status === "done" ||
                      t.status === "failed" ||
                      t.status === "cancelled") && (
                      <button
                        type="button"
                        onClick={() => remove(t.id)}
                        className="p-0.5 rounded hover:bg-black/8 dark:hover:bg-white/8 text-neutral-500"
                        aria-label="Remove"
                        title="Remove"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  {t.subtitle && (
                    <div
                      className="text-neutral-500 dark:text-neutral-400 truncate pl-5"
                      title={t.subtitle}
                    >
                      {t.subtitle}
                    </div>
                  )}
                  <div className="mt-1 pl-5 flex items-center gap-2 text-neutral-500">
                    {showBar ? (
                      <>
                        <div className="flex-1 h-1 rounded-full bg-black/8 dark:bg-white/10 overflow-hidden">
                          <div
                            className="h-full bg-[#007AFF] transition-[width] duration-150"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="tabular-nums shrink-0">{pct}%</span>
                      </>
                    ) : t.status === "failed" ? (
                      <span className="text-red-500 truncate" title={t.error}>
                        {t.error ?? "Failed"}
                      </span>
                    ) : (
                      <span
                        className={cn(
                          "tabular-nums",
                          t.status === "done" &&
                            "text-emerald-600 dark:text-emerald-400",
                        )}
                      >
                        {t.status === "running" ? "Starting…" : t.status}
                        {t.total > 0 && ` · ${formatSize(t.total)}`}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex justify-end px-2 py-1.5 border-t border-black/8 dark:border-white/8">
            <Button variant="ghost" size="sm" onClick={clearFinished}>
              Clear finished
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
