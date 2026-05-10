"use client";

import { create } from "zustand";
import { toast } from "sonner";
import {
  cancelTransfer,
  uploadFileTracked,
  downloadFileTracked,
  copyObjectTracked,
  deleteObject,
  deleteObjects,
  deletePrefix,
} from "@/lib/tauri";

export type TransferKind = "upload" | "download" | "copy";
export type TransferStatus =
  | "queued"
  | "running"
  | "done"
  | "failed"
  | "cancelled";

export interface TransferParams {
  // Upload / download
  connectionId?: string;
  bucket?: string;
  key?: string;
  localPath?: string;
  // Copy (bucket-to-bucket)
  srcConnectionId?: string;
  srcBucket?: string;
  srcKey?: string;
  dstConnectionId?: string;
  dstBucket?: string;
  dstKey?: string;
}

export interface Transfer {
  id: string;
  kind: TransferKind;
  name: string;
  /** Short subtitle, e.g. "bucket/path/" */
  subtitle?: string;
  status: TransferStatus;
  loaded: number;
  total: number;
  error?: string;
  params: TransferParams;
  createdAt: number;
}

interface TransfersStore {
  items: Transfer[];
  open: boolean;
  setOpen: (open: boolean) => void;

  enqueueUpload: (input: {
    connectionId: string;
    bucket: string;
    key: string;
    localPath: string;
    name: string;
    subtitle?: string;
    total?: number;
  }) => string;
  enqueueDownload: (input: {
    connectionId: string;
    bucket: string;
    key: string;
    localPath: string;
    name: string;
    subtitle?: string;
    total?: number;
  }) => string;
  enqueueCopy: (input: {
    srcConnectionId: string;
    srcBucket: string;
    srcKey: string;
    dstConnectionId: string;
    dstBucket: string;
    dstKey: string;
    name: string;
    subtitle?: string;
    total?: number;
  }) => string;

  /**
   * Move = copy + delete-source-on-success.
   *
   * Source files are *only* removed once their copy completes successfully,
   * which is the heart of the reliability guarantee for the Move action:
   * a transfer that was cancelled, errored or never landed must never
   * disappear from the source. Folders are tracked as a group so the
   * folder placeholder (and any nested files) is removed only after the
   * full subtree has finished copying. Anything that failed is left
   * untouched at the source so the user can retry.
   *
   * Returns the batch id (mostly useful for tests).
   */
  enqueueMove: (input: {
    srcConnectionId: string;
    srcBucket: string;
    items: Array<MoveBatchItem>;
  }) => string;

  applyProgress: (
    id: string,
    loaded: number,
    total: number,
    status: TransferStatus,
    error?: string,
  ) => void;
  cancel: (id: string) => void;
  retry: (id: string) => void;
  remove: (id: string) => void;
  clearFinished: () => void;
}

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `tx-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// ── Move batch tracking ──────────────────────────────────────────────────────
//
// Move is implemented client-side as "copy each item, then delete the
// source for everything that copied successfully". The store keeps a
// per-batch ledger of the constituent copy transfers so that as each one
// completes we can either schedule the source delete (success) or leave
// the source alone (failure / cancellation). Folder items are deleted
// only when *every* file under them copied successfully — a partial
// folder move would otherwise silently lose data.

export type MoveBatchItem =
  | {
      kind: "file";
      srcKey: string;
      dstConnectionId: string;
      dstBucket: string;
      dstKey: string;
      name: string;
      subtitle?: string;
    }
  | {
      kind: "folder";
      /** Source folder key with trailing slash. */
      srcFolderKey: string;
      files: Array<{
        srcKey: string;
        dstConnectionId: string;
        dstBucket: string;
        dstKey: string;
        name: string;
        subtitle?: string;
      }>;
    };

interface MoveBatchState {
  srcConnectionId: string;
  srcBucket: string;
  /** Map of in-flight transfer ids to the source key being copied. */
  fileGroup: Map<
    string,
    { srcKey: string; status: "pending" | "done" | "failed" }
  >;
  /** Folder-scoped sub-batches. */
  folderGroups: Array<{
    srcFolderKey: string;
    fileTxIds: Set<string>;
    pending: number;
    succeeded: number;
    failed: number;
  }>;
  // Snapshot of the original counts so we can report a single summary
  // toast once everything has resolved.
  totalFiles: number;
  totalFolders: number;
  doneFiles: number;
  doneFolders: number;
  failedFiles: number;
  failedFolders: number;
  finalised: boolean;
}

const moveBatches = new Map<string, MoveBatchState>();

function isTerminal(status: TransferStatus): boolean {
  return status === "done" || status === "failed" || status === "cancelled";
}

/**
 * Walk every active move batch and react to a transfer's terminal state.
 * Splits source-deletion into per-file (single object) and per-folder
 * (delete the whole prefix) so we minimise round-trips and never delete a
 * source whose copy failed.
 */
function reactToTerminalTransfer(
  transferId: string,
  status: TransferStatus,
): void {
  for (const [batchId, batch] of moveBatches) {
    if (batch.finalised) continue;

    // ── Top-level file? Delete its single source key on success.
    const fileEntry = batch.fileGroup.get(transferId);
    if (fileEntry && fileEntry.status === "pending") {
      if (status === "done") {
        fileEntry.status = "done";
        batch.doneFiles += 1;
        deleteObject(
          batch.srcConnectionId,
          batch.srcBucket,
          fileEntry.srcKey,
        ).catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          toast.error(
            `Move: copied "${fileEntry.srcKey}" but failed to delete source — ${msg}`,
          );
        });
      } else {
        fileEntry.status = "failed";
        batch.failedFiles += 1;
      }
      maybeFinaliseBatch(batchId, batch);
      continue;
    }

    // ── Folder member? Update its sub-batch.
    for (const fg of batch.folderGroups) {
      if (!fg.fileTxIds.has(transferId)) continue;
      // Each tx id contributes once. Strip it so duplicate events don't
      // double-count when the backend re-emits a final status (defensive).
      fg.fileTxIds.delete(transferId);
      fg.pending = Math.max(0, fg.pending - 1);
      if (status === "done") fg.succeeded += 1;
      else fg.failed += 1;

      if (fg.pending === 0) {
        if (fg.failed === 0 && fg.succeeded > 0) {
          // Whole folder copied cleanly — wipe the source prefix in one
          // call. `deletePrefix` removes both the placeholder and any
          // descendants.
          batch.doneFolders += 1;
          deletePrefix(
            batch.srcConnectionId,
            batch.srcBucket,
            fg.srcFolderKey,
          ).catch((err) => {
            const msg = err instanceof Error ? err.message : String(err);
            toast.error(
              `Move: copied folder "${fg.srcFolderKey}" but failed to delete source — ${msg}`,
            );
          });
        } else {
          batch.failedFolders += 1;
          // Leave the source folder alone — some files didn't make it.
        }
      }
      maybeFinaliseBatch(batchId, batch);
      break;
    }
  }
}

function maybeFinaliseBatch(batchId: string, batch: MoveBatchState): void {
  const filesDone = batch.doneFiles + batch.failedFiles >= batch.totalFiles;
  const foldersDone =
    batch.doneFolders + batch.failedFolders >= batch.totalFolders;
  if (!filesDone || !foldersDone) return;

  batch.finalised = true;
  moveBatches.delete(batchId);

  const moved = batch.doneFiles + batch.doneFolders;
  const failed = batch.failedFiles + batch.failedFolders;
  if (moved > 0 && failed === 0) {
    toast.success(`Moved ${moved} item${moved === 1 ? "" : "s"}`);
  } else if (moved > 0 && failed > 0) {
    toast.error(
      `Move partially failed: ${moved} moved, ${failed} left at source`,
    );
  } else if (failed > 0) {
    toast.error(
      `Move failed: ${failed} item${failed === 1 ? "" : "s"} left at source`,
    );
  }
}

async function startTransfer(t: Transfer) {
  try {
    if (t.kind === "upload") {
      await uploadFileTracked(
        t.params.connectionId!,
        t.params.bucket!,
        t.params.key!,
        t.params.localPath!,
        t.id,
      );
    } else if (t.kind === "download") {
      await downloadFileTracked(
        t.params.connectionId!,
        t.params.bucket!,
        t.params.key!,
        t.params.localPath!,
        t.id,
      );
    } else {
      await copyObjectTracked(
        t.params.srcConnectionId!,
        t.params.srcBucket!,
        t.params.srcKey!,
        t.params.dstConnectionId!,
        t.params.dstBucket!,
        t.params.dstKey!,
        t.id,
      );
    }
    // The backend emits the final status event; nothing to do on success here.
  } catch (err) {
    // The backend already emitted a "failed" event, but defensively mark
    // the row as failed in case the event was missed.
    const msg = err instanceof Error ? err.message : String(err);
    useTransfersStore.getState().applyProgress(t.id, 0, t.total, "failed", msg);
  }
}

export const useTransfersStore = create<TransfersStore>((set, get) => ({
  items: [],
  open: false,
  setOpen: (open) => set({ open }),

  enqueueUpload: ({
    connectionId,
    bucket,
    key,
    localPath,
    name,
    subtitle,
    total,
  }) => {
    const id = newId();
    const t: Transfer = {
      id,
      kind: "upload",
      name,
      subtitle,
      status: "running",
      loaded: 0,
      total: total ?? 0,
      params: { connectionId, bucket, key, localPath },
      createdAt: Date.now(),
    };
    set((s) => ({ items: [t, ...s.items], open: true }));
    void startTransfer(t);
    return id;
  },

  enqueueDownload: ({
    connectionId,
    bucket,
    key,
    localPath,
    name,
    subtitle,
    total,
  }) => {
    const id = newId();
    const t: Transfer = {
      id,
      kind: "download",
      name,
      subtitle,
      status: "running",
      loaded: 0,
      total: total ?? 0,
      params: { connectionId, bucket, key, localPath },
      createdAt: Date.now(),
    };
    set((s) => ({ items: [t, ...s.items], open: true }));
    void startTransfer(t);
    return id;
  },

  enqueueCopy: ({
    srcConnectionId,
    srcBucket,
    srcKey,
    dstConnectionId,
    dstBucket,
    dstKey,
    name,
    subtitle,
    total,
  }) => {
    const id = newId();
    const t: Transfer = {
      id,
      kind: "copy",
      name,
      subtitle,
      status: "running",
      loaded: 0,
      total: total ?? 0,
      params: {
        srcConnectionId,
        srcBucket,
        srcKey,
        dstConnectionId,
        dstBucket,
        dstKey,
      },
      createdAt: Date.now(),
    };
    set((s) => ({ items: [t, ...s.items], open: true }));
    void startTransfer(t);
    return id;
  },

  enqueueMove: ({ srcConnectionId, srcBucket, items }) => {
    const batchId = newId();
    const batch: MoveBatchState = {
      srcConnectionId,
      srcBucket,
      fileGroup: new Map(),
      folderGroups: [],
      totalFiles: 0,
      totalFolders: 0,
      doneFiles: 0,
      doneFolders: 0,
      failedFiles: 0,
      failedFolders: 0,
      finalised: false,
    };

    const newItems: Transfer[] = [];
    const startThese: Transfer[] = [];

    for (const item of items) {
      if (item.kind === "file") {
        batch.totalFiles += 1;
        const id = newId();
        const t: Transfer = {
          id,
          kind: "copy",
          name: item.name,
          subtitle: item.subtitle,
          status: "running",
          loaded: 0,
          total: 0,
          params: {
            srcConnectionId,
            srcBucket,
            srcKey: item.srcKey,
            dstConnectionId: item.dstConnectionId,
            dstBucket: item.dstBucket,
            dstKey: item.dstKey,
          },
          createdAt: Date.now(),
        };
        batch.fileGroup.set(id, { srcKey: item.srcKey, status: "pending" });
        newItems.push(t);
        startThese.push(t);
      } else {
        batch.totalFolders += 1;
        const fileTxIds = new Set<string>();
        for (const f of item.files) {
          const id = newId();
          fileTxIds.add(id);
          const t: Transfer = {
            id,
            kind: "copy",
            name: f.name,
            subtitle: f.subtitle,
            status: "running",
            loaded: 0,
            total: 0,
            params: {
              srcConnectionId,
              srcBucket,
              srcKey: f.srcKey,
              dstConnectionId: f.dstConnectionId,
              dstBucket: f.dstBucket,
              dstKey: f.dstKey,
            },
            createdAt: Date.now(),
          };
          newItems.push(t);
          startThese.push(t);
        }
        batch.folderGroups.push({
          srcFolderKey: item.srcFolderKey,
          fileTxIds,
          pending: fileTxIds.size,
          succeeded: 0,
          failed: 0,
        });
        // Empty folder edge-case: nothing to copy ⇒ delete the placeholder
        // immediately and mark the folder as moved. Mirrors the behaviour
        // a user would expect ("the folder disappeared because it was
        // empty and got moved").
        if (fileTxIds.size === 0) {
          batch.doneFolders += 1;
          deletePrefix(srcConnectionId, srcBucket, item.srcFolderKey).catch(
            () => {
              /* swallow: best-effort cleanup */
            },
          );
        }
      }
    }

    moveBatches.set(batchId, batch);
    if (newItems.length > 0) {
      set((s) => ({ items: [...newItems, ...s.items], open: true }));
      for (const t of startThese) void startTransfer(t);
    } else {
      // Nothing to actually transfer (e.g. only empty folders) — finalise.
      maybeFinaliseBatch(batchId, batch);
    }
    return batchId;
  },

  applyProgress: (id, loaded, total, status, error) => {
    set((s) => ({
      items: s.items.map((it) =>
        it.id === id
          ? {
              ...it,
              loaded,
              total: Math.max(it.total, total),
              status,
              error: error ?? it.error,
            }
          : it,
      ),
    }));
    if (isTerminal(status)) reactToTerminalTransfer(id, status);
  },

  cancel: (id) => {
    const it = get().items.find((x) => x.id === id);
    if (!it) return;
    if (it.status === "running" || it.status === "queued") {
      void cancelTransfer(id).catch(() => {
        /* ignore */
      });
    }
    set((s) => ({
      items: s.items.map((x) =>
        x.id === id ? { ...x, status: "cancelled" } : x,
      ),
    }));
  },

  retry: (id) => {
    const it = get().items.find((x) => x.id === id);
    if (!it) return;
    const fresh: Transfer = {
      ...it,
      id: newId(),
      status: "running",
      loaded: 0,
      error: undefined,
      createdAt: Date.now(),
    };
    set((s) => ({ items: [fresh, ...s.items.filter((x) => x.id !== id)] }));
    void startTransfer(fresh);
  },

  remove: (id) => set((s) => ({ items: s.items.filter((x) => x.id !== id) })),

  clearFinished: () =>
    set((s) => ({
      items: s.items.filter(
        (x) => x.status === "running" || x.status === "queued",
      ),
    })),
}));
