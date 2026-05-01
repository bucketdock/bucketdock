import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Connection, BucketInfo } from '@/lib/tauri';

interface AppStore {
  // ── State ──────────────────────────────────────────────────────────────────
  connections: Connection[];
  selectedConnectionId: string | null;
  selectedBucket: string | null;
  /** Current folder prefix — no leading slash, trailing slash if non-empty */
  prefix: string;
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

  // ── Bucket actions ─────────────────────────────────────────────────────────
  setBuckets: (connId: string, list: BucketInfo[]) => void;
}

export const useAppStore = create<AppStore>()(
  persist(
    (set, get) => ({
      connections: [],
      selectedConnectionId: null,
      selectedBucket: null,
      prefix: '',
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
          selectedConnectionId: s.selectedConnectionId === id ? null : s.selectedConnectionId,
          selectedBucket: s.selectedConnectionId === id ? null : s.selectedBucket,
        })),

      selectConnection: (id) =>
        set({ selectedConnectionId: id, selectedBucket: null, prefix: '' }),

      selectBucket: (name) => set({ selectedBucket: name, prefix: '' }),

      setPrefix: (prefix) => set({ prefix }),

      navigateInto: (folder) =>
        set((s) => ({ prefix: s.prefix + folder })),

      navigateUp: () =>
        set((s) => {
          if (!s.prefix) return {};
          const parts = s.prefix.replace(/\/$/, '').split('/');
          parts.pop();
          return { prefix: parts.length ? parts.join('/') + '/' : '' };
        }),

      navigateToBreadcrumb: (idx) =>
        set((s) => {
          if (idx < 0) return { prefix: '' };
          const parts = s.prefix.replace(/\/$/, '').split('/').slice(0, idx + 1);
          return { prefix: parts.join('/') + '/' };
        }),

      setBuckets: (connId, list) =>
        set((s) => ({ buckets: { ...s.buckets, [connId]: list } })),
    }),
    {
      name: 'bucketdock-app-store',
      storage: createJSONStorage(() =>
        typeof window !== 'undefined' ? localStorage : { getItem: () => null, setItem: () => {}, removeItem: () => {} },
      ),
      // Only persist navigation state, not derived/fetched data
      partialize: (s) => ({
        selectedConnectionId: s.selectedConnectionId,
        selectedBucket: s.selectedBucket,
        prefix: s.prefix,
      }),
    },
  ),
);
