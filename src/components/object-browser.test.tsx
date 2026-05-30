import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ── Tauri command mocks ──────────────────────────────────────────────────────
//
// ObjectBrowser drives `listObjects` for both the top-level listing and the
// inline disclosure-triangle expansion. Other Tauri commands are stubbed so
// the component can mount in jsdom without touching the desktop shell.

const listObjectsMock = vi.fn();
const headObjectContentTypesMock = vi.fn().mockResolvedValue({});
const listKeysUnderMock = vi.fn().mockResolvedValue([]);
const walkLocalFilesMock = vi.fn().mockResolvedValue([]);

vi.mock("@/lib/tauri", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/tauri")>("@/lib/tauri");
  return {
    ...actual,
    listObjects: (...args: unknown[]) => listObjectsMock(...args),
    headObjectContentTypes: (...args: unknown[]) =>
      headObjectContentTypesMock(...args),
    listKeysUnder: (...args: unknown[]) => listKeysUnderMock(...args),
    walkLocalFiles: (...args: unknown[]) => walkLocalFilesMock(...args),
    isTauri: () => false,
  };
});

const enqueueUploadMock = vi.fn();
const enqueueDeleteMock = vi.fn();
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
        enqueueDelete: enqueueDeleteMock,
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

const toastErrorMock = vi.fn();
const toastSuccessMock = vi.fn();
const toastLoadingMock = vi.fn();
const toastDismissMock = vi.fn();
const toastMessageMock = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastErrorMock(...args),
    success: (...args: unknown[]) => toastSuccessMock(...args),
    loading: (...args: unknown[]) => toastLoadingMock(...args),
    dismiss: (...args: unknown[]) => toastDismissMock(...args),
    message: (...args: unknown[]) => toastMessageMock(...args),
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
  listKeysUnderMock.mockReset();
  listKeysUnderMock.mockResolvedValue([]);
  walkLocalFilesMock.mockReset();
  walkLocalFilesMock.mockResolvedValue([]);
  enqueueUploadMock.mockReset();
  enqueueDeleteMock.mockReset();
  dialogOpenMock.mockReset();
  toastErrorMock.mockReset();
  toastSuccessMock.mockReset();
  toastLoadingMock.mockReset();
  toastDismissMock.mockReset();
  toastMessageMock.mockReset();
  window.localStorage.clear();
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

  it("switches from no bucket to a bucket without runtime hook-order errors", async () => {
    seedStore();
    useAppStore.setState({ selectedBucket: null });

    render(<ObjectBrowser />);

    await act(async () => {
      useAppStore.setState({ selectedBucket: "my-bucket" });
    });

    expect(await screen.findByText("report.pdf")).toBeInTheDocument();
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

  it("filter matches loaded subfolder rows and nested files", async () => {
    const user = userEvent.setup();
    render(<ObjectBrowser />);

    await user.click(await screen.findByTestId("disclosure-photos/"));
    await screen.findByText("2024");
    await screen.findByText("cover.jpg");

    const filter = screen.getByLabelText("Filter");
    await user.type(filter, "2024");
    expect(screen.getByText("photos")).toBeInTheDocument();
    expect(screen.getByText("2024")).toBeInTheDocument();
    expect(screen.queryByText("report.pdf")).not.toBeInTheDocument();

    await user.clear(filter);
    await user.type(filter, "cover.jpg");
    expect(screen.getByText("photos")).toBeInTheDocument();
    expect(screen.getByText("cover.jpg")).toBeInTheDocument();
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
    expect(screen.getByText("Folder Size")).toBeInTheDocument();
  });

  it("shows the same folder context menu for an expanded subfolder row", async () => {
    const user = userEvent.setup();
    render(<ObjectBrowser />);

    await user.click(await screen.findByTestId("disclosure-photos/"));
    const subfolderName = await screen.findByText("2024");
    await user.pointer({ keys: "[MouseRight>]", target: subfolderName });

    expect(await screen.findByText("Open")).toBeInTheDocument();
    expect(screen.getByText("Folder Size")).toBeInTheDocument();
    expect(screen.getByText("Copy to…")).toBeInTheDocument();
    expect(screen.getByText("Move to…")).toBeInTheDocument();
  });

  it("does not show 'Folder Size' for file rows", async () => {
    const user = userEvent.setup();
    render(<ObjectBrowser />);

    const fileName = await screen.findByText("report.pdf");
    await user.pointer({
      keys: "[MouseRight>]",
      target: fileName,
    });

    expect(screen.queryByText("Folder Size")).not.toBeInTheDocument();
  });

  it("keeps row context-menu labels single-item even when multiple rows are selected", async () => {
    const user = userEvent.setup();
    render(<ObjectBrowser />);

    await screen.findByText("report.pdf");
    await user.click(screen.getByLabelText("Select report.pdf"));
    await user.click(screen.getByLabelText("Select photos"));

    const fileName = await screen.findByText("report.pdf");
    await user.pointer({ keys: "[MouseRight>]", target: fileName });

    expect(await screen.findByText("Rename")).toBeInTheDocument();
    expect(screen.getByText("Delete")).toBeInTheDocument();
    expect(screen.queryByText("Copy 2 to…")).not.toBeInTheDocument();
    expect(screen.queryByText("Move 2 to…")).not.toBeInTheDocument();
    expect(screen.queryByText("Delete 2 items")).not.toBeInTheDocument();
  });

  it("executes row Delete for only that row even when multiple rows are selected", async () => {
    const user = userEvent.setup();
    render(<ObjectBrowser />);

    await screen.findByText("report.pdf");
    await user.click(screen.getByLabelText("Select report.pdf"));
    await user.click(screen.getByLabelText("Select photos"));

    const fileName = await screen.findByText("report.pdf");
    await user.pointer({ keys: "[MouseRight>]", target: fileName });
    await user.click(await screen.findByText("Delete"));
    await user.click(await screen.findByRole("button", { name: "Delete" }));

    await waitFor(() => expect(enqueueDeleteMock).toHaveBeenCalledTimes(1));
    expect(enqueueDeleteMock.mock.calls[0][0]).toMatchObject({
      connectionId: "c1",
      bucket: "my-bucket",
      keys: ["report.pdf"],
      prefixes: [],
    });
  });

  it("opening a row context menu clears checked checkboxes", async () => {
    const user = userEvent.setup();
    render(<ObjectBrowser />);

    await screen.findByText("report.pdf");
    const fileCb = screen.getByLabelText(
      "Select report.pdf",
    ) as HTMLInputElement;
    const folderCb = screen.getByLabelText("Select photos") as HTMLInputElement;

    await user.click(fileCb);
    await user.click(folderCb);
    expect(fileCb.checked).toBe(true);
    expect(folderCb.checked).toBe(true);

    const fileName = await screen.findByText("report.pdf");
    await user.pointer({ keys: "[MouseRight>]", target: fileName });

    expect(await screen.findByText("Delete")).toBeInTheDocument();
    expect(fileCb.checked).toBe(false);
    expect(folderCb.checked).toBe(false);
  });

  it("clicking a row Actions button a second time closes its context menu", async () => {
    const user = userEvent.setup();
    render(<ObjectBrowser />);

    await screen.findByText("report.pdf");
    const actionsButtons = screen.getAllByRole("button", { name: "Actions" });
    const fileActions = actionsButtons[1]; // first visible row after folder is report.pdf

    await user.click(fileActions);
    expect(await screen.findByText("Delete")).toBeInTheDocument();

    fireEvent.click(fileActions);
    await waitFor(() => {
      expect(screen.queryByText("Rename")).not.toBeInTheDocument();
    });
  });
});

describe("ObjectBrowser header bulk actions", () => {
  it("shows selection actions disabled in the three-dots menu when nothing is selected", async () => {
    const user = userEvent.setup();
    render(<ObjectBrowser />);

    await screen.findByText("report.pdf");
    await user.click(screen.getByTestId("overflow-menu-trigger"));

    const menu = await screen.findByTestId("overflow-menu");
    expect(
      within(menu).getByRole("menuitem", { name: "Download" }),
    ).toBeDisabled();
    expect(
      within(menu).getByRole("menuitem", { name: "Copy to…" }),
    ).toBeDisabled();
    expect(
      within(menu).getByRole("menuitem", { name: "Move to…" }),
    ).toBeDisabled();
    expect(
      within(menu).getByRole("menuitem", { name: "Folder size" }),
    ).toBeDisabled();
    expect(
      within(menu).getByRole("menuitem", { name: "Delete items" }),
    ).toBeDisabled();
  });

  it("places 'Folder size' immediately after 'Download' in the three-dots menu", async () => {
    const user = userEvent.setup();
    render(<ObjectBrowser />);

    await screen.findByText("report.pdf");
    await user.click(screen.getByTestId("overflow-menu-trigger"));

    const menu = await screen.findByTestId("overflow-menu");
    const labels = within(menu)
      .getAllByRole("menuitem")
      .map((el) => el.textContent?.trim() ?? "");
    const downloadIdx = labels.findIndex((t) => t === "Download");
    const folderSizeIdx = labels.findIndex((t) => t === "Folder size");

    expect(downloadIdx).toBeGreaterThanOrEqual(0);
    expect(folderSizeIdx).toBe(downloadIdx + 1);
  });

  it("exposes bulk copy and move actions in the header for multi-selection", async () => {
    const user = userEvent.setup();
    render(<ObjectBrowser />);

    await screen.findByText("report.pdf");
    await user.click(screen.getByLabelText("Select report.pdf"));
    await user.click(screen.getByLabelText("Select photos"));

    await user.click(screen.getByTestId("overflow-menu-trigger"));
    const menu = await screen.findByTestId("overflow-menu");

    expect(
      within(menu).getByRole("menuitem", { name: "Copy to…" }),
    ).toBeEnabled();
    expect(
      within(menu).getByRole("menuitem", { name: "Move to…" }),
    ).toBeEnabled();
  });

  it("deletes all selected rows with the bulk selection delete flow", async () => {
    const user = userEvent.setup();
    render(<ObjectBrowser />);

    await screen.findByText("report.pdf");
    await user.click(screen.getByLabelText("Select report.pdf"));
    await user.click(screen.getByLabelText("Select photos"));

    fireEvent.keyDown(screen.getByTestId("folder-row-photos/"), {
      key: "Delete",
      code: "Delete",
      bubbles: true,
    });
    await user.click(await screen.findByRole("button", { name: "Delete" }));

    await waitFor(() => expect(enqueueDeleteMock).toHaveBeenCalledTimes(1));
    expect(enqueueDeleteMock.mock.calls[0][0]).toMatchObject({
      connectionId: "c1",
      bucket: "my-bucket",
      keys: ["report.pdf"],
      prefixes: ["photos/"],
    });
  });
});

describe("ObjectBrowser folder size calculation", () => {
  it("calculates recursively and shows the total size in the folder row", async () => {
    const user = userEvent.setup();
    listKeysUnderMock.mockResolvedValueOnce([
      {
        key: "photos/cover.jpg",
        size: 2048,
        last_modified: null,
        etag: null,
        storage_class: null,
      },
      {
        key: "photos/2024/jan.jpg",
        size: 4096,
        last_modified: null,
        etag: null,
        storage_class: null,
      },
    ]);

    render(<ObjectBrowser />);
    const folderName = await screen.findByText("photos");
    await user.pointer({ keys: "[MouseRight>]", target: folderName });
    await user.click(await screen.findByText("Folder Size"));

    await waitFor(() =>
      expect(listKeysUnderMock).toHaveBeenCalledWith(
        "c1",
        "my-bucket",
        "photos/",
      ),
    );
    await screen.findByText("6.0 KB");
  });

  it("does not emit toast notifications while calculating folder size", async () => {
    const user = userEvent.setup();
    listKeysUnderMock.mockResolvedValueOnce([
      {
        key: "photos/cover.jpg",
        size: 1024,
        last_modified: null,
        etag: null,
        storage_class: null,
      },
    ]);

    render(<ObjectBrowser />);
    const folderName = await screen.findByText("photos");
    await user.pointer({ keys: "[MouseRight>]", target: folderName });
    await user.click(await screen.findByText("Folder Size"));

    await waitFor(() =>
      expect(listKeysUnderMock).toHaveBeenCalledWith(
        "c1",
        "my-bucket",
        "photos/",
      ),
    );
    expect(toastLoadingMock).not.toHaveBeenCalled();
    expect(toastSuccessMock).not.toHaveBeenCalled();
    expect(toastErrorMock).not.toHaveBeenCalled();
    expect(toastDismissMock).not.toHaveBeenCalled();
  });
});

describe("ObjectBrowser selection / checkbox behaviour", () => {
  it("does not toggle a row's checkbox when clicking elsewhere on the row", async () => {
    const user = userEvent.setup();
    render(<ObjectBrowser />);

    const fileName = await screen.findByText("report.pdf");
    const checkbox = screen.getByLabelText(
      "Select report.pdf",
    ) as HTMLInputElement;
    expect(checkbox.checked).toBe(false);

    // Click the row body (the file name cell) — selection must not change.
    await user.click(fileName);
    expect(checkbox.checked).toBe(false);
  });

  it("toggles selection only when the row's checkbox is clicked", async () => {
    const user = userEvent.setup();
    render(<ObjectBrowser />);

    await screen.findByText("report.pdf");
    const checkbox = screen.getByLabelText(
      "Select report.pdf",
    ) as HTMLInputElement;

    await user.click(checkbox);
    expect(checkbox.checked).toBe(true);

    await user.click(checkbox);
    expect(checkbox.checked).toBe(false);
  });

  it("header checkbox selects all visible rows, and clears them when toggled off", async () => {
    const user = userEvent.setup();
    render(<ObjectBrowser />);

    await screen.findByText("report.pdf");
    const fileCb = screen.getByLabelText(
      "Select report.pdf",
    ) as HTMLInputElement;
    const folderCb = screen.getByLabelText("Select photos") as HTMLInputElement;
    const headerCb = screen.getByLabelText("Select all") as HTMLInputElement;

    expect(fileCb.checked).toBe(false);
    expect(folderCb.checked).toBe(false);

    await user.click(headerCb);
    expect(fileCb.checked).toBe(true);
    expect(folderCb.checked).toBe(true);
    expect(headerCb.checked).toBe(true);

    await user.click(headerCb);
    expect(fileCb.checked).toBe(false);
    expect(folderCb.checked).toBe(false);
    expect(headerCb.checked).toBe(false);
  });

  it("header checkbox enters indeterminate state when a subset is selected and selects all on next click", async () => {
    const user = userEvent.setup();
    render(<ObjectBrowser />);

    await screen.findByText("report.pdf");
    const fileCb = screen.getByLabelText(
      "Select report.pdf",
    ) as HTMLInputElement;
    const folderCb = screen.getByLabelText("Select photos") as HTMLInputElement;
    const headerCb = screen.getByLabelText("Select all") as HTMLInputElement;

    await user.click(fileCb);
    expect(headerCb.checked).toBe(false);
    expect(headerCb.indeterminate).toBe(true);

    await user.click(headerCb);
    expect(fileCb.checked).toBe(true);
    expect(folderCb.checked).toBe(true);
    expect(headerCb.checked).toBe(true);
  });

  it("checking a subfolder unchecks its parent folder", async () => {
    const user = userEvent.setup();
    render(<ObjectBrowser />);

    await user.click(await screen.findByTestId("disclosure-photos/"));

    const parentCb = screen.getByLabelText("Select photos") as HTMLInputElement;
    const childCb = (await screen.findByLabelText(
      "Select 2024",
    )) as HTMLInputElement;

    await user.click(parentCb);
    expect(parentCb.checked).toBe(true);

    await user.click(childCb);
    expect(childCb.checked).toBe(true);
    expect(parentCb.checked).toBe(false);
  });

  it("checking a parent folder unchecks selected descendants", async () => {
    const user = userEvent.setup();
    render(<ObjectBrowser />);

    await user.click(await screen.findByTestId("disclosure-photos/"));

    const parentCb = screen.getByLabelText("Select photos") as HTMLInputElement;
    const childCb = (await screen.findByLabelText(
      "Select 2024",
    )) as HTMLInputElement;

    await user.click(childCb);
    expect(childCb.checked).toBe(true);

    await user.click(parentCb);
    expect(parentCb.checked).toBe(true);
    expect(childCb.checked).toBe(false);
  });

  it("header checkbox affects only top-level rows and leaves subfolder selection unchanged", async () => {
    const user = userEvent.setup();
    render(<ObjectBrowser />);

    await user.click(await screen.findByTestId("disclosure-photos/"));

    const headerCb = screen.getByLabelText("Select all") as HTMLInputElement;
    const topFolderCb = screen.getByLabelText(
      "Select photos",
    ) as HTMLInputElement;
    const topFileCb = screen.getByLabelText(
      "Select report.pdf",
    ) as HTMLInputElement;
    const childCb = (await screen.findByLabelText(
      "Select 2024",
    )) as HTMLInputElement;

    await user.click(childCb);
    expect(childCb.checked).toBe(true);
    expect(headerCb.checked).toBe(false);

    await user.click(headerCb);
    expect(topFolderCb.checked).toBe(true);
    expect(topFileCb.checked).toBe(true);
    expect(childCb.checked).toBe(false);

    // Toggling header off only clears top-level rows; it does not toggle
    // subfolders on by itself.
    await user.click(headerCb);
    expect(topFolderCb.checked).toBe(false);
    expect(topFileCb.checked).toBe(false);
    expect(childCb.checked).toBe(false);

    await user.click(childCb);
    expect(childCb.checked).toBe(true);

    await user.click(headerCb);
    expect(topFolderCb.checked).toBe(true);
    expect(topFileCb.checked).toBe(true);
    expect(childCb.checked).toBe(false);

    await user.click(headerCb);
    expect(topFolderCb.checked).toBe(false);
    expect(topFileCb.checked).toBe(false);
    expect(childCb.checked).toBe(false);
  });
});

describe("ObjectBrowser folder size dash click", () => {
  it("clicking the dash in the Size column of a folder calculates and displays size", async () => {
    const user = userEvent.setup();
    listKeysUnderMock.mockResolvedValueOnce([
      {
        key: "photos/cover.jpg",
        size: 1024,
        last_modified: null,
        etag: null,
        storage_class: null,
      },
      {
        key: "photos/2024/jan.jpg",
        size: 2048,
        last_modified: null,
        etag: null,
        storage_class: null,
      },
    ]);

    render(<ObjectBrowser />);
    await screen.findByText("photos");

    const calcBtn = screen.getByLabelText("Calculate size of photos");
    await user.click(calcBtn);

    await waitFor(() =>
      expect(listKeysUnderMock).toHaveBeenCalledWith(
        "c1",
        "my-bucket",
        "photos/",
      ),
    );
    await screen.findByText("3.0 KB");
  });
});

describe("ObjectBrowser Name column resizing", () => {
  it("persists resized Name column width in localStorage", async () => {
    render(<ObjectBrowser />);
    await screen.findByText("report.pdf");

    const resizeHandle = screen.getByLabelText("Resize Name column");
    fireEvent.mouseDown(resizeHandle, { clientX: 300 });
    fireEvent.mouseMove(window, { clientX: 420 });
    fireEvent.mouseUp(window);

    const stored = window.localStorage.getItem(
      "bucketdock.objectBrowser.nameColWidth",
    );
    expect(stored).not.toBeNull();
    expect(Number(stored)).toBeGreaterThan(360);
  });

  it("persists resized Type/Storage/Size/Modified column widths", async () => {
    render(<ObjectBrowser />);
    await screen.findByText("report.pdf");

    const cases = [
      {
        label: "Resize Type column",
        key: "bucketdock.objectBrowser.typeColWidth",
        baseline: 140,
      },
      {
        label: "Resize Storage column",
        key: "bucketdock.objectBrowser.storageColWidth",
        baseline: 140,
      },
      {
        label: "Resize Size column",
        key: "bucketdock.objectBrowser.sizeColWidth",
        baseline: 110,
      },
      {
        label: "Resize Modified column",
        key: "bucketdock.objectBrowser.modifiedColWidth",
        baseline: 170,
      },
    ] as const;

    for (const c of cases) {
      const resizeHandle = screen.getByLabelText(c.label);
      fireEvent.mouseDown(resizeHandle, { clientX: 200 });
      fireEvent.mouseMove(window, { clientX: 260 });
      fireEvent.mouseUp(window);

      const stored = window.localStorage.getItem(c.key);
      expect(stored).not.toBeNull();
      expect(Number(stored)).toBeGreaterThan(c.baseline);
    }
  });
});

describe("ObjectBrowser table layout stability", () => {
  it("keeps header checkbox column width fixed while resizing Name", async () => {
    render(<ObjectBrowser />);
    await screen.findByText("report.pdf");

    const selectAll = screen.getByLabelText("Select all");
    const selectAllHeader = selectAll.closest("th");
    expect(selectAllHeader).not.toBeNull();
    expect(selectAllHeader).toHaveStyle({ width: "44px" });

    const nameResize = screen.getByLabelText("Resize Name column");
    fireEvent.mouseDown(nameResize, { clientX: 320 });
    fireEvent.mouseMove(window, { clientX: 460 });
    fireEvent.mouseUp(window);

    expect(selectAllHeader).toHaveStyle({ width: "44px" });
  });

  it("shows folder loading inline in the folder row without adding an extra loading row", async () => {
    const user = userEvent.setup();
    let resolveChildren:
      | ((value: { folders: string[]; files: unknown[] }) => void)
      | null = null;
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
          return await new Promise((resolve) => {
            resolveChildren = resolve;
          });
        }
        return { folders: [], files: [] };
      },
    );

    render(<ObjectBrowser />);
    await screen.findByText("report.pdf");
    const rowsBefore = document.querySelectorAll("tbody tr").length;
    expect(rowsBefore).toBe(2);

    await user.click(await screen.findByTestId("disclosure-photos/"));

    const folderRow = await screen.findByTestId("folder-row-photos/");
    expect(folderRow).toHaveTextContent("Loading…");
    expect(document.querySelectorAll("tbody tr").length).toBe(2);

    await act(async () => {
      resolveChildren?.({ folders: ["photos/2024/"], files: [] });
    });
    await waitFor(() =>
      expect(screen.getByTestId("folder-row-photos/")).not.toHaveTextContent(
        "Loading…",
      ),
    );
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

    await screen.findByText("report.pdf");
    await user.click(screen.getByLabelText("Select report.pdf"));

    expect(await screen.findByTestId("selection-count")).toHaveTextContent(
      "1 selected",
    );
  });
});

describe("ObjectBrowser delete flow", () => {
  it("enqueues a tracked delete instead of calling the backend directly", async () => {
    const user = userEvent.setup();
    render(<ObjectBrowser />);

    // Select the file row via its checkbox and open its context menu to trigger Delete.
    const fileName = await screen.findByText("report.pdf");
    await user.click(screen.getByLabelText("Select report.pdf"));
    await user.pointer({ keys: "[MouseRight>]", target: fileName });

    const deleteItem = await screen.findByText("Delete");
    await user.click(deleteItem);

    // Confirm in the modal.
    const confirm = await screen.findByRole("button", { name: "Delete" });
    await user.click(confirm);

    await waitFor(() => expect(enqueueDeleteMock).toHaveBeenCalledTimes(1));
    expect(enqueueDeleteMock.mock.calls[0][0]).toMatchObject({
      connectionId: "c1",
      bucket: "my-bucket",
      keys: ["report.pdf"],
      prefixes: [],
      name: "report.pdf",
    });
  });

  it("does not offer 'Open in browser' for file rows", async () => {
    const user = userEvent.setup();
    render(<ObjectBrowser />);

    const fileName = await screen.findByText("report.pdf");
    await user.pointer({ keys: "[MouseRight>]", target: fileName });

    // The legacy menu entry generated presigned URLs and frequently
    // failed for path-style endpoints — it has been removed entirely.
    expect(screen.queryByText("Open in browser")).not.toBeInTheDocument();
  });
});

describe("ObjectBrowser row layout", () => {
  it("keeps file row cells on a single line", async () => {
    render(<ObjectBrowser />);
    const fileName = await screen.findByText("report.pdf");
    // The name cell and its sibling metadata cells must not wrap — long
    // sizes like "414 B" were breaking across two lines on narrow widths.
    const row =
      fileName.closest("[data-testid='file-row']") ??
      fileName.closest("tr") ??
      fileName.parentElement;
    expect(row).not.toBeNull();
    const cells = row!.querySelectorAll(".whitespace-nowrap");
    expect(cells.length).toBeGreaterThan(0);
  });
});
