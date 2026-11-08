import { act, fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Keep these tests focused on the shell's layout and persistence behavior.
vi.mock("./connections-sidebar", () => ({ default: () => null }));
vi.mock("./object-browser", () => ({ default: () => null }));
vi.mock("./transfer-queue", () => ({ default: () => null }));
vi.mock("@/lib/tauri", () => ({
  isTauri: () => false,
  listConnections: vi.fn(),
}));

import AppShell from "./app-shell";

const SIDEBAR_KEY = "bucketdock.sidebarWidth";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AppShell sidebar", () => {
  it("restores a saved width after hydration without a markup mismatch", async () => {
    window.localStorage.setItem(SIDEBAR_KEY, "340");
    const container = document.createElement("div");
    container.innerHTML = renderToString(<AppShell />);
    document.body.appendChild(container);
    expect(container.querySelector("aside")).toHaveStyle({ width: "260px" });

    const onRecoverableError = vi.fn();
    const root = hydrateRoot(container, <AppShell />, { onRecoverableError });
    try {
      await act(async () => {});
      expect(container.querySelector("aside")).toHaveStyle({ width: "340px" });
      expect(onRecoverableError).not.toHaveBeenCalled();
    } finally {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    }
  });

  it.each([
    ["100", "180px"],
    ["900", "520px"],
    ["invalid", "260px"],
  ])("handles a stored width of %s safely", (stored, expected) => {
    window.localStorage.setItem(SIDEBAR_KEY, stored);
    render(<AppShell />);
    expect(screen.getByRole("complementary")).toHaveStyle({ width: expected });
  });

  it("persists a dragged width and restores the default on double-click", () => {
    const { unmount } = render(<AppShell />);
    fireEvent.mouseDown(
      screen.getByRole("separator", { name: "Resize sidebar" }),
    );
    fireEvent.mouseMove(document, { clientX: 400 });
    fireEvent.mouseUp(document);

    expect(screen.getByRole("complementary")).toHaveStyle({ width: "400px" });
    expect(window.localStorage.getItem(SIDEBAR_KEY)).toBe("400");
    expect(document.body.style.cursor).toBe("");
    expect(document.body.style.userSelect).toBe("");

    unmount();
    render(<AppShell />);
    expect(screen.getByRole("complementary")).toHaveStyle({ width: "400px" });

    fireEvent.doubleClick(
      screen.getByRole("separator", { name: "Resize sidebar" }),
    );
    expect(screen.getByRole("complementary")).toHaveStyle({ width: "260px" });
    expect(window.localStorage.getItem(SIDEBAR_KEY)).toBe("260");
  });

  it("still renders and resizes when local storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Storage unavailable", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage unavailable", "SecurityError");
    });

    render(<AppShell />);
    expect(screen.getByRole("complementary")).toHaveStyle({ width: "260px" });
    fireEvent.mouseDown(
      screen.getByRole("separator", { name: "Resize sidebar" }),
    );
    fireEvent.mouseMove(document, { clientX: 350 });
    fireEvent.mouseUp(document);
    expect(screen.getByRole("complementary")).toHaveStyle({ width: "350px" });
  });
});
