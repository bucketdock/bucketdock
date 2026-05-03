"use client";

import * as React from "react";
import { toast } from "sonner";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useAppStore } from "@/store/app-store";
import { useTransfersStore } from "@/store/transfers-store";
import { listBuckets, listKeysUnder, type BucketInfo } from "@/lib/tauri";

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
 * Bucket-to-bucket copy modal: lets the user choose a destination connection
 * and bucket, then enqueues one transfer per file. Folders are expanded by
 * listing every key under them and re-creating the relative layout at the
 * destination.
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

  const [dstConnId, setDstConnId] = React.useState<string>(srcConnectionId);
  const [dstBuckets, setDstBuckets] = React.useState<BucketInfo[] | null>(null);
  const [dstBucket, setDstBucket] = React.useState<string>(srcBucket);
  const [dstPrefix, setDstPrefix] = React.useState<string>("");
  const [loadingBuckets, setLoadingBuckets] = React.useState(false);
  const [expanding, setExpanding] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setDstConnId(srcConnectionId);
    setDstBucket(srcBucket);
    setDstPrefix("");
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

  async function handleCopy() {
    if (!dstConnId || !dstBucket) {
      toast.error("Pick a destination bucket");
      return;
    }
    const prefix =
      dstPrefix.endsWith("/") || dstPrefix === "" ? dstPrefix : dstPrefix + "/";

    const fileKeys = keys.filter((k) => !k.endsWith("/"));
    const folderKeys = keys.filter((k) => k.endsWith("/"));

    setExpanding(true);
    let queued = 0;
    try {
      // Files: copy as-is, preserving only the basename under the destination prefix.
      for (const key of fileKeys) {
        const name = key.split("/").filter(Boolean).pop() ?? key;
        const dstKey = prefix + name;
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
        // Use the folder's basename as a top-level directory at the destination
        // so multiple selected folders don't collide.
        const folderName =
          folderKey.replace(/\/$/, "").split("/").pop() ?? "folder";
        for (const obj of objects) {
          if (obj.key.endsWith("/")) continue;
          const rel = obj.key.slice(folderKey.length);
          if (!rel) continue;
          const dstKey = `${prefix}${folderName}/${rel}`;
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
      toast.error("Nothing to copy");
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
          <Label>Destination bucket</Label>
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
        <div>
          <Label>Destination prefix (optional)</Label>
          <Input
            placeholder="e.g. backups/"
            value={dstPrefix}
            onChange={(e) => setDstPrefix(e.target.value)}
          />
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
