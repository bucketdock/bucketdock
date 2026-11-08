import { act, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { ObjectMetadata } from "@/lib/tauri";

const { getMetadata, showError } = vi.hoisted(() => ({
  getMetadata: vi.fn(), showError: vi.fn(),
}));
vi.mock("@/lib/tauri", () => ({
  getObjectMetadata: getMetadata,
  updateObjectMetadata: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { error: showError } }));

import { ObjectInfoModal } from "./object-info-modal";

const metadata: ObjectMetadata = {
  size: 123,
  last_modified: null,
  etag: "new-etag",
  content_type: "text/plain",
  cache_control: null,
  content_disposition: null,
  content_encoding: null,
  content_language: null,
  metadata: {},
};

beforeEach(() => {
  getMetadata.mockReset();
  showError.mockReset();
});

it("loads metadata for the new connection and ignores a stale failure", async () => {
  let rejectOld!: (error: Error) => void;
  getMetadata.mockReturnValueOnce(new Promise((_resolve, reject) => { rejectOld = reject; }));
  getMetadata.mockResolvedValueOnce(metadata);
  const props = { open: true, onClose: vi.fn(), bucket: "bucket", objectKey: "notes.txt" };
  const { rerender } = render(<ObjectInfoModal {...props} connectionId="old" />);
  rerender(<ObjectInfoModal {...props} connectionId="new" />);
  expect(await screen.findByText("new-etag")).toBeInTheDocument();
  expect(getMetadata).toHaveBeenLastCalledWith("new", "bucket", "notes.txt");

  await act(async () => { rejectOld(new Error("old request failed")); });
  expect(props.onClose).not.toHaveBeenCalled();
  expect(showError).not.toHaveBeenCalled();
  expect(screen.getByText("new-etag")).toBeInTheDocument();
});

it("uses the latest close handler without reloading metadata on parent renders", async () => {
  let rejectLoad!: (error: Error) => void;
  getMetadata.mockReturnValueOnce(new Promise((_resolve, reject) => { rejectLoad = reject; }));
  const props = { open: true, connectionId: "c1", bucket: "bucket", objectKey: "notes.txt" };
  const firstClose = vi.fn();
  const nextClose = vi.fn();
  const { rerender } = render(<ObjectInfoModal {...props} onClose={firstClose} />);
  rerender(<ObjectInfoModal {...props} onClose={nextClose} />);
  expect(getMetadata).toHaveBeenCalledTimes(1);

  await act(async () => { rejectLoad(new Error("request failed")); });
  expect(firstClose).not.toHaveBeenCalled();
  expect(nextClose).toHaveBeenCalledTimes(1);
  expect(showError).toHaveBeenCalledTimes(1);
});
