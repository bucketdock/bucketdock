'use client';

import * as React from 'react';
import {
  RotateCw, FolderPlus, Upload, Download, Trash2,
  Folder, File as FileIcon, ChevronRight, Pencil, ExternalLink, ChevronDown, Info,
} from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNow, format } from 'date-fns';

import {
  listObjects, uploadFile, downloadFile, deleteObject, deleteObjects,
  createFolder, renameObject, getPresignedUrl, isTauri,
  uploadFolder, downloadFolder, deletePrefix,
  type ObjectInfo,
} from '@/lib/tauri';
import { useAppStore } from '@/store/app-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { ContextMenu, type ContextMenuItem } from '@/components/ui/context-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/cn';
import { ObjectInfoModal } from '@/components/object-info-modal';

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes < 1024 ** 4) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${(bytes / 1024 ** 4).toFixed(1)} TB`;
}

function fileBasename(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path;
}

async function collectAllKeys(
  connId: string,
  bucket: string,
  folderPrefix: string,
): Promise<string[]> {
  const keys: string[] = [];
  const page = await listObjects(connId, bucket, folderPrefix);
  for (const f of page.files) keys.push(f.key);
  for (const sub of page.folders) {
    const nested = await collectAllKeys(connId, bucket, sub);
    keys.push(...nested);
  }
  // Include the folder placeholder key itself
  keys.push(folderPrefix);
  return keys;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface ListingState {
  folders: string[];
  files: ObjectInfo[];
  loading: boolean;
  error: string | null;
}

type ModalState =
  | { type: 'delete'; keys: string[] }
  | { type: 'rename'; key: string; currentName: string }
  | { type: 'newFolder' }
  | null;

interface ContextMenuInfo {
  position: { x: number; y: number };
  key: string;
  isFolder: boolean;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ObjectBrowser() {
  const {
    selectedConnectionId: connId,
    selectedBucket: bucket,
    prefix,
    setPrefix,
    navigateInto,
    navigateToBreadcrumb,
  } = useAppStore();

  const [listing, setListing] = React.useState<ListingState>({
    folders: [],
    files: [],
    loading: false,
    error: null,
  });
  const [selection, setSelection] = React.useState<Set<string>>(new Set());
  const [lastSelected, setLastSelected] = React.useState<string | null>(null);
  const [contextMenu, setContextMenu] = React.useState<ContextMenuInfo | null>(null);
  const [modal, setModal] = React.useState<ModalState>(null);
  const [isDragOver, setIsDragOver] = React.useState(false);
  const [renameValue, setRenameValue] = React.useState('');
  const [newFolderValue, setNewFolderValue] = React.useState('');
  const [uploadMenuOpen, setUploadMenuOpen] = React.useState(false);
  const [infoKey, setInfoKey] = React.useState<string | null>(null);

  const containerRef = React.useRef<HTMLDivElement>(null);
  const uploadMenuRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!uploadMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (!uploadMenuRef.current?.contains(e.target as Node)) setUploadMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [uploadMenuOpen]);

  // Stable refs so async callbacks always see current values
  const connIdRef = React.useRef(connId);
  const bucketRef = React.useRef(bucket);
  const prefixRef = React.useRef(prefix);
  React.useEffect(() => { connIdRef.current = connId; }, [connId]);
  React.useEffect(() => { bucketRef.current = bucket; }, [bucket]);
  React.useEffect(() => { prefixRef.current = prefix; }, [prefix]);

  // ── Listing ────────────────────────────────────────────────────────────────

  const fetchListing = React.useCallback(async () => {
    if (!connId || !bucket) return;
    setListing((s) => ({ ...s, loading: true, error: null }));
    setSelection(new Set());
    try {
      const page = await listObjects(connId, bucket, prefix);
      setListing({
        folders: [...page.folders].sort((a, b) => a.localeCompare(b)),
        files: [...page.files].sort((a, b) => a.key.localeCompare(b.key)),
        loading: false,
        error: null,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setListing((s) => ({ ...s, loading: false, error: msg }));
      toast.error(`Failed to list objects: ${msg}`);
    }
  }, [connId, bucket, prefix]);

  React.useEffect(() => {
    fetchListing();
  }, [fetchListing]);

  // ── Derived ────────────────────────────────────────────────────────────────

  const allKeys = React.useMemo(
    () => [...listing.folders, ...listing.files.map((f) => f.key)],
    [listing],
  );

  // ── Drag & drop ────────────────────────────────────────────────────────────

  React.useEffect(() => {
    if (!isTauri()) return;

    let unlistenEnter: (() => void) | null = null;
    let unlistenLeave: (() => void) | null = null;
    let unlistenDrop: (() => void) | null = null;
    let mounted = true;

    (async () => {
      const { listen } = await import('@tauri-apps/api/event');
      if (!mounted) return;

      unlistenEnter = await listen('tauri://drag-enter', () => setIsDragOver(true));
      unlistenLeave = await listen('tauri://drag-leave', () => setIsDragOver(false));
      unlistenDrop = await listen<{ paths: string[]; position: { x: number; y: number } }>(
        'tauri://drag-drop',
        async (event) => {
          setIsDragOver(false);
          const cid = connIdRef.current;
          const bkt = bucketRef.current;
          const pfx = prefixRef.current;
          if (!cid || !bkt) return;

          const paths = event.payload.paths;
          const toastId = toast.loading(`Uploading ${paths.length} file(s)…`);
          let failed = 0;
          for (const filePath of paths) {
            const name = fileBasename(filePath);
            try {
              await uploadFile(cid, bkt, pfx + name, filePath);
            } catch {
              failed++;
            }
          }
          toast.dismiss(toastId);
          if (failed === 0) toast.success(`Uploaded ${paths.length} file(s)`);
          else toast.error(`${paths.length - failed} succeeded, ${failed} failed`);
          fetchListing();
        },
      );
    })();

    return () => {
      mounted = false;
      unlistenEnter?.();
      unlistenLeave?.();
      unlistenDrop?.();
    };
  }, [fetchListing]);

  // ── Selection helpers ──────────────────────────────────────────────────────

  const toggleSelect = (key: string, e: React.MouseEvent) => {
    if (e.shiftKey && lastSelected) {
      const fromIdx = allKeys.indexOf(lastSelected);
      const toIdx = allKeys.indexOf(key);
      if (fromIdx !== -1 && toIdx !== -1) {
        const [lo, hi] = fromIdx < toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx];
        setSelection((s) => new Set([...s, ...allKeys.slice(lo, hi + 1)]));
        return;
      }
    }
    if (e.metaKey || e.ctrlKey) {
      setSelection((s) => {
        const next = new Set(s);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
    } else {
      setSelection(new Set([key]));
    }
    setLastSelected(key);
  };

  const toggleCheckbox = (key: string) => {
    setSelection((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setLastSelected(key);
  };

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    if (e.key === 'Delete' || (e.key === 'Backspace' && selection.size > 0)) {
      e.preventDefault();
      if (selection.size > 0) setModal({ type: 'delete', keys: [...selection] });
    } else if (e.key === 'Enter' && selection.size === 1) {
      const key = [...selection][0];
      if (listing.folders.includes(key)) navigateInto(key.slice(prefix.length));
    } else if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
      e.preventDefault();
      setSelection(new Set(allKeys));
    } else if ((e.metaKey || e.ctrlKey) && e.key === 'i') {
      e.preventDefault();
      const selectedKeys = [...selection];
      if (selectedKeys.length === 1 && !listing.folders.includes(selectedKeys[0])) {
        setInfoKey(selectedKeys[0]);
      }
    }
  };

  // ── Operations ─────────────────────────────────────────────────────────────

  const handleUpload = async () => {
    if (!connId || !bucket) return;
    const { open: dialogOpen } = await import('@tauri-apps/plugin-dialog');
    const result = await dialogOpen({ multiple: true });
    if (!result) return;
    const paths = Array.isArray(result) ? result : [result];
    const toastId = toast.loading(`Uploading ${paths.length} file(s)…`);
    let failed = 0;
    for (const filePath of paths) {
      const name = fileBasename(filePath);
      try {
        await uploadFile(connId, bucket, prefix + name, filePath);
      } catch {
        failed++;
        toast.error(`Failed to upload ${name}`);
      }
    }
    toast.dismiss(toastId);
    if (failed === 0) toast.success(`Uploaded ${paths.length} file(s)`);
    fetchListing();
  };

  const handleUploadFolder = async () => {
    if (!connId || !bucket) return;
    const { open: dialogOpen } = await import('@tauri-apps/plugin-dialog');
    const dir = await dialogOpen({ directory: true });
    if (!dir || Array.isArray(dir)) return;
    const dirPath = dir as string;
    const folderName = dirPath.split('/').pop() ?? 'folder';
    const folderPrefix = prefix + folderName + '/';
    const toastId = toast.loading(`Uploading folder "${folderName}"…`);
    try {
      const [fileCount, totalBytes] = await uploadFolder(connId, bucket, folderPrefix, dirPath);
      toast.dismiss(toastId);
      toast.success(`Uploaded ${fileCount} file(s) (${formatSize(totalBytes)})`);
      fetchListing();
    } catch (err) {
      toast.dismiss(toastId);
      toast.error(`Upload failed: ${err}`);
    }
  };

  const handleDownloadSingle = async (key: string) => {
    if (!connId || !bucket) return;
    const filename = fileBasename(key);
    const { save: dialogSave } = await import('@tauri-apps/plugin-dialog');
    const savePath = await dialogSave({ defaultPath: filename });
    if (!savePath) return;
    const toastId = toast.loading(`Downloading ${filename}…`);
    try {
      await downloadFile(connId, bucket, key, savePath);
      toast.dismiss(toastId);
      toast.success(`Downloaded ${filename}`);
    } catch (err) {
      toast.dismiss(toastId);
      toast.error(`Download failed: ${err}`);
    }
  };

  const handleDownloadFolder = async (folderKey: string) => {
    if (!connId || !bucket) return;
    const { open: dialogOpen } = await import('@tauri-apps/plugin-dialog');
    const dir = await dialogOpen({ directory: true });
    if (!dir || Array.isArray(dir)) return;
    const folderName = folderKey.replace(/\/$/, '').split('/').pop() ?? 'folder';
    const toastId = toast.loading(`Downloading folder "${folderName}"…`);
    try {
      const [fileCount, totalBytes] = await downloadFolder(connId, bucket, folderKey, dir as string);
      toast.dismiss(toastId);
      toast.success(`Downloaded ${fileCount} file(s) (${formatSize(totalBytes)})`);
    } catch (err) {
      toast.dismiss(toastId);
      toast.error(`Download failed: ${err}`);
    }
  };

  const handleDownloadMultiple = async (keys: string[]) => {
    if (!connId || !bucket) return;
    const folderKeys = keys.filter((k) => listing.folders.includes(k));
    const fileKeys = keys.filter((k) => !listing.folders.includes(k));
    if (folderKeys.length === 0 && fileKeys.length === 0) {
      toast.error('No items in selection to download');
      return;
    }
    if (folderKeys.length === 0 && fileKeys.length === 1) {
      handleDownloadSingle(fileKeys[0]);
      return;
    }
    const { open: dialogOpen } = await import('@tauri-apps/plugin-dialog');
    const dir = await dialogOpen({ directory: true });
    if (!dir || Array.isArray(dir)) return;
    const destDir = dir as string;
    const toastId = toast.loading(`Downloading ${keys.length} item(s)…`);
    let failed = 0;
    for (const folderKey of folderKeys) {
      try {
        await downloadFolder(connId, bucket, folderKey, destDir);
      } catch {
        failed++;
      }
    }
    for (const fileKey of fileKeys) {
      const filename = fileBasename(fileKey);
      try {
        await downloadFile(connId, bucket, fileKey, `${destDir}/${filename}`);
      } catch {
        failed++;
      }
    }
    toast.dismiss(toastId);
    if (failed === 0) toast.success(`Downloaded ${keys.length} item(s)`);
    else toast.error(`${keys.length - failed} succeeded, ${failed} failed`);
  };

  const handleDeleteConfirm = async (keys: string[]) => {
    if (!connId || !bucket) return;
    setModal(null);
    const toastId = toast.loading('Deleting…');
    try {
      const folderKeys = keys.filter((k) => listing.folders.includes(k));
      const fileKeys = keys.filter((k) => !listing.folders.includes(k));

      for (const folderKey of folderKeys) {
        await deletePrefix(connId, bucket, folderKey);
      }

      if (fileKeys.length === 1) {
        await deleteObject(connId, bucket, fileKeys[0]);
      } else if (fileKeys.length > 1) {
        await deleteObjects(connId, bucket, fileKeys);
      }

      toast.dismiss(toastId);
      toast.success(`Deleted ${keys.length} item(s)`);
    } catch (err) {
      toast.dismiss(toastId);
      toast.error(`Delete failed: ${err}`);
    }
    fetchListing();
    setSelection(new Set());
  };

  const handleRename = async (key: string, newName: string) => {
    if (!connId || !bucket || !newName.trim()) return;
    const newKey = prefix + newName.trim();
    const toastId = toast.loading('Renaming…');
    try {
      await renameObject(connId, bucket, key, newKey);
      toast.dismiss(toastId);
      toast.success('Renamed');
    } catch (err) {
      toast.dismiss(toastId);
      toast.error(`Rename failed: ${err}`);
    }
    setModal(null);
    fetchListing();
  };

  const handleNewFolder = async (name: string) => {
    if (!connId || !bucket || !name.trim()) return;
    const toastId = toast.loading('Creating folder…');
    try {
      await createFolder(connId, bucket, prefix + name.trim() + '/');
      toast.dismiss(toastId);
      toast.success(`Created "${name.trim()}"`);
    } catch (err) {
      toast.dismiss(toastId);
      toast.error(`Failed: ${err}`);
    }
    setModal(null);
    setNewFolderValue('');
    fetchListing();
  };

  const handleOpenFile = async (key: string) => {
    if (!connId || !bucket) return;
    const toastId = toast.loading('Generating link…');
    try {
      const url = await getPresignedUrl(connId, bucket, key, 3600);
      toast.dismiss(toastId);
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      await openUrl(url);
    } catch (err) {
      toast.dismiss(toastId);
      toast.error(`Failed to open: ${err}`);
    }
  };

  // ── Context menu ───────────────────────────────────────────────────────────

  const buildContextMenuItems = (info: ContextMenuInfo): ContextMenuItem[] => {
    const { key, isFolder } = info;
    const applyToSelection = selection.has(key) && selection.size > 1;
    const targets = applyToSelection ? [...selection] : [key];

    const items: ContextMenuItem[] = [];

    if (!applyToSelection) {
      items.push({
        label: isFolder ? 'Open' : 'Open in browser',
        icon: <ExternalLink className="w-3.5 h-3.5" />,
        onClick: () => {
          if (isFolder) navigateInto(key.slice(prefix.length));
          else handleOpenFile(key);
        },
      });
    }

    items.push({
      label: 'Download',
      icon: <Download className="w-3.5 h-3.5" />,
      onClick: () => {
        if (!applyToSelection && isFolder) handleDownloadFolder(key);
        else if (!applyToSelection && !isFolder) handleDownloadSingle(key);
        else handleDownloadMultiple(targets);
      },
    });

    if (!applyToSelection) {
      items.push({
        label: 'Rename',
        icon: <Pencil className="w-3.5 h-3.5" />,
        disabled: isFolder,
        onClick: () => {
          if (isFolder) {
            toast.error('Folder rename not supported');
            return;
          }
          const currentName = fileBasename(key);
          setRenameValue(currentName);
          setModal({ type: 'rename', key, currentName });
        },
      });
    }

    if (!applyToSelection && !isFolder) {
      items.push({
        label: 'Get Info…',
        icon: <Info className="w-3.5 h-3.5" />,
        onClick: () => setInfoKey(key),
      });
    }

    items.push({
      label: applyToSelection ? `Delete ${targets.length} items` : 'Delete',
      icon: <Trash2 className="w-3.5 h-3.5" />,
      danger: true,
      onClick: () => setModal({ type: 'delete', keys: targets }),
    });

    return items;
  };

  // ── Header download handler ────────────────────────────────────────────────

  const handleHeaderDownload = () => {
    const keys = [...selection];
    if (keys.length === 1 && listing.folders.includes(keys[0])) {
      handleDownloadFolder(keys[0]);
    } else if (keys.length === 1 && !listing.folders.includes(keys[0])) {
      handleDownloadSingle(keys[0]);
    } else {
      handleDownloadMultiple(keys);
    }
  };

  // ── Early returns for empty states ─────────────────────────────────────────

  if (!connId) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState
          title="Select a connection"
          description="Choose a connection from the sidebar to get started."
        />
      </div>
    );
  }

  if (!bucket) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState
          title="Select a bucket"
          description="Pick a bucket from the sidebar to browse its objects."
        />
      </div>
    );
  }

  // ── Breadcrumbs ────────────────────────────────────────────────────────────

  const breadcrumbSegments = prefix ? prefix.replace(/\/$/, '').split('/') : [];
  const hasSelection = selection.size > 0;
  const allChecked = allKeys.length > 0 && selection.size === allKeys.length;
  const someChecked = selection.size > 0 && selection.size < allKeys.length;

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className={cn(
        'flex flex-col h-full outline-none transition-[box-shadow,background-color]',
        isDragOver && 'ring-2 ring-inset ring-[#007AFF] bg-blue-50/20 dark:bg-blue-950/20',
      )}
    >
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-black/8 dark:border-white/8 shrink-0 gap-3 min-h-[44px]">
        {/* Breadcrumbs */}
        <nav className="flex items-center gap-0.5 min-w-0 overflow-hidden text-sm" aria-label="Breadcrumb">
          <button
            onClick={() => setPrefix('')}
            className={cn(
              'shrink-0 px-1.5 py-0.5 rounded hover:bg-black/8 dark:hover:bg-white/8 transition-colors font-medium truncate max-w-[200px]',
              breadcrumbSegments.length > 0 && 'text-neutral-500 dark:text-neutral-400',
            )}
          >
            {bucket}
          </button>
          {breadcrumbSegments.map((seg, idx) => (
            <React.Fragment key={idx}>
              <ChevronRight className="w-3.5 h-3.5 text-neutral-400 shrink-0" aria-hidden="true" />
              <button
                onClick={() => navigateToBreadcrumb(idx)}
                className={cn(
                  'px-1.5 py-0.5 rounded hover:bg-black/8 dark:hover:bg-white/8 transition-colors truncate max-w-[140px]',
                  idx === breadcrumbSegments.length - 1
                    ? 'font-medium'
                    : 'text-neutral-500 dark:text-neutral-400',
                )}
              >
                {seg}
              </button>
            </React.Fragment>
          ))}
        </nav>

        {/* Actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          {hasSelection && (
            <span className="text-xs text-neutral-500 dark:text-neutral-400 select-none">
              {selection.size} selected
            </span>
          )}
          {hasSelection && (
            <Button variant="ghost" size="sm" onClick={handleHeaderDownload}>
              <Download className="w-3.5 h-3.5" />
              Download
            </Button>
          )}
          {hasSelection && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setModal({ type: 'delete', keys: [...selection] })}
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={fetchListing}
            aria-label="Refresh"
            title="Refresh"
          >
            <RotateCw className={cn('w-3.5 h-3.5', listing.loading && 'animate-spin')} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setNewFolderValue(''); setModal({ type: 'newFolder' }); }}
          >
            <FolderPlus className="w-3.5 h-3.5" />
            New Folder
          </Button>
          <div className="relative" ref={uploadMenuRef}>
            <Button variant="default" size="sm" onClick={() => setUploadMenuOpen((v) => !v)}>
              <Upload className="w-3.5 h-3.5" />
              Upload
              <ChevronDown className="w-3 h-3 ml-0.5" />
            </Button>
            {uploadMenuOpen && (
              <div className="absolute right-0 top-full mt-1 z-50 min-w-[140px] rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-neutral-800 shadow-lg py-1">
                <button
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-black/5 dark:hover:bg-white/5"
                  onClick={() => { setUploadMenuOpen(false); handleUpload(); }}
                >
                  Files…
                </button>
                <button
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-black/5 dark:hover:bg-white/5"
                  onClick={() => { setUploadMenuOpen(false); handleUploadFolder(); }}
                >
                  Folder…
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex-1 min-h-0 overflow-auto">
        {listing.loading ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-black/8 dark:border-white/8">
                <th className="w-10 px-3 py-2" />
                <th className="text-left px-3 py-2 font-medium text-neutral-500 text-xs">Name</th>
                <th className="text-right px-3 py-2 font-medium text-neutral-500 text-xs w-28">Size</th>
                <th className="text-right px-3 py-2 font-medium text-neutral-500 text-xs w-40">Modified</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 6 }).map((_, i) => (
                <tr key={i} className="border-b border-black/4 dark:border-white/4">
                  <td className="px-3 py-2.5"><Skeleton className="w-4 h-4" /></td>
                  <td className="px-3 py-2.5"><Skeleton className={cn('h-4', i % 2 === 0 ? 'w-52' : 'w-36')} /></td>
                  <td className="px-3 py-2.5 text-right"><Skeleton className="h-4 w-16 ml-auto" /></td>
                  <td className="px-3 py-2.5 text-right"><Skeleton className="h-4 w-24 ml-auto" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : allKeys.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <EmptyState
              title="This folder is empty"
              description="Upload files or create a folder to get started."
            />
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-white/80 dark:bg-neutral-900/80 backdrop-blur-sm">
              <tr className="border-b border-black/8 dark:border-white/8">
                <th className="w-10 px-3 py-2">
                  <input
                    type="checkbox"
                    className="rounded accent-[#007AFF]"
                    checked={allChecked}
                    ref={(el) => { if (el) el.indeterminate = someChecked; }}
                    onChange={(e) => {
                      setSelection(e.target.checked ? new Set(allKeys) : new Set());
                    }}
                    aria-label="Select all"
                  />
                </th>
                <th className="text-left px-3 py-2 font-medium text-neutral-500 text-xs">Name</th>
                <th className="text-right px-3 py-2 font-medium text-neutral-500 text-xs w-28">Size</th>
                <th className="text-right px-3 py-2 font-medium text-neutral-500 text-xs w-40">Modified</th>
              </tr>
            </thead>
            <tbody>
              {listing.folders.map((folder) => {
                const displayName = folder.slice(prefix.length).replace(/\/$/, '');
                const isSelected = selection.has(folder);
                return (
                  <tr
                    key={folder}
                    onClick={(e) => toggleSelect(folder, e)}
                    onDoubleClick={() => navigateInto(folder.slice(prefix.length))}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setContextMenu({ position: { x: e.clientX, y: e.clientY }, key: folder, isFolder: true });
                    }}
                    className={cn(
                      'border-b border-black/4 dark:border-white/4 cursor-pointer select-none',
                      'hover:bg-black/4 dark:hover:bg-white/4',
                      isSelected && 'bg-blue-50 dark:bg-blue-900/20',
                    )}
                  >
                    <td
                      className="px-3 py-2.5"
                      onClick={(e) => { e.stopPropagation(); toggleCheckbox(folder); }}
                    >
                      <input
                        type="checkbox"
                        className="rounded accent-[#007AFF] pointer-events-none"
                        checked={isSelected}
                        readOnly
                      />
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <Folder className="w-4 h-4 text-yellow-500 shrink-0" />
                        <span className="truncate">{displayName}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right text-neutral-400" />
                    <td className="px-3 py-2.5 text-right text-neutral-400" />
                  </tr>
                );
              })}
              {listing.files.map((file) => {
                const displayName = file.key.slice(prefix.length);
                const isSelected = selection.has(file.key);
                const modDate = file.last_modified ? new Date(file.last_modified) : null;
                return (
                  <tr
                    key={file.key}
                    onClick={(e) => toggleSelect(file.key, e)}
                    onDoubleClick={() => handleOpenFile(file.key)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setContextMenu({ position: { x: e.clientX, y: e.clientY }, key: file.key, isFolder: false });
                    }}
                    className={cn(
                      'border-b border-black/4 dark:border-white/4 cursor-pointer select-none',
                      'hover:bg-black/4 dark:hover:bg-white/4',
                      isSelected && 'bg-blue-50 dark:bg-blue-900/20',
                    )}
                  >
                    <td
                      className="px-3 py-2.5"
                      onClick={(e) => { e.stopPropagation(); toggleCheckbox(file.key); }}
                    >
                      <input
                        type="checkbox"
                        className="rounded accent-[#007AFF] pointer-events-none"
                        checked={isSelected}
                        readOnly
                      />
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <FileIcon className="w-4 h-4 text-neutral-400 shrink-0" />
                        <span className="truncate">{displayName}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right text-neutral-500 tabular-nums">
                      {formatSize(file.size)}
                    </td>
                    <td className="px-3 py-2.5 text-right text-neutral-500 tabular-nums">
                      {modDate ? (
                        <Tooltip
                          content={format(modDate, 'yyyy-MM-dd HH:mm:ss')}
                          side="left"
                        >
                          <span>{formatDistanceToNow(modDate, { addSuffix: true })}</span>
                        </Tooltip>
                      ) : (
                        <span className="text-neutral-400">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Context Menu ── */}
      {contextMenu && (
        <ContextMenu
          position={contextMenu.position}
          items={buildContextMenuItems(contextMenu)}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* ── Delete Modal ── */}
      {modal?.type === 'delete' && (
        <Modal
          open
          onClose={() => setModal(null)}
          title={`Delete ${modal.keys.length} item${modal.keys.length !== 1 ? 's' : ''}?`}
        >
          <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-5">
            This action cannot be undone.
            {modal.keys.some((k) => listing.folders.includes(k)) && (
              <> All objects inside selected folders will also be permanently deleted.</>
            )}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setModal(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => handleDeleteConfirm(modal.keys)}>
              Delete
            </Button>
          </div>
        </Modal>
      )}

      {/* ── Rename Modal ── */}
      {modal?.type === 'rename' && (
        <Modal open onClose={() => setModal(null)} title="Rename">
          <div className="flex flex-col gap-4">
            <Input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRename(modal.key, renameValue);
              }}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setModal(null)}>Cancel</Button>
              <Button onClick={() => handleRename(modal.key, renameValue)}>Rename</Button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── New Folder Modal ── */}
      {modal?.type === 'newFolder' && (
        <Modal open onClose={() => setModal(null)} title="New Folder">
          <div className="flex flex-col gap-4">
            <Input
              placeholder="Folder name"
              value={newFolderValue}
              onChange={(e) => setNewFolderValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleNewFolder(newFolderValue);
              }}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setModal(null)}>Cancel</Button>
              <Button onClick={() => handleNewFolder(newFolderValue)} disabled={!newFolderValue.trim()}>
                Create
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Object Info Modal ── */}
      {connId && bucket && (
        <ObjectInfoModal
          open={infoKey !== null}
          onClose={() => setInfoKey(null)}
          connectionId={connId}
          bucket={bucket}
          objectKey={infoKey ?? ''}
          onSaved={() => fetchListing()}
        />
      )}
    </div>
  );
}
