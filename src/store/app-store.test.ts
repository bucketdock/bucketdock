import { describe, it, expect, beforeEach } from "vitest";
import { useAppStore } from "./app-store";

const initial = useAppStore.getState();

beforeEach(() => {
  // Reset persisted/in-memory store between tests so each test is isolated.
  useAppStore.setState(
    {
      ...initial,
      connections: [],
      selectedConnectionId: null,
      selectedBucket: null,
      prefix: "",
      buckets: {},
    },
    true,
  );
});

describe("useAppStore navigation", () => {
  it("navigateInto appends to prefix", () => {
    useAppStore.getState().setPrefix("a/");
    useAppStore.getState().navigateInto("b/");
    expect(useAppStore.getState().prefix).toBe("a/b/");
  });

  it("navigateUp pops one level", () => {
    useAppStore.getState().setPrefix("a/b/c/");
    useAppStore.getState().navigateUp();
    expect(useAppStore.getState().prefix).toBe("a/b/");
    useAppStore.getState().navigateUp();
    expect(useAppStore.getState().prefix).toBe("a/");
    useAppStore.getState().navigateUp();
    expect(useAppStore.getState().prefix).toBe("");
    // Already at root, must remain root.
    useAppStore.getState().navigateUp();
    expect(useAppStore.getState().prefix).toBe("");
  });

  it("navigateToBreadcrumb truncates at the chosen index", () => {
    useAppStore.getState().setPrefix("a/b/c/d/");
    useAppStore.getState().navigateToBreadcrumb(1); // keep a/b
    expect(useAppStore.getState().prefix).toBe("a/b/");
    useAppStore.getState().navigateToBreadcrumb(-1); // root
    expect(useAppStore.getState().prefix).toBe("");
  });

  it("selectBucket resets the prefix to root", () => {
    useAppStore.getState().setPrefix("deep/path/");
    useAppStore.getState().selectBucket("my-bucket");
    expect(useAppStore.getState().selectedBucket).toBe("my-bucket");
    expect(useAppStore.getState().prefix).toBe("");
  });

  it("selectConnection clears bucket and prefix", () => {
    useAppStore.setState({
      selectedConnectionId: "x",
      selectedBucket: "old",
      prefix: "old/path/",
    });
    useAppStore.getState().selectConnection("y");
    expect(useAppStore.getState().selectedConnectionId).toBe("y");
    expect(useAppStore.getState().selectedBucket).toBeNull();
    expect(useAppStore.getState().prefix).toBe("");
  });

  it("setBuckets is keyed per connection", () => {
    useAppStore
      .getState()
      .setBuckets("c1", [{ name: "a", creation_date: null }]);
    useAppStore
      .getState()
      .setBuckets("c2", [{ name: "b", creation_date: null }]);
    expect(useAppStore.getState().buckets["c1"]).toHaveLength(1);
    expect(useAppStore.getState().buckets["c2"]).toHaveLength(1);
    expect(useAppStore.getState().buckets["c1"][0].name).toBe("a");
  });
});
