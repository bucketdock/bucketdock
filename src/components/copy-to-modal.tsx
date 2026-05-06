"use client";

import * as React from "react";
import { toast } from "sonner";
import { ChevronRight, Folder, Check } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/cn";
import { useAppStore } from "@/store/app-store";
import { useTransfersStore } from "@/store/transfers-store";
import {
  listBuckets,
  listObjects,
  listKeysUnder,
  type BucketInfo,
} from "@/lib/tauri";
import {
  normalizeDstPrefix,
  selfCopyReason,
  browseUp,
  enterFolderPrefix,
  folderRowLabel,
  browseBreadcrumbs,
} from "@/lib/copy-targets";

export interface CopyToModalProps {
  open: boolean;
  onClose: () => void;
  /** Source connection */
  srcConnectionId: string;
  srcBucket: string;
  /** Object keys to copy. Folders (keys ending in '/') are expanded recursively. */
  keys: string[];
}

/**
 * Bucket-to-bucket (or same-bucket) copy modal.
 *
 * Lets the user choose a destination connection, bucket and prefix, then
 * enqueues one transfer per file. Folders are expanded by listing every key
 * under them and re-creating the relative layout at the destination.
 *
 * The Destination prefix can be typed *or* browsed via a built-in folder
 * picker so users don't have to remember the exact path. We also block the
 * obvious "copy something onto itself" case before we enqueue any work,
 * because doing so would silently overwrite the source.
 */
export default function CopyToModal({
  open,
  onClose,
  srcConnectionId,
  srcBucket,
  keys,
}: CopyToModalProps) {
  const connections = useAppStore((s) => s.connections);
  const enqueueCopy = useTransfersStore((s) => s.enqueueCopy);
  const srcPrefix = useAppStore((s) => s.prefix);

  const [dstConnId, setDstConnId] = React.useState<string>(srcConnectionId);
  const [dstBuckets, setDstBuckets] = React.useState<BucketInfo[] | null>(null);
  const [dstBucket, setDstBucket] = React.useState<string>(srcBucket);
  // The current location of the folder browser. This *is* the destination
  // prefix — there is no separate text field. Whatever folder the user is
  // looking at is where the copy will land.
  const [browsePrefix, setBrowsePrefix] = React.useState<string>("");
  const [browseFolders, setBrowseFolders] = React.useState<string[]>([]);
  const [browseLoading, setBrowseLoading] = React.useState(false);
  const [loadingBuckets, setLoadingBuckets] = React.useState(false);
  const [expanding, setExpanding] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setDstConnId(srcConnectionId);
    setDstBucket(srcBucket);
    setBrowsePrefix("");
  }, [open, srcConnectionId, srcBucket]);

  React.useEffect(() => {
    if (!open || !dstConnId) return;
    let cancelled = false;
    setLoadingBuckets(true);
    setDstBuckets(null);
    listBuckets(dstConnId)
      .then((list) => {
        if (cancelled) return;
        setDstBuckets(list);
        if (list.length > 0 && !list.find((b) => b.name === dstBucket)) {
          setDstBucket(list[0].name);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        toast.error(
          `Failed to load buckets: ${err instanceof Error ? err.message : String(err)}`,
        );
        setDstBuckets([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingBuckets(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, dstConnId, dstBucket]);

  // Reset the browser to the bucket root when the destination bucket
  // changes. The previous browse location is meaningless in another bucket.
  React.useEffect(() => {
    setBrowsePrefix("");
  }, [dstBucket, dstConnId]);

  // Lazy-load the subfolder list for the current browse prefix.
  React.useEffect(() => {
    if (!open || !dstConnId || !dstBucket) return;
    let cancelled = false;
    setBrowseLoading(true);
    listObjects(dstConnId, dstBucket, browsePrefix)
      .then((page) => {
        if (cancelled) return;
        setBrowseFolders(page.folders);
      })
      .catch((err) => {
        if (cancelled) return;
        toast.error(
          `Failed to list folders: ${err instanceof Error ? err.message : String(err)}`,
        );
        setBrowseFolders([]);
      })
      .finally(() => {
        if (!cancelled) setBrowseLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, dstConnId, dstBucket, browsePrefix]);

  function blockingReason(): string | null {
    return selfCopyReason({
      srcConnectionId,
      srcBucket,
      srcPrefix,
      selectedKeys: keys,
      dstConnectionId: dstConnId,
      dstBucket,
      dstPrefixRaw: browsePrefix,
    });
  }

  async function handleCopy() {
    if (!dstConnId || !dstBucket) {
      toast.error("Pick a destination bucket.");
      return;
    }
    const reason = blockingReason();
    if (reason) {
      toast.error(reason);
      return;
    }
    const prefix = normalizeDstPrefix(browsePrefix);

    const fileKeys = keys.filter((k) => !k.endsWith("/"));
    const folderKeys = keys.filter((k) => k.endsWith("/"));

    setExpanding(true);
    let queued = 0;
    try {
      for (const key of fileKeys) {
        const name = key.split("/").filter(Boolean).pop() ?? key;
        const dstKey = prefix + name;
        if (
          dstConnId === srcConnectionId &&
          dstBucket === srcBucket &&
          dstKey === key
        ) {
          continue;
        }
        enqueueCopy({
          srcConnectionId,
          srcBucket,
          srcKey: key,
          dstConnectionId: dstConnId,
          dstBucket,
          dstKey,
          name,
          subtitle: `${srcBucket}/${key}  →  ${dstBucket}/${dstKey}`,
        });
        queued++;
      }

      for (const folderKey of folderKeys) {
        const objects = await listKeysUnder(
          srcConnectionId,
          srcBucket,
          folderKey,
        );
        const folderName =
          folderKey.replace(/\/$/, "").split("/").pop() ?? "folder";
        for (const obj of objects) {
          if (obj.key.endsWith("/")) continue;
          const rel = obj.key.slice(folderKey.length);
          if (!rel) continue;
          const dstKey = `${prefix}${folderName}/${rel}`;
          if (
            dstConnId === srcConnectionId &&
            dstBucket === srcBucket &&
            dstKey === obj.key
          )
            continue;
          const name = rel.split("/").pop() ?? rel;
          enqueueCopy({
            srcConnectionId,
            srcBucket,
            srcKey: obj.key,
            dstConnectionId: dstConnId,
            dstBucket,
            dstKey,
            name,
            subtitle: `${srcBucket}/${obj.key}  →  ${dstBucket}/${dstKey}`,
          });
          queued++;
        }
      }
    } catch (err) {
      toast.error(
        `Failed to expand folder: ${err instanceof Error ? err.message : String(err)}`,
      );
      setExpanding(false);
      return;
    }
    setExpanding(false);
    if (queued === 0) {
      toast.error(
        "Nothing to copy — every item in the selection already exists at that destination.",
      );
      return;
    }
    toast.success(`Queued ${queued} copy transfer(s)`);
    onClose();
  }

  const fileCount = keys.filter((k) => !k.endsWith("/")).length;
  const folderCount = keys.length - fileCount;
  const crumbs = browseBreadcrumbs(dstBucket || "bucket", browsePrefix);
  const destinationLabel = browsePrefix
    ? `${dstBucket}/${browsePrefix}`
    : `${dstBucket}/`;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Copy ${keys.length} item${keys.length !== 1 ? "s" : ""} to…`}
    >
      <div className="flex flex-col gap-3">
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          {fileCount} file{fileCount === 1 ? "" : "s"}
          {folderCount > 0 && (
            <>
              {", "}
              {folderCount} folder{folderCount === 1 ? "" : "s"} (contents
              expanded)
            </>
          )}
        </p>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Connection</Label>
            <Select
              value={dstConnId}
              onChange={(e) => setDstConnId(e.target.value)}
            >
              {connections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Bucket</Label>
            <Select
              value={dstBucket}
              onChange={(e) => setDstBucket(e.target.value)}
              disabled={loadingBuckets || !dstBuckets}
            >
              {loadingBuckets && <option>Loading…</option>}
              {!loadingBuckets && dstBuckets?.length === 0 && (
                <option value="">No buckets</option>
              )}
              {dstBuckets?.map((b) => (
                <option key={b.name} value={b.name}>
                  {b.name}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {/* Folder browser. Click a row to drill in. The current path is the
            destination — clearly shown in the breadcrumbs and the
            "Destination" badge. */}
        <div
          className="rounded-md border border-black/10 dark:border-white/10 bg-white/60 dark:bg-neutral-900/60 overflow-hidden"
          aria-label="Destination folder browser"
        >
          <nav
            className="flex items-center flex-wrap gap-0.5 px-2.5 py-1.5 border-b border-black/8 dark:border-white/8 text-xs"
            aria-label="Browse path"
          >
            {crumbs.map((c, idx) => (
              <React.Fragment key={c.prefix}>
                {idx > 0 && (
                  <ChevronRight
                    className="w-3 h-3 text-neutral-400 shrink-0"
                    aria-hidden="true"
                  />
                )}
                <button
                  type="button"
                  onClick={() => setBrowsePrefix(c.prefix)}
                  className={cn(
                    "px-1.5 py-0.5 rounded hover:bg-black/8 dark:hover:bg-white/8 transition-colors truncate max-w-40",
                    idx === crumbs.length - 1
                      ? "font-medium text-neutral-900 dark:text-neutral-100"
                      : "text-neutral-500 dark:text-neutral-400",
                  )}
                >
                  {c.label}
                </button>
              </React.Fragment>
            ))}
            <span className="flex-1" />
            <button
              type="button"
              onClick={() => setBrowsePrefix(browseUp(browsePrefix))}
              disabled={!browsePrefix}
              className="px-1.5 py-0.5 rounded text-[11px] text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-black/8 dark:hover:bg-white/8 disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label="Up one level"
              title="Up one level"
            >
              Up
            </button>
          </nav>

          <ul
            className="max-h-56 overflow-auto py-1 pane-scroll"
            aria-label="Subfolders"
          >
            {browseLoading ? (
              <li className="flex items-center gap-2 px-3 py-2 text-xs text-neutral-500">
                <Spinner className="w-3.5 h-3.5" />
                Loading…
              </li>
            ) : browseFolders.length === 0 ? (
              <li className="px-3 py-3 text-xs text-neutral-500 dark:text-neutral-400">
                No subfolders here.
              </li>
            ) : (
              browseFolders.map((f) => {
                const next = enterFolderPrefix(f);
                return (
                  <li key={f}>
                    <button
                      type="button"
                      onClick={() => setBrowsePrefix(next)}
                      className="group w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-black/5 dark:hover:bg-white/5"
                      aria-label={`Open ${folderRowLabel(f, browsePrefix)}`}
                    >
                      <Folder className="w-3.5 h-3.5 text-yellow-500 shrink-0" />
                      <span className="truncate">
                        {folderRowLabel(f, browsePrefix)}
                      </span>
                      <ChevronRight className="w-3 h-3 ml-auto text-neutral-400 opacity-0 group-hover:opacity-100" />
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>

        <div className="flex items-center gap-2 px-1 text-xs text-neutral-600 dark:text-neutral-400">
          <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
          <span className="truncate">
            Destination:{" "}
            <span
              className="font-mono text-neutral-900 dark:text-neutral-100"
              data-testid="copy-destination"
            >
              {destinationLabel}
            </span>
          </span>
        </div>

        <div className="flex justify-end gap-2 mt-2">
          <Button variant="secondary" onClick={onClose} disabled={expanding}>
            Cancel
          </Button>
          <Button
            onClick={handleCopy}
            disabled={keys.length === 0 || !dstBucket || expanding}
          >
            {expanding ? "Queueing…" : "Copy"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
