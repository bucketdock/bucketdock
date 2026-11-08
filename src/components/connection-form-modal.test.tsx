import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const addConnectionMock = vi.fn();
const updateConnectionMock = vi.fn();
const testConnectionMock = vi.fn();
const listBucketsMock = vi.fn();
const listObjectsMock = vi.fn();

vi.mock("@/lib/tauri", () => ({
  addConnection: (...args: unknown[]) => addConnectionMock(...args),
  updateConnection: (...args: unknown[]) => updateConnectionMock(...args),
  testConnection: (...args: unknown[]) => testConnectionMock(...args),
  listBuckets: (...args: unknown[]) => listBucketsMock(...args),
  listObjects: (...args: unknown[]) => listObjectsMock(...args),
}));

const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}));

import ConnectionFormModal from "@/components/connection-form-modal";
import { useAppStore } from "@/store/app-store";

beforeEach(() => {
  addConnectionMock.mockReset();
  updateConnectionMock.mockReset();
  testConnectionMock.mockReset();
  listBucketsMock.mockReset();
  listObjectsMock.mockReset();
  toastSuccessMock.mockReset();
  toastErrorMock.mockReset();

  useAppStore.setState({
    connections: [],
    selectedConnectionId: null,
    selectedBucket: null,
    prefix: "",
    back: [],
    forward: [],
    buckets: {},
  });
});

function renderCreateModal(onClose = vi.fn()) {
  render(<ConnectionFormModal open onClose={onClose} />);
  return { onClose };
}

describe("ConnectionFormModal", () => {
  it("preserves saved provider settings and clears unsaved credentials on reopen", async () => {
    const user = userEvent.setup();
    const initial = {
      id: "custom-1",
      name: "Existing",
      provider: "custom" as const,
      endpoint: "https://storage.example.com",
      region: "eu-central-1",
      access_key_id: "AKIA",
      bucket_filter: null,
    };
    const props = { onClose: vi.fn(), initial };
    const { rerender } = render(<ConnectionFormModal open {...props} />);

    expect(screen.getByRole("textbox", { name: /Region/i })).toHaveValue("eu-central-1");
    await user.type(screen.getByLabelText(/Secret Access Key/i, { selector: "input" }), "unsaved-secret");
    await user.clear(screen.getByLabelText("Name *"));
    await user.type(screen.getByLabelText("Name *"), "Unsaved name");

    rerender(<ConnectionFormModal open={false} {...props} />);
    rerender(<ConnectionFormModal open {...props} />);

    expect(screen.getByLabelText("Name *")).toHaveValue("Existing");
    expect(screen.getByLabelText(/Secret Access Key/i, { selector: "input" })).toHaveValue("");
    expect(screen.getByRole("textbox", { name: /Region/i })).toHaveValue("eu-central-1");
  });

  it("updates region and R2 endpoint from input changes while allowing a custom endpoint", async () => {
    const user = userEvent.setup();
    renderCreateModal();
    await user.selectOptions(screen.getByLabelText("Provider *"), "r2");
    expect(screen.getByRole("textbox", { name: /Region/i })).toHaveValue("auto");
    await user.type(screen.getByLabelText("Account ID"), "account123");
    const endpoint = screen.getByRole("textbox", { name: /Endpoint/i });
    expect(endpoint).toHaveValue("https://account123.r2.cloudflarestorage.com");

    await user.clear(endpoint);
    await user.type(endpoint, "https://account123.eu.r2.cloudflarestorage.com");
    await user.type(screen.getByLabelText("Name *"), "R2 EU");
    expect(endpoint).toHaveValue("https://account123.eu.r2.cloudflarestorage.com");

    await user.selectOptions(screen.getByLabelText("Provider *"), "aws");
    expect(screen.getByRole("textbox", { name: /Region/i })).toHaveValue("us-east-1");
  });

  it("loads a different connection when the edit target changes while open", () => {
    const initial = {
      id: "c1", name: "First", provider: "aws" as const,
      endpoint: null, region: "eu-west-1", access_key_id: "KEY1", bucket_filter: null,
    };
    const onClose = vi.fn();
    const { rerender } = render(<ConnectionFormModal open onClose={onClose} initial={initial} />);
    rerender(<ConnectionFormModal open onClose={onClose} initial={{ ...initial, id: "c2", name: "Second", region: "eu-west-2" }} />);
    expect(screen.getByLabelText("Name *")).toHaveValue("Second");
    expect(screen.getByRole("textbox", { name: /Region/i })).toHaveValue("eu-west-2");
  });

  it("creates a connection, trims input, and updates local store", async () => {
    const user = userEvent.setup();
    const created = {
      id: "conn-1",
      name: "Prod",
      provider: "aws" as const,
      endpoint: null,
      region: "us-east-1",
      access_key_id: "AKIA",
      bucket_filter: "bucket-a,bucket-b",
    };
    addConnectionMock.mockResolvedValueOnce(created);

    const { onClose } = renderCreateModal();

    await user.type(screen.getByLabelText("Name *"), "  Prod  ");
    const regionInput = screen.getByRole("textbox", { name: /Region/i });
    await user.clear(regionInput);
    await user.type(regionInput, "  us-east-1  ");
    await user.type(
      screen.getByRole("textbox", { name: /Access Key ID/i }),
      "  AKIA  ",
    );
    await user.type(screen.getByPlaceholderText("••••••••"), "  SECRET  ");
    await user.type(
      screen.getByPlaceholderText("my-bucket, another-bucket"),
      " bucket-a,bucket-b ",
    );

    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(addConnectionMock).toHaveBeenCalledTimes(1));
    expect(addConnectionMock).toHaveBeenCalledWith({
      name: "Prod",
      provider: "aws",
      region: "us-east-1",
      endpoint: null,
      access_key_id: "AKIA",
      secret_access_key: "SECRET",
      bucket_filter: "bucket-a,bucket-b",
    });
    expect(useAppStore.getState().connections).toEqual([created]);
    expect(toastSuccessMock).toHaveBeenCalledWith("Connection added");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("uses stored credentials path for edit-mode test when secret is blank", async () => {
    const user = userEvent.setup();
    listBucketsMock.mockResolvedValueOnce([
      { name: "bucket-a", creation_date: null },
    ]);
    listObjectsMock.mockResolvedValueOnce({ folders: [], files: [] });

    const initial = {
      id: "conn-1",
      name: "Existing",
      provider: "aws" as const,
      endpoint: null,
      region: "us-east-1",
      access_key_id: "AKIA",
      bucket_filter: null,
    };

    render(<ConnectionFormModal open onClose={() => {}} initial={initial} />);

    await user.click(screen.getByRole("button", { name: "Test" }));

    await waitFor(() => {
      expect(listBucketsMock).toHaveBeenCalledWith("conn-1");
      expect(listObjectsMock).toHaveBeenCalledWith("conn-1", "bucket-a", "");
    });
    expect(testConnectionMock).not.toHaveBeenCalled();
    expect(toastSuccessMock).toHaveBeenCalledWith("Found 1 bucket");
  });

  it("maps backend errors to friendly save toasts", async () => {
    const user = userEvent.setup();
    addConnectionMock.mockRejectedValueOnce(new Error("AccessDenied: no"));

    renderCreateModal();

    await user.type(screen.getByLabelText("Name *"), "Prod");
    const regionInput = screen.getByRole("textbox", { name: /Region/i });
    await user.clear(regionInput);
    await user.type(regionInput, "us-east-1");
    await user.type(
      screen.getByRole("textbox", { name: /Access Key ID/i }),
      "AKIA",
    );
    await user.type(screen.getByPlaceholderText("••••••••"), "SECRET");
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledTimes(1));
    expect(String(toastErrorMock.mock.calls[0][0])).toContain("Access denied");
    expect(useAppStore.getState().connections).toHaveLength(0);
  });
});
