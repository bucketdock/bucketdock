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
      back: [],
      forward: [],
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

describe("useAppStore back/forward history", () => {
  it("navigateInto pushes onto the back stack and clears forward", () => {
    const s = useAppStore.getState();
    s.navigateInto("a/");
    s.navigateInto("b/");
    const st = useAppStore.getState();
    expect(st.prefix).toBe("a/b/");
    expect(st.back).toEqual(["", "a/"]);
    expect(st.forward).toEqual([]);
  });

  it("goBack pops back, restores previous prefix, and pushes onto forward", () => {
    const s = useAppStore.getState();
    s.navigateInto("a/");
    s.navigateInto("b/");
    s.goBack();
    let st = useAppStore.getState();
    expect(st.prefix).toBe("a/");
    expect(st.back).toEqual([""]);
    expect(st.forward).toEqual(["a/b/"]);

    s.goBack();
    st = useAppStore.getState();
    expect(st.prefix).toBe("");
    expect(st.back).toEqual([]);
    expect(st.forward).toEqual(["a/", "a/b/"]);
  });

  it("goBack at the start of history is a no-op", () => {
    const s = useAppStore.getState();
    s.goBack();
    const st = useAppStore.getState();
    expect(st.prefix).toBe("");
    expect(st.back).toEqual([]);
    expect(st.forward).toEqual([]);
  });

  it("goForward replays the most recent goBack", () => {
    const s = useAppStore.getState();
    s.navigateInto("a/");
    s.navigateInto("b/");
    s.goBack();
    s.goForward();
    const st = useAppStore.getState();
    expect(st.prefix).toBe("a/b/");
    expect(st.back).toEqual(["", "a/"]);
    expect(st.forward).toEqual([]);
  });

  it("a fresh navigation after goBack drops the forward stack", () => {
    const s = useAppStore.getState();
    s.navigateInto("a/");
    s.navigateInto("b/");
    s.goBack(); // now at "a/", forward=["a/b/"]
    s.navigateInto("c/"); // diverge
    const st = useAppStore.getState();
    expect(st.prefix).toBe("a/c/");
    expect(st.forward).toEqual([]);
    expect(st.back).toEqual(["", "a/"]);
  });

  it("navigateUp and navigateToBreadcrumb both push history", () => {
    const s = useAppStore.getState();
    s.setPrefix("a/b/c/");
    s.navigateUp();
    expect(useAppStore.getState().prefix).toBe("a/b/");
    s.navigateToBreadcrumb(0);
    expect(useAppStore.getState().prefix).toBe("a/");
    s.goBack();
    expect(useAppStore.getState().prefix).toBe("a/b/");
    s.goBack();
    expect(useAppStore.getState().prefix).toBe("a/b/c/");
  });

  it("navigating to the same prefix does not pollute history", () => {
    const s = useAppStore.getState();
    s.setPrefix("a/");
    s.setPrefix("a/");
    expect(useAppStore.getState().back).toEqual([""]);
  });

  it("selectBucket and selectConnection reset the history stacks", () => {
    const s = useAppStore.getState();
    s.navigateInto("a/");
    s.navigateInto("b/");
    s.selectBucket("other-bucket");
    let st = useAppStore.getState();
    expect(st.prefix).toBe("");
    expect(st.back).toEqual([]);
    expect(st.forward).toEqual([]);

    s.navigateInto("x/");
    s.selectConnection("c2");
    st = useAppStore.getState();
    expect(st.prefix).toBe("");
    expect(st.back).toEqual([]);
    expect(st.forward).toEqual([]);
  });
});
