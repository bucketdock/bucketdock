"use client";

import { create } from "zustand";
import {
  cancelTransfer,
  uploadFileTracked,
  downloadFileTracked,
  copyObjectTracked,
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

  applyProgress: (id, loaded, total, status, error) =>
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
    })),

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
