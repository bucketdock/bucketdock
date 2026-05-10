import { describe, it, expect, vi, beforeEach } from "vitest";

const cancelTransferMock = vi.fn().mockResolvedValue(undefined);
const uploadFileTrackedMock = vi.fn().mockResolvedValue(undefined);
const downloadFileTrackedMock = vi.fn().mockResolvedValue(undefined);
const copyObjectTrackedMock = vi.fn().mockResolvedValue(undefined);
const deleteObjectMock = vi.fn().mockResolvedValue(undefined);
const deleteObjectsMock = vi.fn().mockResolvedValue(undefined);
const deletePrefixMock = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/tauri", () => ({
  cancelTransfer: (...args: unknown[]) => cancelTransferMock(...args),
  uploadFileTracked: (...args: unknown[]) => uploadFileTrackedMock(...args),
  downloadFileTracked: (...args: unknown[]) => downloadFileTrackedMock(...args),
  copyObjectTracked: (...args: unknown[]) => copyObjectTrackedMock(...args),
  deleteObject: (...args: unknown[]) => deleteObjectMock(...args),
  deleteObjects: (...args: unknown[]) => deleteObjectsMock(...args),
  deletePrefix: (...args: unknown[]) => deletePrefixMock(...args),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  },
}));

import { useTransfersStore } from "@/store/transfers-store";

beforeEach(() => {
  cancelTransferMock.mockClear();
  copyObjectTrackedMock.mockClear();
  deleteObjectMock.mockClear();
  deletePrefixMock.mockClear();
  // Reset the store between tests so transfer ids and item lists are fresh.
  useTransfersStore.setState({ items: [], open: false });
});

/** Wait for promise microtasks to flush so toast/delete side-effects land. */
async function flush() {
  await new Promise((r) => setTimeout(r, 0));
}

describe("transfersStore.enqueueMove — file items", () => {
  it("schedules a deleteObject only after the corresponding copy completes", async () => {
    useTransfersStore.getState().enqueueMove({
      srcConnectionId: "c1",
      srcBucket: "src",
      items: [
        {
          kind: "file",
          srcKey: "a.txt",
          dstConnectionId: "c1",
          dstBucket: "dst",
          dstKey: "a.txt",
          name: "a.txt",
        },
      ],
    });

    const tx = useTransfersStore.getState().items[0];
    expect(tx).toBeDefined();
    // Until the transfer reports done, the source must not be touched.
    expect(deleteObjectMock).not.toHaveBeenCalled();

    useTransfersStore.getState().applyProgress(tx.id, 100, 100, "done");
    await flush();
    expect(deleteObjectMock).toHaveBeenCalledWith("c1", "src", "a.txt");
  });

  it("does NOT delete the source when the copy fails", async () => {
    useTransfersStore.getState().enqueueMove({
      srcConnectionId: "c1",
      srcBucket: "src",
      items: [
        {
          kind: "file",
          srcKey: "a.txt",
          dstConnectionId: "c1",
          dstBucket: "dst",
          dstKey: "a.txt",
          name: "a.txt",
        },
      ],
    });

    const tx = useTransfersStore.getState().items[0];
    useTransfersStore.getState().applyProgress(tx.id, 0, 0, "failed", "boom");
    await flush();
    expect(deleteObjectMock).not.toHaveBeenCalled();
  });

  it("does NOT delete the source when the copy is cancelled", async () => {
    useTransfersStore.getState().enqueueMove({
      srcConnectionId: "c1",
      srcBucket: "src",
      items: [
        {
          kind: "file",
          srcKey: "a.txt",
          dstConnectionId: "c1",
          dstBucket: "dst",
          dstKey: "a.txt",
          name: "a.txt",
        },
      ],
    });

    const tx = useTransfersStore.getState().items[0];
    useTransfersStore.getState().applyProgress(tx.id, 0, 0, "cancelled");
    await flush();
    expect(deleteObjectMock).not.toHaveBeenCalled();
  });
});

describe("transfersStore.enqueueMove — folder items", () => {
  it("deletes the source prefix only after EVERY file in the folder copies successfully", async () => {
    useTransfersStore.getState().enqueueMove({
      srcConnectionId: "c1",
      srcBucket: "src",
      items: [
        {
          kind: "folder",
          srcFolderKey: "photos/",
          files: [
            {
              srcKey: "photos/a.jpg",
              dstConnectionId: "c1",
              dstBucket: "dst",
              dstKey: "photos/a.jpg",
              name: "a.jpg",
            },
            {
              srcKey: "photos/b.jpg",
              dstConnectionId: "c1",
              dstBucket: "dst",
              dstKey: "photos/b.jpg",
              name: "b.jpg",
            },
          ],
        },
      ],
    });

    const items = useTransfersStore.getState().items;
    expect(items).toHaveLength(2);

    // First file done — folder still has work outstanding, no deletes yet.
    useTransfersStore.getState().applyProgress(items[0].id, 100, 100, "done");
    await flush();
    expect(deletePrefixMock).not.toHaveBeenCalled();
    // No per-file delete either: folder moves use a single deletePrefix at
    // the end so we don't pay for N round-trips.
    expect(deleteObjectMock).not.toHaveBeenCalled();

    useTransfersStore.getState().applyProgress(items[1].id, 100, 100, "done");
    await flush();
    expect(deletePrefixMock).toHaveBeenCalledWith("c1", "src", "photos/");
    expect(deleteObjectMock).not.toHaveBeenCalled();
  });

  it("leaves the source folder intact when at least one of its files fails to copy", async () => {
    useTransfersStore.getState().enqueueMove({
      srcConnectionId: "c1",
      srcBucket: "src",
      items: [
        {
          kind: "folder",
          srcFolderKey: "photos/",
          files: [
            {
              srcKey: "photos/a.jpg",
              dstConnectionId: "c1",
              dstBucket: "dst",
              dstKey: "photos/a.jpg",
              name: "a.jpg",
            },
            {
              srcKey: "photos/b.jpg",
              dstConnectionId: "c1",
              dstBucket: "dst",
              dstKey: "photos/b.jpg",
              name: "b.jpg",
            },
          ],
        },
      ],
    });

    const items = useTransfersStore.getState().items;
    useTransfersStore.getState().applyProgress(items[0].id, 100, 100, "done");
    useTransfersStore
      .getState()
      .applyProgress(items[1].id, 0, 0, "failed", "boom");
    await flush();

    expect(deletePrefixMock).not.toHaveBeenCalled();
  });

  it("immediately deletes the source prefix for an empty folder", async () => {
    useTransfersStore.getState().enqueueMove({
      srcConnectionId: "c1",
      srcBucket: "src",
      items: [
        {
          kind: "folder",
          srcFolderKey: "empty/",
          files: [],
        },
      ],
    });
    await flush();
    expect(deletePrefixMock).toHaveBeenCalledWith("c1", "src", "empty/");
  });
});
