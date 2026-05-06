import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ── Tauri command mocks ──────────────────────────────────────────────────────
//
// The folder browser drives `listObjects` for navigation and `listBuckets`
// for the bucket dropdown. We control both directly so the test asserts only
// the modal's own state-machine, never network behaviour.

const listBucketsMock = vi.fn();
const listObjectsMock = vi.fn();
const enqueueCopyMock = vi.fn();

vi.mock("@/lib/tauri", () => ({
  listBuckets: (...args: unknown[]) => listBucketsMock(...args),
  listObjects: (...args: unknown[]) => listObjectsMock(...args),
  // Unused by these tests but referenced by the module under test.
  listKeysUnder: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/store/transfers-store", () => ({
  useTransfersStore: Object.assign(
    (selector: (s: { enqueueCopy: typeof enqueueCopyMock }) => unknown) =>
      selector({ enqueueCopy: enqueueCopyMock }),
    { getState: () => ({ enqueueCopy: enqueueCopyMock }) },
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
  enqueueCopyMock.mockReset();
  seedStore();

  listBucketsMock.mockResolvedValue([
    { name: "src-bucket", creation_date: null },
    { name: "dst-bucket", creation_date: null },
  ]);
  // Default to a single top-level folder so we can navigate into it.
  listObjectsMock.mockImplementation(
    async (_conn: string, _bucket: string, prefix: string) => {
      if (prefix === "") {
        return { folders: ["photos/"], files: [] };
      }
      if (prefix === "photos/") {
        return { folders: ["photos/2024/"], files: [] };
      }
      if (prefix === "photos/2024/") {
        return { folders: ["photos/2024/holidays/"], files: [] };
      }
      return { folders: [], files: [] };
    },
  );
});

function renderModal() {
  return render(
    <CopyToModal
      open
      onClose={() => {}}
      srcConnectionId="c1"
      srcBucket="src-bucket"
      keys={["report.pdf"]}
    />,
  );
}

describe("CopyToModal folder browser", () => {
  it("renders the bucket root as the initial destination", async () => {
    renderModal();
    await waitFor(() =>
      expect(listObjectsMock).toHaveBeenCalledWith("c1", "src-bucket", ""),
    );
    expect(screen.getByTestId("copy-destination")).toHaveTextContent(
      "src-bucket/",
    );
  });

  it("drills into a subfolder when its row is clicked", async () => {
    const user = userEvent.setup();
    renderModal();

    // Wait for the initial listing to render.
    const photos = await screen.findByRole("button", { name: /open photos/i });
    await user.click(photos);

    // The browser must request the *child* prefix exactly — regression
    // guard for the "photos/photos/2024/" double-prefix bug.
    await waitFor(() =>
      expect(listObjectsMock).toHaveBeenCalledWith(
        "c1",
        "src-bucket",
        "photos/",
      ),
    );
    expect(screen.getByTestId("copy-destination")).toHaveTextContent(
      "src-bucket/photos/",
    );
  });

  it("drills two levels deep without doubling the prefix", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(
      await screen.findByRole("button", { name: /open photos/i }),
    );
    await user.click(await screen.findByRole("button", { name: /open 2024/i }));

    await waitFor(() =>
      expect(listObjectsMock).toHaveBeenCalledWith(
        "c1",
        "src-bucket",
        "photos/2024/",
      ),
    );
    // Crucially, no call ever uses a doubled prefix like "photos/photos/".
    for (const call of listObjectsMock.mock.calls) {
      expect(call[2]).not.toContain("photos/photos");
    }
    expect(screen.getByTestId("copy-destination")).toHaveTextContent(
      "src-bucket/photos/2024/",
    );
  });

  it("walks back up one level when the breadcrumb 'Up' control is pressed", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(
      await screen.findByRole("button", { name: /open photos/i }),
    );
    await user.click(await screen.findByRole("button", { name: /open 2024/i }));

    const up = screen.getByRole("button", { name: /up one level/i });
    await user.click(up);

    expect(screen.getByTestId("copy-destination")).toHaveTextContent(
      "src-bucket/photos/",
    );
  });

  it("jumps to a higher level when the bucket breadcrumb is clicked", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(
      await screen.findByRole("button", { name: /open photos/i }),
    );

    // The breadcrumb nav exposes the bucket as the first crumb. Click it
    // to return to the bucket root in a single step.
    const nav = screen.getByRole("navigation", { name: /browse path/i });
    await within(nav).findByRole("button", { name: "src-bucket" });
    await user.click(within(nav).getByRole("button", { name: "src-bucket" }));

    expect(screen.getByTestId("copy-destination")).toHaveTextContent(
      "src-bucket/",
    );
  });

  it("does not display the obsolete 'Click a folder to drill in' helper text", async () => {
    renderModal();
    await screen.findByRole("button", { name: /open photos/i });
    expect(
      screen.queryByText(/click a folder to drill in/i),
    ).not.toBeInTheDocument();
  });
});
