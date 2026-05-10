import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ── Tauri command mocks ──────────────────────────────────────────────────────
//
// ObjectBrowser drives `listObjects` for both the top-level listing and the
// inline disclosure-triangle expansion. Other Tauri commands are stubbed so
// the component can mount in jsdom without touching the desktop shell.

const listObjectsMock = vi.fn();
const headObjectContentTypesMock = vi.fn().mockResolvedValue({});
const walkLocalFilesMock = vi.fn().mockResolvedValue([]);

vi.mock("@/lib/tauri", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/tauri")>("@/lib/tauri");
  return {
    ...actual,
    listObjects: (...args: unknown[]) => listObjectsMock(...args),
    headObjectContentTypes: (...args: unknown[]) =>
      headObjectContentTypesMock(...args),
    walkLocalFiles: (...args: unknown[]) => walkLocalFilesMock(...args),
    isTauri: () => false,
  };
});

const enqueueUploadMock = vi.fn();
vi.mock("@/store/transfers-store", () => ({
  useTransfersStore: Object.assign(
    (selector: (s: { enqueueUpload: () => void }) => unknown) =>
      selector({ enqueueUpload: enqueueUploadMock }),
    {
      getState: () => ({
        items: [],
        enqueueUpload: enqueueUploadMock,
        enqueueDownload: () => {},
        enqueueCopy: () => {},
      }),
      subscribe: () => () => {},
    },
  ),
}));

// Stub the Tauri dialog plugin so the file/folder pickers resolve to
// deterministic paths in tests.
const dialogOpenMock = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...args: unknown[]) => dialogOpenMock(...args),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
    message: vi.fn(),
  },
}));

import { useAppStore } from "@/store/app-store";
import ObjectBrowser, { folderDisplayName } from "@/components/object-browser";

function seedStore(prefix = "") {
  useAppStore.setState({
    connections: [
      {
        id: "c1",
        name: "Test",
        provider: "aws",
        endpoint: null,
        region: "us-east-1",
        access_key_id: "AKIA",
        bucket_filter: null,
      },
    ],
    selectedConnectionId: "c1",
    selectedBucket: "my-bucket",
    prefix,
    back: [],
    forward: [],
    buckets: {},
  });
}

beforeEach(() => {
  listObjectsMock.mockReset();
  headObjectContentTypesMock.mockReset();
  headObjectContentTypesMock.mockResolvedValue({});
  walkLocalFilesMock.mockReset();
  walkLocalFilesMock.mockResolvedValue([]);
  enqueueUploadMock.mockReset();
  dialogOpenMock.mockReset();
  seedStore();

  // Default tree:
  //   /            -> photos/, report.pdf
  //   /photos/     -> photos/2024/, photos/cover.jpg
  //   /photos/2024 -> (empty)
  listObjectsMock.mockImplementation(
    async (_c: string, _b: string, prefix: string) => {
      if (prefix === "") {
        return {
          folders: ["photos/"],
          files: [
            {
              key: "report.pdf",
              size: 1024,
              last_modified: null,
              etag: null,
              storage_class: null,
            },
          ],
        };
      }
      if (prefix === "photos/") {
        return {
          folders: ["photos/2024/"],
          files: [
            {
              key: "photos/cover.jpg",
              size: 2048,
              last_modified: null,
              etag: null,
              storage_class: null,
            },
          ],
        };
      }
      return { folders: [], files: [] };
    },
  );
});

describe("folderDisplayName", () => {
  it("returns the leaf folder name relative to a parent prefix", () => {
    expect(folderDisplayName("photos/", "")).toBe("photos");
    expect(folderDisplayName("photos/2024/", "photos/")).toBe("2024");
  });
});

describe("ObjectBrowser top toolbar", () => {
  it("shows back and forward buttons that are disabled at history root", async () => {
    render(<ObjectBrowser />);
    await screen.findByRole("button", { name: "Back" });
    expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Forward" })).toBeDisabled();
  });

  it("renders the bucket name as the current folder when at root", async () => {
    render(<ObjectBrowser />);
    expect(await screen.findByTestId("current-folder-name")).toHaveTextContent(
      "my-bucket",
    );
  });

  it("renders the leaf folder as the current folder name when inside a prefix", async () => {
    seedStore("photos/2024/");
    render(<ObjectBrowser />);
    expect(await screen.findByTestId("current-folder-name")).toHaveTextContent(
      "2024",
    );
  });

  it("back/forward buttons traverse the navigation history", async () => {
    const user = userEvent.setup();
    render(<ObjectBrowser />);

    // Drill into photos/ via the store helper (simulating a row double-click)
    // — exactly how the component triggers history pushes in production.
    await act(async () => {
      useAppStore.getState().navigateInto("photos/");
    });
    await waitFor(() =>
      expect(screen.getByTestId("current-folder-name")).toHaveTextContent(
        "photos",
      ),
    );

    const back = screen.getByRole("button", { name: "Back" });
    expect(back).not.toBeDisabled();
    await user.click(back);

    expect(screen.getByTestId("current-folder-name")).toHaveTextContent(
      "my-bucket",
    );
    const forward = screen.getByRole("button", { name: "Forward" });
    expect(forward).not.toBeDisabled();
    await user.click(forward);
    expect(screen.getByTestId("current-folder-name")).toHaveTextContent(
      "photos",
    );
  });
});

describe("ObjectBrowser bottom path bar", () => {
  it("renders the bucket and each prefix segment as clickable crumbs", async () => {
    seedStore("photos/2024/");
    render(<ObjectBrowser />);
    const bar = await screen.findByTestId("path-bar");
    expect(bar).toHaveTextContent("my-bucket");
    expect(bar).toHaveTextContent("photos");
    expect(bar).toHaveTextContent("2024");
  });

  it("clicking a path-bar crumb navigates back to that level", async () => {
    seedStore("photos/2024/");
    const user = userEvent.setup();
    render(<ObjectBrowser />);
    const bar = await screen.findByTestId("path-bar");

    // Click the bucket crumb to jump to the root.
    const bucketCrumb = await screen.findByRole("button", {
      name: "my-bucket",
    });
    expect(bar).toContainElement(bucketCrumb);
    await user.click(bucketCrumb);

    await waitFor(() => expect(useAppStore.getState().prefix).toBe(""));
  });
});

describe("ObjectBrowser folder disclosure triangle", () => {
  it("expanding a folder fetches and renders its children indented", async () => {
    const user = userEvent.setup();
    render(<ObjectBrowser />);

    // Wait for top-level listing to render the photos/ folder.
    const triangle = await screen.findByTestId("disclosure-photos/");
    expect(triangle).toHaveAttribute("aria-expanded", "false");

    await user.click(triangle);

    await waitFor(() =>
      expect(listObjectsMock).toHaveBeenCalledWith(
        "c1",
        "my-bucket",
        "photos/",
      ),
    );
    // Child folder (photos/2024/) and child file (photos/cover.jpg) appear.
    await screen.findByText("2024");
    await screen.findByText("cover.jpg");
    expect(screen.getByTestId("disclosure-photos/")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("collapsing a folder hides its child rows", async () => {
    const user = userEvent.setup();
    render(<ObjectBrowser />);

    const triangle = await screen.findByTestId("disclosure-photos/");
    await user.click(triangle);
    await screen.findByText("cover.jpg");

    await user.click(screen.getByTestId("disclosure-photos/"));
    await waitFor(() =>
      expect(screen.queryByText("cover.jpg")).not.toBeInTheDocument(),
    );
  });

  it("does not navigate when the disclosure triangle is clicked", async () => {
    const user = userEvent.setup();
    render(<ObjectBrowser />);

    const triangle = await screen.findByTestId("disclosure-photos/");
    await user.click(triangle);

    // Prefix must remain at root; the triangle expands inline only.
    expect(useAppStore.getState().prefix).toBe("");
  });

  it("renders an Empty placeholder for a folder with no children", async () => {
    const user = userEvent.setup();
    seedStore("photos/");
    render(<ObjectBrowser />);

    // photos/ contains a 2024/ folder — expand it to see the empty marker.
    const triangle = await screen.findByTestId("disclosure-photos/2024/");
    await user.click(triangle);
    await screen.findByText("Empty");
  });
});

describe("ObjectBrowser upload split button", () => {
  it("opens the upload menu when the Upload button is clicked", async () => {
    const user = userEvent.setup();
    render(<ObjectBrowser />);

    const trigger = await screen.findByTestId("upload-button");
    await user.click(trigger);

    expect(screen.getByTestId("upload-menu")).toBeInTheDocument();
    expect(screen.getByTestId("upload-files")).toBeInTheDocument();
    expect(screen.getByTestId("upload-folder")).toBeInTheDocument();
  });

  it("queues each picked file as a tracked upload", async () => {
    const user = userEvent.setup();
    dialogOpenMock.mockResolvedValueOnce([
      "/Users/me/a.txt",
      "/Users/me/b.txt",
    ]);
    render(<ObjectBrowser />);

    await user.click(await screen.findByTestId("upload-button"));
    await user.click(screen.getByTestId("upload-files"));

    await waitFor(() => expect(enqueueUploadMock).toHaveBeenCalledTimes(2));
    expect(enqueueUploadMock.mock.calls[0][0]).toMatchObject({
      connectionId: "c1",
      bucket: "my-bucket",
      key: "a.txt",
      localPath: "/Users/me/a.txt",
      name: "a.txt",
    });
    expect(enqueueUploadMock.mock.calls[1][0]).toMatchObject({
      key: "b.txt",
      localPath: "/Users/me/b.txt",
    });
  });

  it("walks a picked folder and queues each contained file with progress totals", async () => {
    const user = userEvent.setup();
    dialogOpenMock.mockResolvedValueOnce("/Users/me/photos");
    walkLocalFilesMock.mockResolvedValueOnce([
      {
        absolute_path: "/Users/me/photos/cover.jpg",
        relative_path: "cover.jpg",
        size: 2048,
      },
      {
        absolute_path: "/Users/me/photos/2024/jan.jpg",
        relative_path: "2024/jan.jpg",
        size: 4096,
      },
    ]);
    render(<ObjectBrowser />);

    await user.click(await screen.findByTestId("upload-button"));
    await user.click(screen.getByTestId("upload-folder"));

    await waitFor(() =>
      expect(walkLocalFilesMock).toHaveBeenCalledWith("/Users/me/photos"),
    );
    await waitFor(() => expect(enqueueUploadMock).toHaveBeenCalledTimes(2));
    expect(enqueueUploadMock.mock.calls[0][0]).toMatchObject({
      key: "photos/cover.jpg",
      localPath: "/Users/me/photos/cover.jpg",
      total: 2048,
    });
    expect(enqueueUploadMock.mock.calls[1][0]).toMatchObject({
      key: "photos/2024/jan.jpg",
      localPath: "/Users/me/photos/2024/jan.jpg",
      total: 4096,
    });
  });

  it("does not queue anything when the user cancels the file picker", async () => {
    const user = userEvent.setup();
    dialogOpenMock.mockResolvedValueOnce(null);
    render(<ObjectBrowser />);

    await user.click(await screen.findByTestId("upload-button"));
    await user.click(screen.getByTestId("upload-files"));

    await new Promise((r) => setTimeout(r, 0));
    expect(enqueueUploadMock).not.toHaveBeenCalled();
  });
});

describe("ObjectBrowser context menu", () => {
  it("shows both Copy to… and Move to… for a file row", async () => {
    const user = userEvent.setup();
    render(<ObjectBrowser />);

    const fileName = await screen.findByText("report.pdf");
    // Right-click the row to open the context menu.
    await user.pointer({
      keys: "[MouseRight>]",
      target: fileName,
    });

    expect(await screen.findByText("Copy to…")).toBeInTheDocument();
    expect(screen.getByText("Move to…")).toBeInTheDocument();
  });

  it("shows both Copy to… and Move to… for a folder row", async () => {
    const user = userEvent.setup();
    render(<ObjectBrowser />);

    const folderName = await screen.findByText("photos");
    await user.pointer({
      keys: "[MouseRight>]",
      target: folderName,
    });

    expect(await screen.findByText("Copy to…")).toBeInTheDocument();
    expect(screen.getByText("Move to…")).toBeInTheDocument();
  });
});

describe("ObjectBrowser header layout", () => {
  it("always renders the Upload, Refresh and Filter affordances", async () => {
    render(<ObjectBrowser />);
    expect(await screen.findByTestId("upload-button")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument();
    expect(screen.getByLabelText("Filter")).toBeInTheDocument();
  });

  it("renders a selection-count badge when at least one item is selected", async () => {
    const user = userEvent.setup();
    render(<ObjectBrowser />);

    const file = await screen.findByText("report.pdf");
    await user.click(file);

    expect(await screen.findByTestId("selection-count")).toHaveTextContent(
      "1 selected",
    );
  });
});
