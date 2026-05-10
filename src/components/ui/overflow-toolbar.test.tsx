import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  OverflowToolbar,
  type OverflowItem,
} from "@/components/ui/overflow-toolbar";

// We drive the layout by stubbing element widths; jsdom returns 0 for
// `offsetWidth` and `clientWidth`. The component reads those properties
// each time it recomputes, so updating the underlying value lets us
// simulate a container shrinking.

const widthByTestId: Record<string, number> = {};
let containerWidth = 1000;

beforeEach(() => {
  containerWidth = 1000;
  for (const key of Object.keys(widthByTestId)) delete widthByTestId[key];

  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get() {
      if (this.dataset?.testid === "overflow-toolbar") return containerWidth;
      return widthByTestId[this.dataset?.testid ?? ""] ?? 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get() {
      const own = this.dataset?.measureWidth;
      if (own) return Number(own);
      // The component wraps each measurement clone in a <span> wrapper,
      // so let the wrapper inherit its child's reported width.
      const child = this.querySelector?.(
        "[data-measure-width]",
      ) as HTMLElement | null;
      if (child) return Number(child.dataset.measureWidth ?? "0");
      return 0;
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makeItems(): OverflowItem[] {
  return [
    {
      key: "a",
      priority: 100,
      menu: { label: "Item A", onClick: vi.fn() },
      render: () => (
        <button data-measure-width="100" data-testid="item-a">
          A
        </button>
      ),
    },
    {
      key: "b",
      priority: 50,
      menu: { label: "Item B", onClick: vi.fn() },
      render: () => (
        <button data-measure-width="100" data-testid="item-b">
          B
        </button>
      ),
    },
    {
      key: "c",
      priority: 10,
      menu: { label: "Item C", onClick: vi.fn() },
      render: () => (
        <button data-measure-width="100" data-testid="item-c">
          C
        </button>
      ),
    },
    {
      key: "pinned",
      // No `menu` field => pinned, never moves into overflow.
      render: () => (
        <button data-measure-width="50" data-testid="item-pinned">
          Pin
        </button>
      ),
    },
  ];
}

/** The visible row is the first child div of the toolbar; the
 *  off-screen measurement copy comes second. We scope queries to the
 *  visible row to avoid double-matches against the measurement nodes. */
function visibleRow(): HTMLElement {
  const toolbar = screen.getByTestId("overflow-toolbar");
  return toolbar.firstElementChild as HTMLElement;
}

describe("OverflowToolbar", () => {
  it("renders every overflowable item inline when there is plenty of room", () => {
    containerWidth = 1000;
    render(<OverflowToolbar items={makeItems()} />);
    const row = visibleRow();
    expect(within(row).getByTestId("item-a")).toBeInTheDocument();
    expect(within(row).getByTestId("item-b")).toBeInTheDocument();
    expect(within(row).getByTestId("item-c")).toBeInTheDocument();
    expect(within(row).getByTestId("item-pinned")).toBeInTheDocument();
    // No overflow trigger when nothing has been dropped.
    expect(within(row).queryByTestId("overflow-menu-trigger")).toBeNull();
  });

  it("drops the lowest-priority overflowable item when the toolbar is too narrow", async () => {
    // Three 100px items + 50px pin + 32px trigger reservation = 382. A
    // container of 250 forces the lowest-priority items to overflow.
    containerWidth = 250;
    const user = userEvent.setup();
    render(<OverflowToolbar items={makeItems()} />);

    // The component re-measures on layout effect; rendering is enough.
    await act(async () => {});

    const row = visibleRow();
    // The pinned item must always be visible, even when narrow.
    expect(within(row).getByTestId("item-pinned")).toBeInTheDocument();

    const trigger = within(row).getByTestId("overflow-menu-trigger");
    await user.click(trigger);
    const menu = await screen.findByTestId("overflow-menu");
    // Lowest priority (Item C) is the first to overflow.
    expect(menu).toHaveTextContent("Item C");
    // The highest-priority overflowable item (A) should still be inline.
    expect(within(row).queryByTestId("item-a")).not.toBeNull();
  });

  it("invokes the menu callback when an overflowed entry is clicked", async () => {
    containerWidth = 100; // very narrow — everything overflowable hides
    const user = userEvent.setup();
    const onClickC = vi.fn();
    const items = makeItems();
    items[2].menu = { label: "Item C", onClick: onClickC };

    render(<OverflowToolbar items={items} />);
    await act(async () => {});

    const row = visibleRow();
    const trigger = within(row).getByTestId("overflow-menu-trigger");
    await user.click(trigger);
    const menu = await screen.findByTestId("overflow-menu");
    await user.click(within(menu).getByRole("menuitem", { name: "Item C" }));
    expect(onClickC).toHaveBeenCalledTimes(1);
  });
});
