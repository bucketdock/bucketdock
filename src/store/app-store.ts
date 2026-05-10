import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { Connection, BucketInfo } from "@/lib/tauri";

interface AppStore {
  // ── State ──────────────────────────────────────────────────────────────────
  connections: Connection[];
  selectedConnectionId: string | null;
  selectedBucket: string | null;
  /** Current folder prefix — no leading slash, trailing slash if non-empty */
  prefix: string;
  /**
   * Finder-style back/forward history of prior prefixes within the current
   * connection+bucket. `back` holds older entries (oldest first); `forward`
   * holds entries reachable by pressing the right-arrow (next-most-recent
   * first). Both are cleared whenever the bucket or connection changes.
   */
  back: string[];
  forward: string[];
  /** Buckets keyed by connection id */
  buckets: Record<string, BucketInfo[]>;

  // ── Connection actions ─────────────────────────────────────────────────────
  setConnections: (list: Connection[]) => void;
  addConnectionLocal: (conn: Connection) => void;
  updateConnectionLocal: (conn: Connection) => void;
  removeConnectionLocal: (id: string) => void;

  // ── Navigation actions ─────────────────────────────────────────────────────
  selectConnection: (id: string | null) => void;
  selectBucket: (name: string | null) => void;
  setPrefix: (prefix: string) => void;
  navigateInto: (folder: string) => void;
  navigateUp: () => void;
  navigateToBreadcrumb: (idx: number) => void;
  goBack: () => void;
  goForward: () => void;

  // ── Bucket actions ─────────────────────────────────────────────────────────
  setBuckets: (connId: string, list: BucketInfo[]) => void;
}

/**
 * Compute a state patch that pushes the current prefix onto `back` and
 * clears `forward` — the standard browser-history behavior whenever the
 * user explicitly navigates somewhere new. No-ops when the destination
 * prefix is identical to the current one.
 */
function pushHistory(
  current: { prefix: string; back: string[] },
  nextPrefix: string,
): { prefix: string; back: string[]; forward: string[] } {
  if (current.prefix === nextPrefix) {
    return { prefix: nextPrefix, back: current.back, forward: [] };
  }
  return {
    prefix: nextPrefix,
    back: [...current.back, current.prefix],
    forward: [],
  };
}

export const useAppStore = create<AppStore>()(
  persist(
    (set, get) => ({
      connections: [],
      selectedConnectionId: null,
      selectedBucket: null,
      prefix: "",
      back: [],
      forward: [],
      buckets: {},

      setConnections: (list) => set({ connections: list }),

      addConnectionLocal: (conn) =>
        set((s) => ({ connections: [...s.connections, conn] })),

      updateConnectionLocal: (conn) =>
        set((s) => ({
          connections: s.connections.map((c) => (c.id === conn.id ? conn : c)),
        })),

      removeConnectionLocal: (id) =>
        set((s) => ({
          connections: s.connections.filter((c) => c.id !== id),
          selectedConnectionId:
            s.selectedConnectionId === id ? null : s.selectedConnectionId,
          selectedBucket:
            s.selectedConnectionId === id ? null : s.selectedBucket,
        })),

      selectConnection: (id) =>
        set({
          selectedConnectionId: id,
          selectedBucket: null,
          prefix: "",
          back: [],
          forward: [],
        }),

      selectBucket: (name) =>
        set({ selectedBucket: name, prefix: "", back: [], forward: [] }),

      setPrefix: (prefix) => set((s) => pushHistory(s, prefix)),

      navigateInto: (folder) => set((s) => pushHistory(s, s.prefix + folder)),

      navigateUp: () =>
        set((s) => {
          if (!s.prefix) return {};
          const parts = s.prefix.replace(/\/$/, "").split("/");
          parts.pop();
          const next = parts.length ? parts.join("/") + "/" : "";
          return pushHistory(s, next);
        }),

      navigateToBreadcrumb: (idx) =>
        set((s) => {
          if (idx < 0) return pushHistory(s, "");
          const parts = s.prefix
            .replace(/\/$/, "")
            .split("/")
            .slice(0, idx + 1);
          return pushHistory(s, parts.join("/") + "/");
        }),

      goBack: () =>
        set((s) => {
          if (s.back.length === 0) return {};
          const prev = s.back[s.back.length - 1];
          return {
            prefix: prev,
            back: s.back.slice(0, -1),
            forward: [s.prefix, ...s.forward],
          };
        }),

      goForward: () =>
        set((s) => {
          if (s.forward.length === 0) return {};
          const next = s.forward[0];
          return {
            prefix: next,
            forward: s.forward.slice(1),
            back: [...s.back, s.prefix],
          };
        }),

      setBuckets: (connId, list) =>
        set((s) => ({ buckets: { ...s.buckets, [connId]: list } })),
    }),
    {
      name: "bucketdock-app-store",
      storage: createJSONStorage(() =>
        typeof window !== "undefined"
          ? localStorage
          : { getItem: () => null, setItem: () => {}, removeItem: () => {} },
      ),
      // Only persist navigation state, not derived/fetched data.
      // History stacks are intentionally *not* persisted: a fresh app launch
      // starts with no back/forward, just like a fresh Finder window.
      partialize: (s) => ({
        selectedConnectionId: s.selectedConnectionId,
        selectedBucket: s.selectedBucket,
        prefix: s.prefix,
      }),
    },
  ),
);
