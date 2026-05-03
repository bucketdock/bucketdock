"use client";

import * as React from "react";
import { toast } from "sonner";
import { ChevronLeft, Folder, FolderOpen } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { useAppStore } from "@/store/app-store";
import { useTransfersStore } from "@/store/transfers-store";
import {
  listBuckets,
  listObjects,
  listKeysUnder,
  type BucketInfo,
} from "@/lib/tauri";
import { normalizeDstPrefix, selfCopyReason } from "@/lib/copy-targets";

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
  const [dstPrefix, setDstPrefix] = React.useState<string>("");
  const [loadingBuckets, setLoadingBuckets] = React.useState(false);
  const [expanding, setExpanding] = React.useState(false);

  // Folder browser state
  const [browseOpen, setBrowseOpen] = React.useState(false);
  const [browsePrefix, setBrowsePrefix] = React.useState("");
  const [browseFolders, setBrowseFolders] = React.useState<string[]>([]);
  const [browseLoading, setBrowseLoading] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setDstConnId(srcConnectionId);
    setDstBucket(srcBucket);
    setDstPrefix("");
    setBrowseOpen(false);
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

  // Lazy-load folders for the inline browser whenever the user opens it or
  // navigates into a sub-prefix.
  React.useEffect(() => {
    if (!browseOpen || !dstConnId || !dstBucket) return;
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
  }, [browseOpen, dstConnId, dstBucket, browsePrefix]);

  function normalizedPrefix(): string {
    return normalizeDstPrefix(dstPrefix);
  }

  function blockingReason(): string | null {
    return selfCopyReason({
      srcConnectionId,
      srcBucket,
      srcPrefix,
      selectedKeys: keys,
      dstConnectionId: dstConnId,
      dstBucket,
      dstPrefixRaw: dstPrefix,
    });
  }

  async function handleCopy() {
    if (!dstConnId || !dstBucket) {
      toast.error(
        "Pick a destination bucket — you can also browse to a destination folder.",
      );
      return;
    }
    const reason = blockingReason();
    if (reason) {
      toast.error(reason);
      return;
    }
    const prefix = normalizedPrefix();

    const fileKeys = keys.filter((k) => !k.endsWith("/"));
    const folderKeys = keys.filter((k) => k.endsWith("/"));

    setExpanding(true);
    let queued = 0;
    try {
      // Files: copy as-is, preserving only the basename under the destination prefix.
      for (const key of fileKeys) {
        const name = key.split("/").filter(Boolean).pop() ?? key;
        const dstKey = prefix + name;
        if (
          dstConnId === srcConnectionId &&
          dstBucket === srcBucket &&
          dstKey === key
        ) {
          // Same source/destination key — would overwrite itself; skip silently.
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

      // Folders: list every key under each folder and rebuild the relative
      // layout under the destination prefix.
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
        <div>
          <Label>Destination connection</Label>
          <Select
            value={dstConnId}
            onChange={(e) => {
              setDstConnId(e.target.value);
              setBrowseOpen(false);
              setBrowsePrefix("");
            }}
          >
            {connections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Destination bucket</Label>
          <Select
            value={dstBucket}
            onChange={(e) => {
              setDstBucket(e.target.value);
              setBrowseOpen(false);
              setBrowsePrefix("");
            }}
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
        <div>
          <Label>Destination prefix (optional)</Label>
          <div className="flex gap-2">
            <Input
              placeholder="e.g. backups/"
              value={dstPrefix}
              onChange={(e) => setDstPrefix(e.target.value)}
              className="flex-1"
            />
            <Button
              variant="secondary"
              type="button"
              onClick={() => {
                setBrowsePrefix(normalizedPrefix());
                setBrowseOpen((v) => !v);
              }}
              disabled={!dstBucket || loadingBuckets}
              title="Browse destination folders"
            >
              <FolderOpen className="w-3.5 h-3.5" />
              {browseOpen ? "Close" : "Browse…"}
            </Button>
          </div>
          <p className="mt-1 text-[11px] text-neutral-500 dark:text-neutral-400">
            Leave blank to copy into the bucket root. Browse to pick an existing
            folder, or type a path to create one.
          </p>
        </div>

        {browseOpen && (
          <div className="rounded-md border border-black/10 dark:border-white/10 bg-white/50 dark:bg-neutral-900/50">
            <div className="flex items-center gap-2 px-2 py-1.5 border-b border-black/8 dark:border-white/8 text-xs">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  // Walk up one level and keep the destination input in sync
                  // with the visible browser path so the user can click Copy
                  // at any time without a separate "Use this folder" step.
                  const trimmed = browsePrefix.replace(/\/$/, "");
                  const idx = trimmed.lastIndexOf("/");
                  const next = idx === -1 ? "" : trimmed.slice(0, idx + 1);
                  setBrowsePrefix(next);
                  setDstPrefix(next);
                }}
                disabled={!browsePrefix}
                aria-label="Up one level"
                title="Up one level"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </Button>
              <span className="font-mono truncate">
                {dstBucket}/{browsePrefix}
              </span>
              <span className="flex-1" />
              <span
                className="text-[11px] text-neutral-500 dark:text-neutral-400 select-none"
                title="The destination follows your selection here automatically"
              >
                Click a folder to drill in — Copy uses the current path.
              </span>
            </div>
            <div className="max-h-48 overflow-auto py-1">
              {browseLoading ? (
                <div className="flex items-center gap-2 px-3 py-2 text-xs text-neutral-500">
                  <Spinner className="w-3.5 h-3.5" />
                  Loading…
                </div>
              ) : browseFolders.length === 0 ? (
                <div className="px-3 py-2 text-xs text-neutral-500 dark:text-neutral-400">
                  No subfolders here. Click <strong>Copy</strong> below to drop
                  the items at this level.
                </div>
              ) : (
                browseFolders.map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => {
                      // Drill into the folder AND set it as the destination
                      // in one click. Replaces the old two-step "navigate +
                      // Use this folder" flow.
                      const next = browsePrefix + f;
                      setBrowsePrefix(next);
                      setDstPrefix(next);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-black/5 dark:hover:bg-white/5"
                  >
                    <Folder className="w-3.5 h-3.5 text-yellow-500" />
                    <span className="truncate">
                      {f.slice(browsePrefix.length).replace(/\/$/, "")}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        )}
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
