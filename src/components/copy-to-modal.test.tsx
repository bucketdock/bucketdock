import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ── Tauri command mocks ──────────────────────────────────────────────────────
//
// The tree picker drives `listObjects` for navigation, `listBuckets` for the
// bucket dropdown, and `createFolder` for the inline "New Folder" button.
// We control them directly so the tests assert only the modal's own
// state-machine, never network behaviour.

const listBucketsMock = vi.fn();
const listObjectsMock = vi.fn();
const listKeysUnderMock = vi.fn();
const createFolderMock = vi.fn();
const enqueueCopyMock = vi.fn();
const enqueueMoveMock = vi.fn();

vi.mock("@/lib/tauri", () => ({
  listBuckets: (...args: unknown[]) => listBucketsMock(...args),
  listObjects: (...args: unknown[]) => listObjectsMock(...args),
  listKeysUnder: (...args: unknown[]) => listKeysUnderMock(...args),
  createFolder: (...args: unknown[]) => createFolderMock(...args),
}));

vi.mock("@/store/transfers-store", () => ({
  useTransfersStore: Object.assign(
    (
      selector: (s: {
        enqueueCopy: typeof enqueueCopyMock;
        enqueueMove: typeof enqueueMoveMock;
      }) => unknown,
    ) =>
      selector({
        enqueueCopy: enqueueCopyMock,
        enqueueMove: enqueueMoveMock,
      }),
    {
      getState: () => ({
        enqueueCopy: enqueueCopyMock,
        enqueueMove: enqueueMoveMock,
      }),
    },
  ),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  },
}));

import { useAppStore } from "@/store/app-store";
import CopyToModal from "@/components/copy-to-modal";

function seedStore() {
  useAppStore.setState({
    connections: [
      {
        id: "c1",
        name: "Test Conn",
        provider: "aws",
        endpoint: null,
        region: "us-east-1",
        access_key_id: "AKIA",
        bucket_filter: null,
      },
    ],
    selectedConnectionId: "c1",
    selectedBucket: "src-bucket",
    prefix: "",
    buckets: {},
  });
}

beforeEach(() => {
  listBucketsMock.mockReset();
  listObjectsMock.mockReset();
  listKeysUnderMock.mockReset();
  createFolderMock.mockReset();
  enqueueCopyMock.mockReset();
  enqueueMoveMock.mockReset();
  seedStore();

  listBucketsMock.mockResolvedValue([
    { name: "src-bucket", creation_date: null },
    { name: "dst-bucket", creation_date: null },
  ]);
  listKeysUnderMock.mockResolvedValue([]);
  createFolderMock.mockResolvedValue(undefined);

  // A small two-level folder tree we can expand.
  listObjectsMock.mockImplementation(
    async (_conn: string, _bucket: string, prefix: string) => {
      if (prefix === "") return { folders: ["photos/", "docs/"], files: [] };
      if (prefix === "photos/") return { folders: ["photos/2024/"], files: [] };
      return { folders: [], files: [] };
    },
  );
});

function renderModal(
  overrides: Partial<React.ComponentProps<typeof CopyToModal>> = {},
) {
  return render(
    <CopyToModal
      open
      onClose={() => {}}
      srcConnectionId="c1"
      srcBucket="src-bucket"
      keys={["report.pdf"]}
      {...overrides}
    />,
  );
}

describe("CopyToModal tree picker", () => {
  it("renders the bucket root as the initial destination", async () => {
    renderModal();
    await waitFor(() =>
      expect(listObjectsMock).toHaveBeenCalledWith("c1", "src-bucket", ""),
    );
    expect(screen.getByTestId("copy-destination")).toHaveTextContent(
      "src-bucket/",
    );
  });

  it("expands a folder when its disclosure triangle is clicked, without changing the selection", async () => {
    const user = userEvent.setup();
    renderModal();

    await screen.findByTestId("copy-tree-row-photos/");
    await user.click(screen.getByTestId("copy-tree-disclosure-photos/"));

    await waitFor(() =>
      expect(listObjectsMock).toHaveBeenCalledWith(
        "c1",
        "src-bucket",
        "photos/",
      ),
    );
    // Child appears.
    await screen.findByTestId("copy-tree-row-photos/2024/");
    // Selection still on root.
    expect(screen.getByTestId("copy-destination")).toHaveTextContent(
      "src-bucket/",
    );
  });

  it("selects a folder as the destination when its row body is clicked", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(await screen.findByTestId("copy-tree-row-photos/"));
    expect(screen.getByTestId("copy-destination")).toHaveTextContent(
      "src-bucket/photos/",
    );
  });

  it("never doubles a prefix when expanding nested folders", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(await screen.findByTestId("copy-tree-disclosure-photos/"));
    await user.click(
      await screen.findByTestId("copy-tree-disclosure-photos/2024/"),
    );

    for (const call of listObjectsMock.mock.calls) {
      expect(call[2]).not.toContain("photos/photos");
    }
  });
});

describe("CopyToModal Create Folder", () => {
  it("creates a folder under the selected destination and selects it", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(await screen.findByTestId("copy-tree-row-photos/"));
    await user.click(screen.getByTestId("copy-create-folder-button"));

    const input = await screen.findByTestId("copy-new-folder-input");
    await user.type(input, "new-album");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() =>
      expect(createFolderMock).toHaveBeenCalledWith(
        "c1",
        "src-bucket",
        "photos/new-album/",
      ),
    );
    await waitFor(() =>
      expect(screen.getByTestId("copy-destination")).toHaveTextContent(
        "src-bucket/photos/new-album/",
      ),
    );
  });
});

describe("CopyToModal Move mode", () => {
  it("queues a move batch (not a copy) when mode='move'", async () => {
    const user = userEvent.setup();
    renderModal({
      mode: "move",
      keys: ["report.pdf"],
    });

    await user.click(await screen.findByTestId("copy-tree-row-photos/"));
    await user.click(screen.getByTestId("copy-confirm-button"));

    await waitFor(() => expect(enqueueMoveMock).toHaveBeenCalledTimes(1));
    expect(enqueueCopyMock).not.toHaveBeenCalled();

    const batch = enqueueMoveMock.mock.calls[0][0];
    expect(batch.srcConnectionId).toBe("c1");
    expect(batch.srcBucket).toBe("src-bucket");
    expect(batch.items).toHaveLength(1);
    expect(batch.items[0]).toMatchObject({
      kind: "file",
      srcKey: "report.pdf",
      dstKey: "photos/report.pdf",
    });
  });

  it("uses copy (not move) by default", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(await screen.findByTestId("copy-tree-row-photos/"));
    await user.click(screen.getByTestId("copy-confirm-button"));

    await waitFor(() => expect(enqueueCopyMock).toHaveBeenCalledTimes(1));
    expect(enqueueMoveMock).not.toHaveBeenCalled();
  });
});
