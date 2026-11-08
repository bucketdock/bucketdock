import { act } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useHydrated } from "./use-hydrated";

function ClientContent() {
  return <span>{useHydrated() ? "Client content" : "Static content"}</span>;
}

it("matches static HTML during hydration before showing client content", async () => {
  const container = document.createElement("div");
  container.innerHTML = renderToString(<ClientContent />);
  expect(container.textContent).toBe("Static content");
  const onRecoverableError = vi.fn();
  const root = hydrateRoot(container, <ClientContent />, { onRecoverableError });
  try {
    await act(async () => {});
    expect(container.textContent).toBe("Client content");
    expect(onRecoverableError).not.toHaveBeenCalled();
  } finally {
    await act(async () => { root.unmount(); });
  }
});
