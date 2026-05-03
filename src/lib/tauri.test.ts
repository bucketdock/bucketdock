import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @tauri-apps/api/core BEFORE importing the module under test so the
// `invoke` import is replaced. This lets us assert what command and what
// argument shape every wrapper sends to the backend — critical because a
// silent typo would let the frontend "delete" or "create" the wrong key.
const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import * as tauri from "./tauri";

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(undefined);
});

describe("delete / mutate commands target the correct backend", () => {
  it("deleteObject sends connectionId/bucket/key — never another bucket", async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    await tauri.deleteObject("conn-1", "buck", "path/to/file.txt");
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("delete_object", {
      connectionId: "conn-1",
      bucket: "buck",
      key: "path/to/file.txt",
    });
  });

  it("deleteObjects forwards the exact key list (no truncation, no merging)", async () => {
    const keys = ["a", "b/c.txt", "d/e/f.bin"];
    await tauri.deleteObjects("conn-1", "buck", keys);
    expect(invokeMock).toHaveBeenCalledWith("delete_objects", {
      connectionId: "conn-1",
      bucket: "buck",
      keys,
    });
    // The wrapper must not mutate the caller's array.
    expect(keys).toEqual(["a", "b/c.txt", "d/e/f.bin"]);
  });

  it("deletePrefix is a separate command from deleteObject", async () => {
    await tauri.deletePrefix("conn-1", "buck", "subdir/");
    expect(invokeMock).toHaveBeenCalledWith("delete_prefix", {
      connectionId: "conn-1",
      bucket: "buck",
      prefix: "subdir/",
    });
  });

  it("createFolder targets create_folder", async () => {
    await tauri.createFolder("conn", "b", "new/");
    expect(invokeMock).toHaveBeenCalledWith("create_folder", {
      connectionId: "conn",
      bucket: "b",
      prefix: "new/",
    });
  });

  it("renameObject and renamePrefix don't get swapped", async () => {
    await tauri.renameObject("c", "b", "old.txt", "new.txt");
    expect(invokeMock).toHaveBeenLastCalledWith("rename_object", {
      connectionId: "c",
      bucket: "b",
      oldKey: "old.txt",
      newKey: "new.txt",
    });
    await tauri.renamePrefix("c", "b", "old/", "new/");
    expect(invokeMock).toHaveBeenLastCalledWith("rename_prefix", {
      connectionId: "c",
      bucket: "b",
      oldPrefix: "old/",
      newPrefix: "new/",
    });
  });

  it("uploadFile and downloadFile keep the local path argument distinct", async () => {
    await tauri.uploadFile("c", "b", "k", "/tmp/local");
    expect(invokeMock).toHaveBeenLastCalledWith("upload_file", {
      connectionId: "c",
      bucket: "b",
      key: "k",
      localPath: "/tmp/local",
    });
    await tauri.downloadFile("c", "b", "k", "/tmp/dst");
    expect(invokeMock).toHaveBeenLastCalledWith("download_file", {
      connectionId: "c",
      bucket: "b",
      key: "k",
      localPath: "/tmp/dst",
    });
  });

  it("tracked transfers carry a dedicated transferId", async () => {
    await tauri.uploadFileTracked("c", "b", "k", "/tmp/x", "tx-1");
    expect(invokeMock).toHaveBeenLastCalledWith("upload_file_tracked", {
      connectionId: "c",
      bucket: "b",
      key: "k",
      localPath: "/tmp/x",
      transferId: "tx-1",
    });
    await tauri.copyObjectTracked("c1", "b1", "k1", "c2", "b2", "k2", "tx-2");
    expect(invokeMock).toHaveBeenLastCalledWith("copy_object_tracked", {
      srcConnectionId: "c1",
      srcBucket: "b1",
      srcKey: "k1",
      dstConnectionId: "c2",
      dstBucket: "b2",
      dstKey: "k2",
      transferId: "tx-2",
    });
    await tauri.cancelTransfer("tx-2");
    expect(invokeMock).toHaveBeenLastCalledWith("cancel_transfer", {
      transferId: "tx-2",
    });
  });
});

describe("error normalization", () => {
  it("unwraps Tauri's {kind, message} into a real Error", async () => {
    invokeMock.mockRejectedValueOnce({ kind: "S3", message: "AccessDenied" });
    await expect(tauri.listBuckets("c")).rejects.toThrow("AccessDenied");
  });

  it("preserves the kind discriminator on the thrown error", async () => {
    invokeMock.mockRejectedValueOnce({
      kind: "Keyring",
      message: "missing secret",
    });
    try {
      await tauri.listBuckets("c");
      throw new Error("expected to throw");
    } catch (err) {
      const e = err as Error & { kind?: string };
      expect(e.message).toBe("missing secret");
      expect(e.kind).toBe("Keyring");
    }
  });

  it("falls back to stringifying truly opaque errors", async () => {
    invokeMock.mockRejectedValueOnce("plain string error");
    await expect(tauri.listBuckets("c")).rejects.toThrow("plain string error");
  });
});
