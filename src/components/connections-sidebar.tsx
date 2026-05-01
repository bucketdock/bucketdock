'use client';

import * as React from 'react';
import { Plus, Cloud, Zap, Server, HardDrive, Edit2, Trash2, Wifi, MoreHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { ContextMenu, type ContextMenuItem } from '@/components/ui/context-menu';
import { useAppStore } from '@/store/app-store';
import { isTauri, listBuckets, listObjects, type Connection } from '@/lib/tauri';
import { cn } from '@/lib/cn';
import ConnectionFormModal from './connection-form-modal';
import DeleteConnectionConfirm from './delete-connection-confirm';

function ProviderIcon({ provider }: { provider: string }) {
  if (provider === 'aws') return <Cloud className="w-3.5 h-3.5 shrink-0" />;
  if (provider === 'r2') return <Zap className="w-3.5 h-3.5 shrink-0" />;
  return <Server className="w-3.5 h-3.5 shrink-0" />;
}

export default function ConnectionsSidebar() {
  const connections = useAppStore((s) => s.connections);
  const selectedConnectionId = useAppStore((s) => s.selectedConnectionId);
  const selectedBucket = useAppStore((s) => s.selectedBucket);
  const buckets = useAppStore((s) => s.buckets);

  const [addOpen, setAddOpen] = React.useState(false);
  const [editConn, setEditConn] = React.useState<Connection | null>(null);
  const [deleteConn, setDeleteConn] = React.useState<Connection | null>(null);
  const [contextMenu, setContextMenu] = React.useState<{
    position: { x: number; y: number };
    conn: Connection;
  } | null>(null);

  // Track in-flight bucket fetches via ref to avoid effect re-entry
  const fetchingRef = React.useRef<Set<string>>(new Set());
  const [loadingIds, setLoadingIds] = React.useState<Set<string>>(new Set());
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  React.useEffect(() => {
    if (!selectedConnectionId) return;
    if (useAppStore.getState().buckets[selectedConnectionId]) return;
    if (fetchingRef.current.has(selectedConnectionId)) return;

    const id = selectedConnectionId;
    fetchingRef.current.add(id);
    setLoadingIds((prev) => { const s = new Set(prev); s.add(id); return s; });

    listBuckets(id)
      .then((list) => {
        useAppStore.getState().setBuckets(id, list);
        // Auto-select the bucket if there's exactly one
        if (list.length === 1 && !useAppStore.getState().selectedBucket) {
          useAppStore.getState().selectBucket(list[0].name);
          useAppStore.getState().setPrefix('');
        }
      })
      .catch((err: unknown) =>
        toast.error(`Failed to load buckets: ${err instanceof Error ? err.message : String(err)}`)
      )
      .finally(() => {
        fetchingRef.current.delete(id);
        setLoadingIds((prev) => { const s = new Set(prev); s.delete(id); return s; });
      });
  }, [selectedConnectionId]);

  function handleConnectionClick(id: string) {
    useAppStore.getState().selectConnection(id);
  }

  function handleBucketClick(name: string) {
    useAppStore.getState().selectBucket(name);
    useAppStore.getState().setPrefix('');
  }

  function handleContextMenu(e: React.MouseEvent, conn: Connection) {
    e.preventDefault();
    setContextMenu({ position: { x: e.clientX, y: e.clientY }, conn });
  }

  const contextItems: ContextMenuItem[] = contextMenu
    ? [
        {
          label: 'Edit',
          icon: <Edit2 className="w-3.5 h-3.5" />,
          onClick: () => setEditConn(contextMenu.conn),
        },
        {
          label: 'Test',
          icon: <Wifi className="w-3.5 h-3.5" />,
          onClick: () => {
            const id = contextMenu.conn.id;
            listBuckets(id)
              .then(async (list) => {
                if (list.length > 0) {
                  await listObjects(id, list[0].name, '');
                }
                toast.success(`Found ${list.length} bucket${list.length !== 1 ? 's' : ''}`);
              })
              .catch((err: unknown) =>
                toast.error(`Test failed: ${err instanceof Error ? err.message : String(err)}`)
              );
          },
        },
        {
          label: 'Delete',
          icon: <Trash2 className="w-3.5 h-3.5" />,
          danger: true,
          onClick: () => setDeleteConn(contextMenu.conn),
        },
      ]
    : [];

  return (
    <div className="flex flex-col">
      {/* Dev banner */}
      {mounted && !isTauri() && (
        <div className="px-3 py-2 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800">
          Run via <code className="font-mono">pnpm tauri dev</code>
        </div>
      )}

      {/* Section header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-black/8 dark:border-white/8">
        <span className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">
          Connections
        </span>
        <Button variant="ghost" size="icon" onClick={() => setAddOpen(true)} aria-label="Add connection">
          <Plus className="w-4 h-4" />
        </Button>
      </div>

      {/* Connection list */}
      <div className="py-1">
        {connections.length === 0 ? (
          <EmptyState
            title="No connections yet."
            description="Click + to add one."
            className="py-12"
          />
        ) : (
          connections.map((conn) => {
            const isSelected = conn.id === selectedConnectionId;
            const isLoading = loadingIds.has(conn.id);
            const connBuckets = buckets[conn.id] ?? null;
            const filteredBuckets = connBuckets;

            return (
              <div key={conn.id}>
                {/* Connection row */}
                <div
                  className={cn(
                    'group relative w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer',
                    isSelected &&
                      'bg-[#007AFF]/12 dark:bg-[#007AFF]/20 text-[#007AFF] font-medium',
                  )}
                  onClick={() => handleConnectionClick(conn.id)}
                  onContextMenu={(e) => handleContextMenu(e, conn)}
                >
                  <ProviderIcon provider={conn.provider} />
                  <span className="flex-1 truncate">{conn.name}</span>
                  <button
                    type="button"
                    aria-label="Connection actions"
                    onClick={(e) => {
                      e.stopPropagation();
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      setContextMenu({
                        position: { x: rect.right, y: rect.bottom },
                        conn,
                      });
                    }}
                    className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10 text-neutral-500 dark:text-neutral-400 transition-opacity"
                  >
                    <MoreHorizontal className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Buckets (nested, shown when selected) */}
                {isSelected && (
                  <div className="pb-1">
                    {isLoading ? (
                      Array.from({ length: 3 }, (_, i) => (
                        <div key={i} className="px-3 py-1.5 pl-8">
                          <Skeleton className="h-4 w-full" />
                        </div>
                      ))
                    ) : filteredBuckets ? (
                      filteredBuckets.length === 0 ? (
                        <div className="px-8 py-2 text-xs text-neutral-400 dark:text-neutral-500">
                          No buckets found
                        </div>
                      ) : (
                        filteredBuckets.map((b) => (
                          <button
                            key={b.name}
                            className={cn(
                              'w-full flex items-center gap-2 px-3 py-1.5 pl-8 text-xs text-left hover:bg-black/5 dark:hover:bg-white/5 transition-colors',
                              selectedBucket === b.name &&
                                'bg-[#007AFF]/8 dark:bg-[#007AFF]/15 text-[#007AFF] font-medium',
                            )}
                            onClick={() => handleBucketClick(b.name)}
                          >
                            <HardDrive className="w-3 h-3 shrink-0 opacity-60" />
                            <span className="flex-1 truncate">{b.name}</span>
                          </button>
                        ))
                      )
                    ) : null}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Context menu */}
      <ContextMenu
        position={contextMenu?.position ?? null}
        items={contextItems}
        onClose={() => setContextMenu(null)}
      />

      {/* Modals */}
      <ConnectionFormModal open={addOpen} onClose={() => setAddOpen(false)} />
      {editConn && (
        <ConnectionFormModal
          open
          onClose={() => setEditConn(null)}
          initial={editConn}
        />
      )}
      <DeleteConnectionConfirm
        open={!!deleteConn}
        onClose={() => setDeleteConn(null)}
        connection={deleteConn}
      />
    </div>
  );
}
