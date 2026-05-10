import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { UploadSplitButton } from "@/components/upload-split-button";

describe("UploadSplitButton", () => {
  it("renders the Upload trigger collapsed by default", () => {
    render(
      <UploadSplitButton onUploadFiles={() => {}} onUploadFolder={() => {}} />,
    );
    expect(screen.getByTestId("upload-button")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.queryByTestId("upload-menu")).not.toBeInTheDocument();
  });

  it("opens the menu on click and closes it again on a second click", async () => {
    const user = userEvent.setup();
    render(
      <UploadSplitButton onUploadFiles={() => {}} onUploadFolder={() => {}} />,
    );
    const trigger = screen.getByTestId("upload-button");

    await user.click(trigger);
    expect(screen.getByTestId("upload-menu")).toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    await user.click(trigger);
    expect(screen.queryByTestId("upload-menu")).not.toBeInTheDocument();
  });

  it("calls onUploadFiles when the Files… item is selected", async () => {
    const user = userEvent.setup();
    const onFiles = vi.fn();
    const onFolder = vi.fn();
    render(
      <UploadSplitButton onUploadFiles={onFiles} onUploadFolder={onFolder} />,
    );
    await user.click(screen.getByTestId("upload-button"));
    await user.click(screen.getByTestId("upload-files"));
    expect(onFiles).toHaveBeenCalledTimes(1);
    expect(onFolder).not.toHaveBeenCalled();
    // Menu auto-closes after a selection.
    expect(screen.queryByTestId("upload-menu")).not.toBeInTheDocument();
  });

  it("calls onUploadFolder when the Folder… item is selected", async () => {
    const user = userEvent.setup();
    const onFiles = vi.fn();
    const onFolder = vi.fn();
    render(
      <UploadSplitButton onUploadFiles={onFiles} onUploadFolder={onFolder} />,
    );
    await user.click(screen.getByTestId("upload-button"));
    await user.click(screen.getByTestId("upload-folder"));
    expect(onFolder).toHaveBeenCalledTimes(1);
    expect(onFiles).not.toHaveBeenCalled();
  });

  it("closes the menu when clicking outside", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <UploadSplitButton onUploadFiles={() => {}} onUploadFolder={() => {}} />
        <button data-testid="outside">outside</button>
      </div>,
    );
    await user.click(screen.getByTestId("upload-button"));
    expect(screen.getByTestId("upload-menu")).toBeInTheDocument();

    await user.click(screen.getByTestId("outside"));
    expect(screen.queryByTestId("upload-menu")).not.toBeInTheDocument();
  });

  it("does not open the menu when disabled", async () => {
    const user = userEvent.setup();
    render(
      <UploadSplitButton
        onUploadFiles={() => {}}
        onUploadFolder={() => {}}
        disabled
      />,
    );
    const trigger = screen.getByTestId("upload-button");
    expect(trigger).toBeDisabled();
    await user.click(trigger);
    expect(screen.queryByTestId("upload-menu")).not.toBeInTheDocument();
  });
});
