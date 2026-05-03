"use client";

import * as React from "react";
import { HardDrive, RotateCw, Edit2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

import { listBuckets, isTauri } from "@/lib/tauri";
import { useAppStore } from "@/store/app-store";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/cn";
import ConnectionFormModal from "@/components/connection-form-modal";

interface BucketsPaneProps {
  connectionId: string;
}

/** Recognise the common "scoped credentials can't ListBuckets" failure modes
 * so we can show concrete remediation steps instead of a raw S3 error. */
function isLikelyScopedCredsError(msg: string): boolean {
  const m = msg.toLowerCase();
  return (
    m.includes("accessdenied") ||
    m.includes("not authorized") ||
    m.includes("forbidden") ||
    m.includes("listbuckets")
  );
}

/**
 * Right-side bucket picker shown when a connection is selected but no
 * bucket has been chosen yet. Mirrors the Finder-style cards used elsewhere
 * in the app and re-uses the same `buckets` cache as the sidebar so the two
 * stay in sync.
 *
 * This pane is the single source of truth for "couldn't list buckets"
 * errors: ConnectionsSidebar deliberately does not raise a toast for the
 * same failure to avoid duplicated nag.
 */
export default function BucketsPane({ connectionId }: BucketsPaneProps) {
  const buckets = useAppStore((s) => s.buckets[connectionId]);
  const setBuckets = useAppStore((s) => s.setBuckets);
  const selectBucket = useAppStore((s) => s.selectBucket);
  const connection = useAppStore((s) =>
    s.connections.find((c) => c.id === connectionId),
  );

  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [editOpen, setEditOpen] = React.useState(false);

  const refresh = React.useCallback(async () => {
    if (!isTauri()) return;
    setLoading(true);
    setError(null);
    try {
      const list = await listBuckets(connectionId);
      setBuckets(connectionId, list);
    } catch (e) {
      setError(typeof e === "string" ? e : (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [connectionId, setBuckets]);

  React.useEffect(() => {
    if (!buckets) refresh();
  }, [buckets, refresh]);

  const hasBucketFilter = !!connection?.bucket_filter?.trim();
  const scopedHint =
    error && !hasBucketFilter && isLikelyScopedCredsError(error);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2 border-b border-black/8 dark:border-white/8 shrink-0 min-h-[44px]">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium truncate">
            {connection?.name ?? "Connection"}
          </span>
          <span className="text-xs text-neutral-500 dark:text-neutral-400 truncate">
            {buckets
              ? `${buckets.length} bucket${buckets.length === 1 ? "" : "s"}`
              : ""}
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={refresh}
          aria-label="Refresh buckets"
          title="Refresh"
        >
          <RotateCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
        </Button>
      </div>

      <div className="flex-1 min-h-0 overflow-auto p-6">
        {loading && !buckets ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-lg" />
            ))}
          </div>
        ) : error ? (
          <EmptyState
            title={
              scopedHint
                ? "These credentials can’t list buckets"
                : "Couldn’t load buckets"
            }
            description={
              scopedHint ? (
                <span>
                  Most providers refuse account-wide{" "}
                  <code className="font-mono text-[11px]">ListBuckets</code> for
                  scoped tokens (e.g. Cloudflare R2 bucket-scoped tokens, AWS
                  IAM users without <code>s3:ListAllMyBuckets</code>). Open the
                  connection and put the bucket name(s) in the{" "}
                  <strong>Buckets</strong> field — the app will use them
                  directly without trying to list.
                  <br />
                  <span className="text-neutral-500 dark:text-neutral-500 text-xs">
                    Original error: {error}
                  </span>
                </span>
              ) : (
                error
              )
            }
            action={
              <div className="flex items-center gap-2">
                <Button onClick={refresh} variant="secondary">
                  Retry
                </Button>
                {connection && (
                  <Button onClick={() => setEditOpen(true)}>
                    <Edit2 className="w-3.5 h-3.5" />
                    Edit Connection
                  </Button>
                )}
              </div>
            }
          />
        ) : buckets && buckets.length === 0 ? (
          <EmptyState
            title="No buckets visible"
            description="If your credentials are scoped to specific buckets, list them in the connection’s Buckets field."
            action={
              connection && (
                <Button onClick={() => setEditOpen(true)}>
                  <Edit2 className="w-3.5 h-3.5" />
                  Edit Connection
                </Button>
              )
            }
          />
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
            {(buckets ?? []).map((b) => (
              <button
                key={b.name}
                onClick={() => selectBucket(b.name)}
                className="group flex flex-col items-start gap-2 p-4 rounded-lg border border-black/10 dark:border-white/10 bg-white/60 dark:bg-neutral-900/60 hover:border-blue-500/50 hover:bg-blue-50/40 dark:hover:bg-blue-950/30 hover:shadow-sm transition-all text-left"
              >
                <HardDrive className="w-6 h-6 text-blue-500 group-hover:text-blue-600" />
                <div className="min-w-0 w-full">
                  <div className="font-medium text-sm truncate">{b.name}</div>
                  {b.creation_date && (
                    <div className="text-xs text-neutral-500 dark:text-neutral-400 truncate">
                      Created{" "}
                      {formatDistanceToNow(new Date(b.creation_date), {
                        addSuffix: true,
                      })}
                    </div>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
      {connection && (
        <ConnectionFormModal
          open={editOpen}
          onClose={() => setEditOpen(false)}
          initial={connection}
        />
      )}
    </div>
  );
}
