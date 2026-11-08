import { act, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { ObjectPreview } from "@/lib/tauri";

const { readPreview } = vi.hoisted(() => ({ readPreview: vi.fn() }));
vi.mock("@/lib/tauri", () => ({
  readObjectPreview: readPreview,
  getPresignedUrl: vi.fn().mockResolvedValue(null),
}));

import { FilePreviewModal } from "./file-preview-modal";

function preview(text: string): ObjectPreview {
  return {
    body_b64: btoa(text), content_type: "text/plain",
    complete: true, size: text.length,
  };
}

beforeEach(() => { readPreview.mockReset(); });

it("resets on bucket changes and ignores a previous object's pending response", async () => {
  let resolveOld!: (value: ObjectPreview) => void;
  readPreview.mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve; }));
  readPreview.mockResolvedValueOnce(preview("New bucket content"));
  const props = { open: true, onClose: vi.fn(), connectionId: "c1", objectKey: "notes.txt" };
  const { rerender } = render(<FilePreviewModal {...props} bucket="old" />);
  rerender(<FilePreviewModal {...props} bucket="new" />);
  expect(await screen.findByText("New bucket content")).toBeInTheDocument();

  await act(async () => { resolveOld(preview("Old bucket content")); });
  expect(screen.queryByText("Old bucket content")).not.toBeInTheDocument();
  expect(screen.getByText("New bucket content")).toBeInTheDocument();
});

it("reloads preview content after closing and reopening the same object", async () => {
  readPreview.mockResolvedValueOnce(preview("Original content"));
  const props = { onClose: vi.fn(), connectionId: "c1", bucket: "bucket", objectKey: "notes.txt" };
  const { rerender } = render(<FilePreviewModal open {...props} />);
  expect(await screen.findByText("Original content")).toBeInTheDocument();
  rerender(<FilePreviewModal open={false} {...props} />);
  readPreview.mockResolvedValueOnce(preview("Updated content"));
  rerender(<FilePreviewModal open {...props} />);
  expect(screen.queryByText("Original content")).not.toBeInTheDocument();
  expect(await screen.findByText("Updated content")).toBeInTheDocument();
  expect(readPreview).toHaveBeenCalledTimes(2);
});
