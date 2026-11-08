import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BucketInfo, Connection } from "@/lib/tauri";

const { listBucketsMock } = vi.hoisted(() => ({ listBucketsMock: vi.fn() }));
vi.mock("@/lib/tauri", async () => ({
  ...(await vi.importActual<typeof import("@/lib/tauri")>("@/lib/tauri")),
  listBuckets: listBucketsMock,
  isTauri: () => true,
}));

import BucketsPane from "./buckets-pane";
import { useAppStore } from "@/store/app-store";

const connections: Connection[] = ["c1", "c2"].map((id) => ({
  id,
  name: id === "c1" ? "First connection" : "Second connection",
  provider: "aws",
  endpoint: null,
  region: "us-east-1",
  access_key_id: "TEST_KEY",
  bucket_filter: null,
}));

beforeEach(() => {
  listBucketsMock.mockReset();
  listBucketsMock.mockResolvedValue([]);
  window.localStorage.clear();
  useAppStore.setState({
    connections,
    selectedConnectionId: "c1",
    selectedBucket: null,
    prefix: "",
    back: [],
    forward: [],
    buckets: {},
  });
});

describe("BucketsPane", () => {
  it("uses cached buckets until refreshed and lets the user select a new bucket", async () => {
    const user = userEvent.setup();
    useAppStore.setState({
      buckets: { c1: [{ name: "cached-bucket", creation_date: null }] },
    });
    let resolveRefresh!: (buckets: BucketInfo[]) => void;
    listBucketsMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRefresh = resolve;
      }),
    );
    render(<BucketsPane connectionId="c1" />);
    expect(screen.getByRole("button", { name: "cached-bucket" })).toBeVisible();
    expect(listBucketsMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Refresh buckets" }));
    expect(listBucketsMock).toHaveBeenCalledWith("c1");
    expect(screen.getByRole("button", { name: "cached-bucket" })).toBeVisible();

    const updated = [{ name: "new-bucket", creation_date: null }];
    await act(async () => {
      resolveRefresh(updated);
    });
    expect(
      screen.queryByRole("button", { name: "cached-bucket" }),
    ).not.toBeInTheDocument();
    expect(useAppStore.getState().buckets.c1).toEqual(updated);
    await user.click(screen.getByRole("button", { name: "new-bucket" }));
    expect(useAppStore.getState().selectedBucket).toBe("new-bucket");
  });

  it("explains a scoped-credentials error and recovers after retry", async () => {
    const user = userEvent.setup();
    listBucketsMock.mockRejectedValueOnce(
      new Error("AccessDenied: ListBuckets"),
    );
    render(<BucketsPane connectionId="c1" />);
    expect(
      await screen.findByText("These credentials can’t list buckets"),
    ).toBeVisible();

    const buckets = [{ name: "recovered-bucket", creation_date: null }];
    listBucketsMock.mockResolvedValueOnce(buckets);
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(
      await screen.findByRole("button", { name: "recovered-bucket" }),
    ).toBeVisible();
    expect(
      screen.queryByText("These credentials can’t list buckets"),
    ).not.toBeInTheDocument();
    expect(useAppStore.getState().buckets.c1).toEqual(buckets);
    expect(listBucketsMock).toHaveBeenCalledTimes(2);
  });

  it("clears the previous connection's error while the next connection loads", async () => {
    listBucketsMock.mockRejectedValueOnce(new Error("AccessDenied"));
    const { rerender } = render(<BucketsPane connectionId="c1" />);
    await screen.findByText("These credentials can’t list buckets");

    let resolveNext!: (buckets: BucketInfo[]) => void;
    listBucketsMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveNext = resolve;
      }),
    );
    rerender(<BucketsPane connectionId="c2" />);
    expect(screen.getByText("Second connection")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    expect(listBucketsMock).toHaveBeenLastCalledWith("c2");

    await act(async () => {
      resolveNext([]);
    });
    expect(screen.getByText("No buckets visible")).toBeVisible();
  });

  it("ignores a late failure from the previous connection when the next one is cached", async () => {
    let rejectOld!: (error: Error) => void;
    listBucketsMock.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectOld = reject;
      }),
    );
    useAppStore.setState({
      buckets: { c2: [{ name: "second-bucket", creation_date: null }] },
    });
    const { rerender } = render(<BucketsPane connectionId="c1" />);
    rerender(<BucketsPane connectionId="c2" />);
    await act(async () => {
      rejectOld(new Error("AccessDenied"));
    });

    expect(screen.getByRole("button", { name: "second-bucket" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    expect(listBucketsMock).toHaveBeenCalledTimes(1);
  });
});
