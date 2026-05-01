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
import { listBuckets, type BucketInfo } from "@/lib/tauri";

export interface CopyToModalProps {
  open: boolean;
  onClose: () => void;
  /** Source connection */
  srcConnectionId: string;
  srcBucket: string;
  /** Object keys to copy. Folders (keys ending in '/') are not supported in this minimal flow. */
  keys: string[];
}

/**
 * Minimal bucket-to-bucket copy modal: lets the user choose a destination
 * connection and bucket, then enqueues one transfer per selected key.
 * Folders are skipped (the existing folder upload/download path is preserved).
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

  function handleCopy() {
    const fileKeys = keys.filter((k) => !k.endsWith("/"));
    if (fileKeys.length === 0) {
      toast.error("Folder copy is not supported. Select files instead.");
      return;
    }
    if (!dstConnId || !dstBucket) {
      toast.error("Pick a destination bucket");
      return;
    }
    const prefix =
      dstPrefix.endsWith("/") || dstPrefix === "" ? dstPrefix : dstPrefix + "/";
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
    }
    toast.success(`Queued ${fileKeys.length} copy transfer(s)`);
    onClose();
  }

  const fileCount = keys.filter((k) => !k.endsWith("/")).length;
  const skipped = keys.length - fileCount;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Copy ${fileCount} file${fileCount !== 1 ? "s" : ""} to…`}
    >
      <div className="flex flex-col gap-3">
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
        {skipped > 0 && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            {skipped} folder selection(s) will be skipped — folder copy is not
            yet supported.
          </p>
        )}
        <div className="flex justify-end gap-2 mt-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleCopy} disabled={fileCount === 0 || !dstBucket}>
            Copy
          </Button>
        </div>
      </div>
    </Modal>
  );
}
