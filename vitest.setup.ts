import "@testing-library/jest-dom/vitest";

// jsdom doesn't implement ResizeObserver, which the OverflowToolbar (and
// any consumer that mounts it) relies on. Provide a no-op shim so tests
// can render those components.
if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverShim {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = ResizeObserverShim;
}
