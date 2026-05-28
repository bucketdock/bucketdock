"use client";

import * as React from "react";
import {
  RotateCw,
  FolderPlus,
  Download,
  Trash2,
  Folder,
  File as FileIcon,
  ChevronRight,
  ChevronLeft,
  Pencil,
  ExternalLink,
  Info,
  ArrowRightLeft,
  MoveRight,
  Search,
  MoreHorizontal,
  Eye,
  Tag,
  ArrowUp,
  ArrowDown,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { format, formatDistanceToNow, isThisYear } from "date-fns";

import {
  listObjects,
  createFolder,
  renameObject,
  renamePrefix,
  isTauri,
  downloadFolder,
  headObjectContentTypes,
  walkLocalFiles,
  type ObjectInfo,
} from "@/lib/tauri";
import { useAppStore } from "@/store/app-store";
import { useTransfersStore } from "@/store/transfers-store";
import { fileExtension, s3DefaultContentType } from "@/lib/mime";
import CopyToModal from "@/components/copy-to-modal";
import BucketsPane from "@/components/buckets-pane";
import { UploadSplitButton } from "@/components/upload-split-button";
import { Button } from "@/components/ui/button";
import {
  OverflowToolbar,
  type OverflowItem,
} from "@/components/ui/overflow-toolbar";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import {
  ContextMenu,
  type ContextMenuItem,
} from "@/components/ui/context-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { ObjectInfoModal } from "@/components/object-info-modal";
import { FilePreviewModal } from "@/components/file-preview-modal";

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes < 1024 ** 4) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${(bytes / 1024 ** 4).toFixed(1)} TB`;
}

function fileBasename(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

function shortDate(d: Date): string {
  // Keep it tight in the table cell; full timestamp is in the tooltip.
  return isThisYear(d) ? format(d, "MMM d, HH:mm") : format(d, "yyyy-MM-dd");
}

/**
 * Folder display name (no trailing slash) relative to a parent prefix.
 * Used by both the path bar and the folder rows so they stay in sync.
 */
export function folderDisplayName(
  folderKey: string,
  parentPrefix: string,
): string {
  return folderKey.slice(parentPrefix.length).replace(/\/$/, "");
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface ListingState {
  folders: string[];
  files: ObjectInfo[];
  loading: boolean;
  error: string | null;
}

type ModalState =
  | { type: "delete"; keys: string[] }
  | { type: "rename"; key: string; isFolder: boolean; currentName: string }
  | { type: "newFolder" }
  | { type: "copyTo"; keys: string[]; mode: "copy" | "move" }
  | null;

type SortKey = "name" | "type" | "storage" | "size" | "modified";
type SortDir = "asc" | "desc";

interface ContextMenuInfo {
  position: { x: number; y: number };
  key: string;
  isFolder: boolean;
}

// ── SortableHeader ────────────────────────────────────────────────────────────

function SortableHeader({
  label,
  col,
  sortKey,
  sortDir,
  onSort,
  align,
  width,
}: {
  label: string;
  col: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (k: SortKey) => void;
  align: "left" | "right";
  width?: string;
}) {
  const active = sortKey === col;
  return (
    <th
      className={cn(
        "px-3 py-2 font-medium text-neutral-500 text-xs cursor-pointer select-none",
        align === "left" ? "text-left" : "text-right",
        width,
      )}
      onClick={() => onSort(col)}
    >
      <span
        className={cn(
          "inline-flex items-center gap-1 hover:text-neutral-700 dark:hover:text-neutral-300",
          align === "right" && "flex-row-reverse",
        )}
      >
        {label}
        {active &&
          (sortDir === "asc" ? (
            <ArrowUp className="w-3 h-3" />
          ) : (
            <ArrowDown className="w-3 h-3" />
          ))}
      </span>
    </th>
  );
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
    back,
    forward,
    goBack,
    goForward,
  } = useAppStore();

  const [listing, setListing] = React.useState<ListingState>({
    folders: [],
    files: [],
    loading: false,
    error: null,
  });
  const [selection, setSelection] = React.useState<Set<string>>(new Set());
  const [lastSelected, setLastSelected] = React.useState<string | null>(null);
  const [contextMenu, setContextMenu] = React.useState<ContextMenuInfo | null>(
    null,
  );
  const [modal, setModal] = React.useState<ModalState>(null);
  const [isDragOver, setIsDragOver] = React.useState(false);
  const [renameValue, setRenameValue] = React.useState("");
  const [newFolderValue, setNewFolderValue] = React.useState("");
  const [infoKey, setInfoKey] = React.useState<string | null>(null);
  const [editHeadersKey, setEditHeadersKey] = React.useState<string | null>(
    null,
  );
  const [previewKey, setPreviewKey] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState("");
  const [sortKey, setSortKey] = React.useState<SortKey>("name");
  const [sortDir, setSortDir] = React.useState<SortDir>("asc");
  const [rowMenu, setRowMenu] = React.useState<ContextMenuInfo | null>(null);
  // key -> Content-Type returned by HEAD. `null` means we asked but the
  // object had no stored type. `undefined` (absent) means we haven't asked
  // yet, so the table can show the S3 default placeholder until the value
  // lands. This map is reset on every fresh listing.
  const [contentTypes, setContentTypes] = React.useState<
    Record<string, string | null>
  >({});

  // ── Disclosure-triangle state ──────────────────────────────────────────────
  // Folder key (with trailing slash) -> child listing. Mirrors the Finder
  // list-view behaviour where clicking the disclosure triangle reveals the
  // folder's contents inline, indented under the row, without navigating.
  // Cleared whenever the bucket / prefix changes so we never display stale
  // children for a folder that no longer exists in the current view.
  type ChildListing = {
    folders: string[];
    files: ObjectInfo[];
    loading: boolean;
    error: string | null;
  };
  const [expanded, setExpanded] = React.useState<Record<string, ChildListing>>(
    {},
  );
  React.useEffect(() => {
    // Collapse everything on listing context change. Without this, switching
    // buckets while folders were expanded would briefly render orphan rows.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional reset on context change
    setExpanded({});
  }, [connId, bucket, prefix]);

  const toggleExpand = React.useCallback(
    async (folderKey: string) => {
      if (!connId || !bucket) return;
      // Collapse if already open.
      if (expanded[folderKey]) {
        setExpanded((prev) => {
          const next = { ...prev };
          delete next[folderKey];
          return next;
        });
        return;
      }
      setExpanded((prev) => ({
        ...prev,
        [folderKey]: { folders: [], files: [], loading: true, error: null },
      }));
      try {
        const page = await listObjects(connId, bucket, folderKey);
        setExpanded((prev) => {
          // Folder may have been collapsed (or context changed) while the
          // request was in flight; only commit if our slot is still loading.
          const slot = prev[folderKey];
          if (!slot || !slot.loading) return prev;
          return {
            ...prev,
            [folderKey]: {
              folders: page.folders,
              files: page.files,
              loading: false,
              error: null,
            },
          };
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setExpanded((prev) => {
          const slot = prev[folderKey];
          if (!slot || !slot.loading) return prev;
          return {
            ...prev,
            [folderKey]: {
              folders: [],
              files: [],
              loading: false,
              error: msg,
            },
          };
        });
      }
    },
    [connId, bucket, expanded],
  );

  const containerRef = React.useRef<HTMLDivElement>(null);

  // Stable refs so async callbacks always see current values
  const connIdRef = React.useRef(connId);
  const bucketRef = React.useRef(bucket);
  const prefixRef = React.useRef(prefix);
  React.useEffect(() => {
    connIdRef.current = connId;
  }, [connId]);
  React.useEffect(() => {
    bucketRef.current = bucket;
  }, [bucket]);
  React.useEffect(() => {
    prefixRef.current = prefix;
  }, [prefix]);

  // ── Listing ────────────────────────────────────────────────────────────────

  // Monotonically-increasing token used to discard out-of-date listing
  // responses. When the user switches connection / bucket / prefix or hits
  // refresh, we bump this; any in-flight `listObjects` whose response lands
  // *after* a newer fetch has started is ignored. Without this guard a slow
  // failed listing for connection A can clobber a successful listing for
  // connection B that the user just switched to — which manifested as the
  // browser appearing to "remember" the broken connection until you clicked
  // away and back.
  const fetchTokenRef = React.useRef(0);

  const fetchListing = React.useCallback(
    async (options?: { background?: boolean }) => {
      if (!connId || !bucket) return;
      const token = ++fetchTokenRef.current;
      const background = options?.background === true;
      // ── Soft refresh ────────────────────────────────────────────────────
      // A background refresh keeps the current rows on screen while the
      // request is in flight (no skeletons, no selection clear, no scroll
      // jump). This is what we want after every transfer / delete / rename
      // — re-rendering the skeleton there caused the table to visibly
      // blank on every queued operation and made bulk actions feel like
      // they were flashing the UI.
      // A hard refresh (initial mount, prefix change, manual reload) still
      // clears state so the user sees that something is happening.
      if (background) {
        setListing((s) => ({ ...s, loading: true, error: null }));
      } else {
        setListing((s) => ({ ...s, loading: true, error: null }));
        setSelection(new Set());
        setContentTypes({});
      }
      try {
        const page = await listObjects(connId, bucket, prefix);
        if (token !== fetchTokenRef.current) return;
        setListing({
          folders: page.folders,
          files: page.files,
          loading: false,
          error: null,
        });
        // Fan out HEAD requests in the background so the Type column can show
        // real Content-Type values instead of the S3 default placeholder.
        // Errors are swallowed: the column gracefully falls back to the
        // placeholder when a value never arrives.
        const fileKeys = page.files.map((f) => f.key);
        if (fileKeys.length > 0 && isTauri()) {
          headObjectContentTypes(connId, bucket, fileKeys)
            .then((map) => {
              if (token !== fetchTokenRef.current) return;
              // Merge so values for keys that are still present survive a
              // background refresh, instead of flashing the placeholder.
              setContentTypes((prev) => ({ ...prev, ...map }));
            })
            .catch(() => {
              /* leave placeholder */
            });
        }
      } catch (err) {
        if (token !== fetchTokenRef.current) return;
        const msg = err instanceof Error ? err.message : String(err);
        setListing((s) => ({ ...s, loading: false, error: msg }));
        toast.error(`Failed to list objects: ${msg}`);
      }
    },
    [connId, bucket, prefix],
  );

  // Memoised wrappers so callers don't need to remember to pass `background`.
  const hardRefresh = React.useCallback(() => fetchListing(), [fetchListing]);
  const softRefresh = React.useCallback(
    () => fetchListing({ background: true }),
    [fetchListing],
  );

  React.useEffect(() => {
    fetchListing();
  }, [fetchListing]);

  // Auto-refresh the listing whenever an upload or copy that lands inside
  // the currently-open bucket+prefix finishes. Without this, dropping a file
  // or queueing a copy in this folder would leave the table stale until the
  // user manually clicked refresh.
  React.useEffect(() => {
    if (!connId || !bucket) return;
    let lastSeenDone = new Set(
      useTransfersStore
        .getState()
        .items.filter((t) => t.status !== "running" && t.status !== "queued")
        .map((t) => t.id),
    );
    const unsub = useTransfersStore.subscribe((state) => {
      const c = connIdRef.current;
      const b = bucketRef.current;
      const p = prefixRef.current;
      if (!c || !b) return;
      let touchesView = false;
      const nextSeen = new Set<string>();
      for (const t of state.items) {
        if (t.status === "running" || t.status === "queued") continue;
        nextSeen.add(t.id);
        if (lastSeenDone.has(t.id)) continue;
        if (t.status !== "done") continue;
        const matchesView =
          (t.kind === "upload" &&
            t.params.connectionId === c &&
            t.params.bucket === b &&
            (t.params.key ?? "").startsWith(p)) ||
          (t.kind === "copy" &&
            t.params.dstConnectionId === c &&
            t.params.dstBucket === b &&
            (t.params.dstKey ?? "").startsWith(p)) ||
          (t.kind === "delete" &&
            t.params.connectionId === c &&
            t.params.bucket === b &&
            // A delete touches the view if any of its targeted keys or
            // prefixes sits under the currently-open prefix.
            ((t.params.deleteKeys ?? []).some((k) => k.startsWith(p)) ||
              (t.params.deletePrefixes ?? []).some((k) => k.startsWith(p))));
        if (matchesView) touchesView = true;
      }
      lastSeenDone = nextSeen;
      if (touchesView) softRefresh();
    });
    return unsub;
  }, [connId, bucket, softRefresh]);

  // ── Derived ────────────────────────────────────────────────────────────────

  const { visibleFolders, visibleFiles, allKeys } = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    const matchFolder = (f: string) =>
      !q || f.slice(prefix.length).toLowerCase().includes(q);
    const matchFile = (f: ObjectInfo) =>
      !q || f.key.slice(prefix.length).toLowerCase().includes(q);

    const folders = listing.folders.filter(matchFolder);
    const files = listing.files.filter(matchFile);

    const dir = sortDir === "asc" ? 1 : -1;
    const cmpName = (a: string, b: string) => a.localeCompare(b) * dir;

    folders.sort((a, b) =>
      cmpName(a.slice(prefix.length), b.slice(prefix.length)),
    );

    files.sort((a, b) => {
      switch (sortKey) {
        case "size":
          return (a.size - b.size) * dir;
        case "modified": {
          const at = a.last_modified ? Date.parse(a.last_modified) : 0;
          const bt = b.last_modified ? Date.parse(b.last_modified) : 0;
          return (at - bt) * dir;
        }
        case "type":
          return fileExtension(a.key).localeCompare(fileExtension(b.key)) * dir;
        case "storage":
          return (
            (a.storage_class ?? "").localeCompare(b.storage_class ?? "") * dir
          );
        case "name":
        default:
          return cmpName(
            a.key.slice(prefix.length),
            b.key.slice(prefix.length),
          );
      }
    });

    return {
      visibleFolders: folders,
      visibleFiles: files,
      allKeys: [...folders, ...files.map((f) => f.key)],
    };
  }, [listing, prefix, search, sortKey, sortDir]);

  // ── Drag & drop ────────────────────────────────────────────────────────────

  React.useEffect(() => {
    if (!isTauri()) return;

    let unlistenEnter: (() => void) | null = null;
    let unlistenLeave: (() => void) | null = null;
    let unlistenDrop: (() => void) | null = null;
    let mounted = true;

    (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      if (!mounted) return;

      unlistenEnter = await listen("tauri://drag-enter", () =>
        setIsDragOver(true),
      );
      unlistenLeave = await listen("tauri://drag-leave", () =>
        setIsDragOver(false),
      );
      unlistenDrop = await listen<{
        paths: string[];
        position: { x: number; y: number };
      }>("tauri://drag-drop", async (event) => {
        setIsDragOver(false);
        const cid = connIdRef.current;
        const bkt = bucketRef.current;
        const pfx = prefixRef.current;
        if (!cid || !bkt) return;

        const enqueueUpload = useTransfersStore.getState().enqueueUpload;
        for (const filePath of event.payload.paths) {
          const name = fileBasename(filePath);
          enqueueUpload({
            connectionId: cid,
            bucket: bkt,
            key: pfx + name,
            localPath: filePath,
            name,
            subtitle: `${bkt}/${pfx}${name}`,
          });
        }
        // Listing reflects new uploads on next refresh; user can refresh manually.
        softRefresh();
      });
    })();

    return () => {
      mounted = false;
      unlistenEnter?.();
      unlistenLeave?.();
      unlistenDrop?.();
    };
  }, [softRefresh]);

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
    if (tag === "INPUT" || tag === "TEXTAREA") return;

    if (e.key === "Delete" || (e.key === "Backspace" && selection.size > 0)) {
      e.preventDefault();
      if (selection.size > 0)
        setModal({ type: "delete", keys: [...selection] });
    } else if (e.key === "Enter" && selection.size === 1) {
      const key = [...selection][0];
      if (listing.folders.includes(key)) navigateInto(key.slice(prefix.length));
    } else if ((e.metaKey || e.ctrlKey) && e.key === "a") {
      e.preventDefault();
      setSelection(new Set(allKeys));
    } else if ((e.metaKey || e.ctrlKey) && e.key === "[") {
      // macOS Finder: ⌘[ goes back in history.
      e.preventDefault();
      if (back.length > 0) goBack();
    } else if ((e.metaKey || e.ctrlKey) && e.key === "]") {
      // macOS Finder: ⌘] goes forward in history.
      e.preventDefault();
      if (forward.length > 0) goForward();
    } else if ((e.metaKey || e.ctrlKey) && e.key === "i") {
      e.preventDefault();
      const selectedKeys = [...selection];
      if (
        selectedKeys.length === 1 &&
        !listing.folders.includes(selectedKeys[0])
      ) {
        setInfoKey(selectedKeys[0]);
      }
    }
  };

  // ── Operations ─────────────────────────────────────────────────────────────

  const handleUpload = async () => {
    if (!connId || !bucket) return;
    const { open: dialogOpen } = await import("@tauri-apps/plugin-dialog");
    const result = await dialogOpen({ multiple: true });
    if (!result) return;
    const paths = Array.isArray(result) ? result : [result];
    const enqueueUpload = useTransfersStore.getState().enqueueUpload;
    for (const filePath of paths) {
      const name = fileBasename(filePath);
      enqueueUpload({
        connectionId: connId,
        bucket,
        key: prefix + name,
        localPath: filePath,
        name,
        subtitle: `${bucket}/${prefix}${name}`,
      });
    }
    softRefresh();
  };

  const handleUploadFolder = async () => {
    if (!connId || !bucket) return;
    const { open: dialogOpen } = await import("@tauri-apps/plugin-dialog");
    const dir = await dialogOpen({ directory: true });
    if (!dir || Array.isArray(dir)) return;
    const dirPath = dir as string;
    const folderName = dirPath.split("/").pop() ?? "folder";
    const folderPrefix = prefix + folderName + "/";

    // Walk the folder so each file becomes its own queued upload with
    // per-file progress, instead of a single opaque "uploading folder…"
    // toast that hides what's happening.
    let entries;
    try {
      entries = await walkLocalFiles(dirPath);
    } catch (err) {
      toast.error(`Could not read folder: ${err}`);
      return;
    }
    if (entries.length === 0) {
      toast.message(`"${folderName}" has no files to upload`);
      return;
    }
    const enqueueUpload = useTransfersStore.getState().enqueueUpload;
    for (const entry of entries) {
      const key = folderPrefix + entry.relative_path;
      enqueueUpload({
        connectionId: connId,
        bucket,
        key,
        localPath: entry.absolute_path,
        name: entry.relative_path || folderName,
        subtitle: `${bucket}/${key}`,
        total: entry.size,
      });
    }
    toast.success(
      `Queued ${entries.length} file${entries.length === 1 ? "" : "s"} from "${folderName}"`,
    );
    softRefresh();
  };

  // ── Native menu actions ────────────────────────────────────────────────────
  // Keep refs to the latest handlers so the listener doesn't churn on every
  // render. The Rust side emits "menu://action" with the menu item id.
  const menuHandlersRef = React.useRef<{
    refresh: () => void;
    upload: () => void;
    uploadFolder: () => void;
    newFolder: () => void;
    getInfo: () => void;
  }>({
    refresh: () => {},
    upload: () => {},
    uploadFolder: () => {},
    newFolder: () => {},
    getInfo: () => {},
  });
  React.useEffect(() => {
    menuHandlersRef.current = {
      refresh: hardRefresh,
      upload: handleUpload,
      uploadFolder: handleUploadFolder,
      newFolder: () => {
        setNewFolderValue("");
        setModal({ type: "newFolder" });
      },
      getInfo: () => {
        if (selection.size === 1) {
          const k = [...selection][0];
          if (!k.endsWith("/")) setInfoKey(k);
        }
      },
    };
  });

  React.useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | null = null;
    let mounted = true;
    (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      if (!mounted) return;
      unlisten = await listen<string>("menu://action", (event) => {
        const id = event.payload;
        const h = menuHandlersRef.current;
        switch (id) {
          case "file:refresh":
            h.refresh();
            break;
          case "file:upload_files":
            h.upload();
            break;
          case "file:upload_folder":
            h.uploadFolder();
            break;
          case "file:new_folder":
            h.newFolder();
            break;
          case "file:get_info":
            h.getInfo();
            break;
          // file:new_connection handled by ConnectionsSidebar
          // edit:find handled here by focusing the search input
          case "edit:find": {
            const el = document.querySelector<HTMLInputElement>(
              'input[aria-label="Filter"]',
            );
            el?.focus();
            el?.select();
            break;
          }
        }
      });
    })();
    return () => {
      mounted = false;
      unlisten?.();
    };
  }, []);

  const handleDownloadSingle = async (key: string) => {
    if (!connId || !bucket) return;
    const filename = fileBasename(key);
    const { save: dialogSave } = await import("@tauri-apps/plugin-dialog");
    const savePath = await dialogSave({ defaultPath: filename });
    if (!savePath) return;
    useTransfersStore.getState().enqueueDownload({
      connectionId: connId,
      bucket,
      key,
      localPath: savePath,
      name: filename,
      subtitle: `${bucket}/${key}`,
    });
  };

  const handleDownloadFolder = async (folderKey: string) => {
    if (!connId || !bucket) return;
    const { open: dialogOpen } = await import("@tauri-apps/plugin-dialog");
    const dir = await dialogOpen({ directory: true });
    if (!dir || Array.isArray(dir)) return;
    const folderName =
      folderKey.replace(/\/$/, "").split("/").pop() ?? "folder";
    const toastId = toast.loading(`Downloading folder "${folderName}"…`);
    try {
      const [fileCount, totalBytes] = await downloadFolder(
        connId,
        bucket,
        folderKey,
        dir as string,
      );
      toast.dismiss(toastId);
      toast.success(
        `Downloaded ${fileCount} file(s) (${formatSize(totalBytes)})`,
      );
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
      toast.error("No items in selection to download");
      return;
    }
    if (folderKeys.length === 0 && fileKeys.length === 1) {
      handleDownloadSingle(fileKeys[0]);
      return;
    }
    const { open: dialogOpen } = await import("@tauri-apps/plugin-dialog");
    const dir = await dialogOpen({ directory: true });
    if (!dir || Array.isArray(dir)) return;
    const destDir = dir as string;

    // Folders still go through the bulk command (no per-file progress yet),
    // but files are routed through the transfer queue for live progress.
    if (folderKeys.length > 0) {
      const toastId = toast.loading(
        `Downloading ${folderKeys.length} folder(s)…`,
      );
      let failed = 0;
      for (const folderKey of folderKeys) {
        try {
          await downloadFolder(connId, bucket, folderKey, destDir);
        } catch {
          failed++;
        }
      }
      toast.dismiss(toastId);
      if (failed === 0)
        toast.success(`Downloaded ${folderKeys.length} folder(s)`);
      else
        toast.error(
          `${folderKeys.length - failed} succeeded, ${failed} failed`,
        );
    }

    const enqueueDownload = useTransfersStore.getState().enqueueDownload;
    for (const fileKey of fileKeys) {
      const filename = fileBasename(fileKey);
      enqueueDownload({
        connectionId: connId,
        bucket,
        key: fileKey,
        localPath: `${destDir}/${filename}`,
        name: filename,
        subtitle: `${bucket}/${fileKey}`,
      });
    }
  };

  const handleDeleteConfirm = async (keys: string[]) => {
    if (!connId || !bucket) return;
    setModal(null);
    const folderKeys = keys.filter((k) => listing.folders.includes(k));
    const fileKeys = keys.filter((k) => !listing.folders.includes(k));
    if (folderKeys.length === 0 && fileKeys.length === 0) return;

    // Route deletes through the transfer queue so the user sees live
    // progress instead of a blocking spinner. Folder deletes can expand
    // to thousands of objects — the previous opaque "Deleting…" toast hid
    // exactly when those long operations were active and made them
    // impossible to cancel.
    let name: string;
    if (keys.length === 1) {
      const only = keys[0];
      name = only.endsWith("/")
        ? (only.replace(/\/$/, "").split("/").pop() ?? only) + "/"
        : fileBasename(only);
    } else {
      name = `Delete ${keys.length} items`;
    }
    useTransfersStore.getState().enqueueDelete({
      connectionId: connId,
      bucket,
      keys: fileKeys,
      prefixes: folderKeys,
      name,
      subtitle: `${bucket}/${prefix}`,
    });
    setSelection(new Set());
  };

  const handleRename = async (
    key: string,
    newName: string,
    isFolder: boolean,
  ) => {
    if (!connId || !bucket || !newName.trim()) return;
    const trimmed = newName.trim().replace(/\/+$/, "");
    if (!trimmed) return;
    const toastId = toast.loading(isFolder ? "Renaming folder…" : "Renaming…");
    try {
      if (isFolder) {
        const newPrefix = prefix + trimmed + "/";
        await renamePrefix(connId, bucket, key, newPrefix);
      } else {
        const newKey = prefix + trimmed;
        await renameObject(connId, bucket, key, newKey);
      }
      toast.dismiss(toastId);
      toast.success("Renamed");
    } catch (err) {
      toast.dismiss(toastId);
      toast.error(`Rename failed: ${err}`);
    }
    setModal(null);
    softRefresh();
  };

  const handleNewFolder = async (name: string) => {
    if (!connId || !bucket || !name.trim()) return;
    const toastId = toast.loading("Creating folder…");
    try {
      await createFolder(connId, bucket, prefix + name.trim() + "/");
      toast.dismiss(toastId);
      toast.success(`Created "${name.trim()}"`);
    } catch (err) {
      toast.dismiss(toastId);
      toast.error(`Failed: ${err}`);
    }
    setModal(null);
    setNewFolderValue("");
    softRefresh();
  };

  // "Open in browser" was intentionally removed: the presigned-URL flow was
  // brittle across providers (some buckets returned 403 for the signed URL
  // even when the credentials had GetObject). Use Preview or Download from
  // the same context menu instead.

  // ── Context menu ───────────────────────────────────────────────────────────

  const buildContextMenuItems = (info: ContextMenuInfo): ContextMenuItem[] => {
    const { key, isFolder } = info;
    const applyToSelection = selection.has(key) && selection.size > 1;
    const targets = applyToSelection ? [...selection] : [key];

    const items: ContextMenuItem[] = [];

    if (!applyToSelection && isFolder) {
      items.push({
        label: "Open",
        icon: <ExternalLink className="w-3.5 h-3.5" />,
        onClick: () => navigateInto(key.slice(prefix.length)),
      });
    }

    if (!applyToSelection && !isFolder) {
      items.push({
        label: "Preview",
        icon: <Eye className="w-3.5 h-3.5" />,
        onClick: () => setPreviewKey(key),
      });
    }

    items.push({
      label: "Download",
      icon: <Download className="w-3.5 h-3.5" />,
      onClick: () => {
        if (!applyToSelection && isFolder) handleDownloadFolder(key);
        else if (!applyToSelection && !isFolder) handleDownloadSingle(key);
        else handleDownloadMultiple(targets);
      },
    });

    // Copy works for files and folders (folders are expanded server-side
    // by the copy modal via list_keys_under).
    items.push({
      label: applyToSelection ? `Copy ${targets.length} to…` : "Copy to…",
      icon: <ArrowRightLeft className="w-3.5 h-3.5" />,
      onClick: () => setModal({ type: "copyTo", keys: targets, mode: "copy" }),
    });

    // Move = copy + delete-source on success. The CopyToModal handles the
    // distinction via its `mode` prop.
    items.push({
      label: applyToSelection ? `Move ${targets.length} to…` : "Move to…",
      icon: <MoveRight className="w-3.5 h-3.5" />,
      onClick: () => setModal({ type: "copyTo", keys: targets, mode: "move" }),
    });

    if (!applyToSelection) {
      items.push({
        label: "Rename",
        icon: <Pencil className="w-3.5 h-3.5" />,
        onClick: () => {
          const currentName = isFolder
            ? key.slice(prefix.length).replace(/\/$/, "")
            : fileBasename(key);
          setRenameValue(currentName);
          setModal({ type: "rename", key, isFolder, currentName });
        },
      });
    }

    if (!applyToSelection && !isFolder) {
      items.push({
        label: "Get Info…",
        icon: <Info className="w-3.5 h-3.5" />,
        onClick: () => setInfoKey(key),
      });
      items.push({
        label: "Edit Headers…",
        icon: <Tag className="w-3.5 h-3.5" />,
        onClick: () => setEditHeadersKey(key),
      });
    }

    items.push({
      label: applyToSelection ? `Delete ${targets.length} items` : "Delete",
      icon: <Trash2 className="w-3.5 h-3.5" />,
      danger: true,
      onClick: () => setModal({ type: "delete", keys: targets }),
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
    return <BucketsPane connectionId={connId} />;
  }

  // ── Breadcrumbs ────────────────────────────────────────────────────────────

  const breadcrumbSegments = prefix ? prefix.replace(/\/$/, "").split("/") : [];
  const currentFolderName =
    breadcrumbSegments.length === 0
      ? bucket
      : breadcrumbSegments[breadcrumbSegments.length - 1];
  const hasSelection = selection.size > 0;
  const allChecked = allKeys.length > 0 && selection.size === allKeys.length;
  const someChecked = selection.size > 0 && selection.size < allKeys.length;
  const singleSelectedIsFile =
    selection.size === 1 && !listing.folders.includes([...selection][0]);
  const canBack = back.length > 0;
  const canForward = forward.length > 0;

  // ── Row renderers ──────────────────────────────────────────────────────────
  // Both folder and file rows accept a `depth` so that the children of an
  // expanded folder can be rendered indented under their parent — matching
  // the disclosure-triangle behaviour of Finder's list view. Depth 0 is the
  // current `prefix`; each nested level adds 16px of name-cell indent.

  const indentPx = (depth: number) => ({ paddingLeft: `${depth * 16}px` });

  const renderFolderRow = (
    folder: string,
    parentPrefix: string,
    depth: number,
  ) => {
    const displayName = folderDisplayName(folder, parentPrefix);
    const isSelected = selection.has(folder);
    const child = expanded[folder];
    const isOpen = !!child;
    return (
      <React.Fragment key={folder}>
        <tr
          onClick={(e) => toggleSelect(folder, e)}
          onDoubleClick={() => navigateInto(folder.slice(prefix.length))}
          onContextMenu={(e) => {
            e.preventDefault();
            setContextMenu({
              position: { x: e.clientX, y: e.clientY },
              key: folder,
              isFolder: true,
            });
          }}
          className={cn(
            // Slightly lighter than the page background so rows pop in dark
            // mode and don't read as a flat dark-gray block.
            "border-b border-black/4 dark:border-white/6 dark:bg-white/3 cursor-pointer select-none",
            "hover:bg-black/4 dark:hover:bg-white/7",
            isSelected && "bg-blue-50 dark:bg-blue-500/15",
          )}
          data-testid={`folder-row-${folder}`}
        >
          <td
            className="px-3 py-1"
            onClick={(e) => {
              e.stopPropagation();
              toggleCheckbox(folder);
            }}
          >
            <input
              type="checkbox"
              className="checkbox-mac pointer-events-none"
              checked={isSelected}
              readOnly
            />
          </td>
          <td className="px-3 py-1">
            <div className="flex items-center gap-1" style={indentPx(depth)}>
              {/*
                Disclosure triangle — Finder list-view style. Sits at the
                start of the Name cell (immediately after the checkbox
                column) so nested children align cleanly under their
                parent. Click toggles inline expansion without navigating.
              */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleExpand(folder);
                }}
                className={cn(
                  "p-0.5 rounded hover:bg-black/8 dark:hover:bg-white/8 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 transition-transform shrink-0",
                  isOpen && "rotate-90",
                )}
                aria-label={
                  isOpen ? `Collapse ${displayName}` : `Expand ${displayName}`
                }
                aria-expanded={isOpen}
                title={isOpen ? "Collapse" : "Expand"}
                data-testid={`disclosure-${folder}`}
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
              <Folder className="w-4 h-4 text-yellow-500 shrink-0 ml-0.5" />
              <span className="truncate">{displayName}</span>
            </div>
          </td>
          <td className="px-3 py-1 text-neutral-400 dark:text-neutral-500 whitespace-nowrap">
            Folder
          </td>
          <td className="px-3 py-1 text-neutral-400 whitespace-nowrap">—</td>
          <td className="px-3 py-1 text-right text-neutral-400 whitespace-nowrap">
            —
          </td>
          <td className="px-3 py-1 text-right text-neutral-400 whitespace-nowrap">
            —
          </td>
          <td className="px-1.5 py-1 text-right">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                const r = (
                  e.currentTarget as HTMLElement
                ).getBoundingClientRect();
                setContextMenu({
                  position: { x: r.right, y: r.bottom },
                  key: folder,
                  isFolder: true,
                });
              }}
              className="p-1 rounded hover:bg-black/8 dark:hover:bg-white/8 text-neutral-500"
              aria-label="Actions"
              title="Actions"
            >
              <MoreHorizontal className="w-3.5 h-3.5" />
            </button>
          </td>
        </tr>
        {isOpen && child && renderChildren(folder, child, depth + 1)}
      </React.Fragment>
    );
  };

  const renderFileRow = (
    file: ObjectInfo,
    parentPrefix: string,
    depth: number,
  ) => {
    const displayName = file.key.slice(parentPrefix.length);
    const isSelected = selection.has(file.key);
    const modDate = file.last_modified ? new Date(file.last_modified) : null;
    const ctEntry = contentTypes[file.key];
    const typeLabel =
      ctEntry === undefined
        ? s3DefaultContentType(file.key)
        : (ctEntry ?? s3DefaultContentType(file.key));
    return (
      <tr
        key={file.key}
        onClick={(e) => toggleSelect(file.key, e)}
        onDoubleClick={() => setPreviewKey(file.key)}
        onContextMenu={(e) => {
          e.preventDefault();
          setContextMenu({
            position: { x: e.clientX, y: e.clientY },
            key: file.key,
            isFolder: false,
          });
        }}
        className={cn(
          "border-b border-black/4 dark:border-white/6 dark:bg-white/3 cursor-pointer select-none",
          "hover:bg-black/4 dark:hover:bg-white/7",
          isSelected && "bg-blue-50 dark:bg-blue-500/15",
        )}
      >
        <td
          className="px-3 py-1"
          onClick={(e) => {
            e.stopPropagation();
            toggleCheckbox(file.key);
          }}
        >
          <input
            type="checkbox"
            className="checkbox-mac pointer-events-none"
            checked={isSelected}
            readOnly
          />
        </td>
        <td className="px-3 py-1">
          <div className="flex items-center gap-2" style={indentPx(depth)}>
            {/* Spacer keeps file names aligned with folder names that have
                a disclosure triangle to their left. */}
            <span className="w-4 shrink-0" aria-hidden="true" />
            <FileIcon className="w-4 h-4 text-neutral-400 shrink-0" />
            <span className="truncate">{displayName}</span>
          </div>
        </td>
        <td className="px-3 py-1 text-neutral-400 dark:text-neutral-500 truncate whitespace-nowrap">
          {typeLabel}
        </td>
        <td className="px-3 py-1 text-neutral-400 dark:text-neutral-500 truncate whitespace-nowrap">
          {file.storage_class ?? <span className="text-neutral-400">—</span>}
        </td>
        <td className="px-3 py-1 text-right text-neutral-400 dark:text-neutral-500 tabular-nums whitespace-nowrap">
          {formatSize(file.size)}
        </td>
        <td className="px-3 py-1 text-right text-neutral-400 dark:text-neutral-500 tabular-nums whitespace-nowrap">
          {modDate ? (
            <Tooltip
              content={`${format(modDate, "yyyy-MM-dd HH:mm:ss")} · ${formatDistanceToNow(modDate, { addSuffix: true })}`}
              side="left"
            >
              <span>{shortDate(modDate)}</span>
            </Tooltip>
          ) : (
            <span className="text-neutral-400">—</span>
          )}
        </td>
        <td className="px-1.5 py-1 text-right">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              const r = (
                e.currentTarget as HTMLElement
              ).getBoundingClientRect();
              setContextMenu({
                position: { x: r.right, y: r.bottom },
                key: file.key,
                isFolder: false,
              });
            }}
            className="p-1 rounded hover:bg-black/8 dark:hover:bg-white/8 text-neutral-500"
            aria-label="Actions"
            title="Actions"
          >
            <MoreHorizontal className="w-3.5 h-3.5" />
          </button>
        </td>
      </tr>
    );
  };

  /**
   * Renders the rows for a folder's expanded children. Mirrors the parent
   * layout (folders first, then files) and propagates the depth so deeper
   * nesting compounds the indentation. Errors and loading states each get
   * a single placeholder row that occupies the table width.
   */
  const renderChildren = (
    parentFolder: string,
    listing: ChildListing,
    depth: number,
  ): React.ReactNode => {
    if (listing.loading) {
      return (
        <tr key={`${parentFolder}-loading`} aria-live="polite">
          <td className="px-3 py-1" />
          <td className="px-3 py-1" colSpan={6}>
            <div
              className="flex items-center gap-2 text-xs text-neutral-500"
              style={indentPx(depth)}
            >
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…
            </div>
          </td>
        </tr>
      );
    }
    if (listing.error) {
      return (
        <tr key={`${parentFolder}-error`}>
          <td className="px-3 py-1" />
          <td className="px-3 py-1 text-xs text-red-500" colSpan={6}>
            <div style={indentPx(depth)}>{listing.error}</div>
          </td>
        </tr>
      );
    }
    if (listing.folders.length === 0 && listing.files.length === 0) {
      return (
        <tr key={`${parentFolder}-empty`}>
          <td className="px-3 py-1" />
          <td className="px-3 py-1 text-xs text-neutral-400 italic" colSpan={6}>
            <div style={indentPx(depth)}>Empty</div>
          </td>
        </tr>
      );
    }
    return (
      <>
        {listing.folders.map((f) => renderFolderRow(f, parentFolder, depth))}
        {listing.files.map((f) => renderFileRow(f, parentFolder, depth))}
      </>
    );
  };

  // ── Toolbar items ──────────────────────────────────────────────────────────
  // Defined declaratively so the OverflowToolbar can promote any of them
  // into the "…" overflow menu when the window is narrow. `priority`
  // controls drop order: lower = collapses first. The Filter input, the
  // primary Upload action, the selection-count badge and Refresh live
  // outside the OverflowToolbar entirely so they always stay visible.
  const singleSelectedKey = selection.size === 1 ? [...selection][0] : null;
  const toolbarItems: OverflowItem[] = [];
  if (hasSelection && selection.size === 1 && singleSelectedIsFile) {
    toolbarItems.push({
      key: "preview",
      priority: 30,
      render: () => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setPreviewKey([...selection][0])}
        >
          <Eye className="w-3.5 h-3.5" />
          Preview
        </Button>
      ),
      menu: {
        label: "Preview",
        icon: <Eye className="w-3.5 h-3.5" />,
        onClick: () => singleSelectedKey && setPreviewKey(singleSelectedKey),
      },
    });
  }
  if (hasSelection) {
    toolbarItems.push({
      key: "download",
      priority: 50,
      render: () => (
        <Button variant="ghost" size="sm" onClick={handleHeaderDownload}>
          <Download className="w-3.5 h-3.5" />
          Download
        </Button>
      ),
      menu: {
        label: "Download",
        icon: <Download className="w-3.5 h-3.5" />,
        onClick: handleHeaderDownload,
      },
    });
    toolbarItems.push({
      key: "copy",
      priority: 40,
      render: () => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            setModal({ type: "copyTo", keys: [...selection], mode: "copy" })
          }
          title="Copy to another bucket"
        >
          <ArrowRightLeft className="w-3.5 h-3.5" />
          Copy to…
        </Button>
      ),
      menu: {
        label: "Copy to…",
        icon: <ArrowRightLeft className="w-3.5 h-3.5" />,
        onClick: () =>
          setModal({ type: "copyTo", keys: [...selection], mode: "copy" }),
      },
    });
    toolbarItems.push({
      key: "move",
      priority: 35,
      render: () => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            setModal({ type: "copyTo", keys: [...selection], mode: "move" })
          }
          title="Move to another bucket or folder"
        >
          <MoveRight className="w-3.5 h-3.5" />
          Move to…
        </Button>
      ),
      menu: {
        label: "Move to…",
        icon: <MoveRight className="w-3.5 h-3.5" />,
        onClick: () =>
          setModal({ type: "copyTo", keys: [...selection], mode: "move" }),
      },
    });
  }
  if (hasSelection && selection.size === 1 && singleSelectedIsFile) {
    toolbarItems.push({
      key: "info",
      priority: 20,
      render: () => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setInfoKey([...selection][0])}
          title="Get info"
        >
          <Info className="w-3.5 h-3.5" />
          Info
        </Button>
      ),
      menu: {
        label: "Get Info…",
        icon: <Info className="w-3.5 h-3.5" />,
        onClick: () => singleSelectedKey && setInfoKey(singleSelectedKey),
      },
    });
    toolbarItems.push({
      key: "headers",
      priority: 10,
      render: () => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setEditHeadersKey([...selection][0])}
          title="Edit headers and user metadata"
        >
          <Tag className="w-3.5 h-3.5" />
          Headers
        </Button>
      ),
      menu: {
        label: "Edit Headers…",
        icon: <Tag className="w-3.5 h-3.5" />,
        onClick: () =>
          singleSelectedKey && setEditHeadersKey(singleSelectedKey),
      },
    });
  }
  toolbarItems.push({
    key: "new-folder",
    priority: 60,
    render: () => (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          setNewFolderValue("");
          setModal({ type: "newFolder" });
        }}
      >
        <FolderPlus className="w-3.5 h-3.5" />
        New Folder
      </Button>
    ),
    menu: {
      label: "New Folder",
      icon: <FolderPlus className="w-3.5 h-3.5" />,
      onClick: () => {
        setNewFolderValue("");
        setModal({ type: "newFolder" });
      },
    },
  });

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className={cn(
        "flex flex-col h-full outline-none transition-[box-shadow,background-color]",
        isDragOver &&
          "ring-2 ring-inset ring-[#007AFF] bg-blue-50/20 dark:bg-blue-950/20",
      )}
    >
      {/* ── Header ── */}
      {/*
        `relative z-20` here is important: the table header inside the body
        creates its own stacking context (sticky + backdrop-blur), so without
        an explicit z on the toolbar the Upload dropdown would be painted
        beneath the table head.
      */}
      <div className="relative z-20 flex items-center px-4 py-2 border-b border-black/8 dark:border-white/8 shrink-0 gap-3 min-h-[44px] flex-nowrap overflow-visible">
        {/*
          Finder-style navigation cluster: back/forward chevrons followed by
          the current folder name. The full breadcrumb path lives in the
          path bar at the bottom of the window, mirroring macOS Finder.
        */}
        <div className="flex items-center gap-2 min-w-0 shrink overflow-hidden">
          <div
            className="flex items-center gap-0.5 shrink-0"
            role="group"
            aria-label="History navigation"
          >
            <Button
              variant="ghost"
              size="icon"
              onClick={goBack}
              disabled={!canBack}
              aria-label="Back"
              title="Back (⌘[)"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={goForward}
              disabled={!canForward}
              aria-label="Forward"
              title="Forward (⌘])"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
          <h2
            className="text-[13px] font-semibold truncate"
            data-testid="current-folder-name"
            title={currentFolderName ?? ""}
          >
            {currentFolderName}
          </h2>
        </div>

        {/*
          Right cluster — keep only a few primary controls always visible:
            • Selection count
            • Overflow "…" menu for all secondary actions
            • Filter input
            • Upload
            • Refresh
        */}
        <div className="flex-1 min-w-0 flex items-center gap-2 flex-nowrap overflow-visible justify-end">
          {hasSelection && (
            <span
              className="text-[11px] text-neutral-500 dark:text-neutral-400 select-none shrink-0"
              data-testid="selection-count"
            >
              {selection.size} selected
            </span>
          )}
          <div className="relative shrink-0">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-neutral-400 pointer-events-none" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter…"
              className="pl-7 h-7 w-36 text-xs"
              aria-label="Filter"
            />
          </div>
          <UploadSplitButton
            onUploadFiles={handleUpload}
            onUploadFolder={handleUploadFolder}
          />
          {/*
            Secondary-actions overflow menu sits between Upload and Refresh
            so the primary upload action stays anchored. The right margin
            mirrors the visual width of the Refresh button below — without
            it the "…" and the refresh chevron read as a single chunky
            cluster, which made it hard to tell them apart at a glance.
          */}
          <OverflowToolbar
            items={toolbarItems}
            className="w-8 flex-none overflow-visible mr-2"
          />
          <Button
            variant="ghost"
            size="icon"
            onClick={hardRefresh}
            aria-label="Refresh"
            title="Refresh"
          >
            <RotateCw
              className={cn("w-3.5 h-3.5", listing.loading && "animate-spin")}
            />
          </Button>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex-1 min-h-0 overflow-auto">
        {/*
          Only show the skeleton when we don't have any rows to show yet —
          a refresh on top of an already-populated table keeps the existing
          rows on screen and shows progress through the spinning Refresh
          icon and the transfer queue. Without this guard every queued
          delete / upload / rename blanked the table for a frame, which
          read as the app flickering.
        */}
        {listing.loading &&
        listing.folders.length === 0 &&
        listing.files.length === 0 ? (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-black/8 dark:border-white/8">
                <th className="w-10 px-3 py-2" />
                <th className="text-left px-3 py-2 font-medium text-neutral-500 text-xs">
                  Name
                </th>
                <th className="text-left px-3 py-2 font-medium text-neutral-500 text-xs w-20">
                  Type
                </th>
                <th className="text-left px-3 py-2 font-medium text-neutral-500 text-xs w-28">
                  Storage
                </th>
                <th className="text-right px-3 py-2 font-medium text-neutral-500 text-xs w-24">
                  Size
                </th>
                <th className="text-right px-3 py-2 font-medium text-neutral-500 text-xs w-36">
                  Modified
                </th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 6 }).map((_, i) => (
                <tr
                  key={i}
                  className="border-b border-black/4 dark:border-white/6"
                >
                  <td className="px-3 py-1">
                    <Skeleton className="w-4 h-4" />
                  </td>
                  <td className="px-3 py-1">
                    <Skeleton
                      className={cn("h-4", i % 2 === 0 ? "w-52" : "w-36")}
                    />
                  </td>
                  <td className="px-3 py-1">
                    <Skeleton className="h-4 w-10" />
                  </td>
                  <td className="px-3 py-1">
                    <Skeleton className="h-4 w-16" />
                  </td>
                  <td className="px-3 py-1 text-right">
                    <Skeleton className="h-4 w-16 ml-auto" />
                  </td>
                  <td className="px-3 py-1 text-right">
                    <Skeleton className="h-4 w-24 ml-auto" />
                  </td>
                  <td />
                </tr>
              ))}
            </tbody>
          </table>
        ) : allKeys.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <EmptyState
              title={
                listing.folders.length + listing.files.length === 0
                  ? "This folder is empty"
                  : "No matches"
              }
              description={
                listing.folders.length + listing.files.length === 0
                  ? "Upload files or create a folder to get started."
                  : "Try a different filter."
              }
            />
          </div>
        ) : (
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 z-1 bg-white/80 dark:bg-neutral-900/80 backdrop-blur-sm">
              <tr className="border-b border-black/8 dark:border-white/8">
                <th className="w-10 px-3 py-2">
                  <input
                    type="checkbox"
                    className="checkbox-mac"
                    checked={allChecked}
                    ref={(el) => {
                      if (el) el.indeterminate = someChecked;
                    }}
                    onChange={(e) => {
                      setSelection(
                        e.target.checked ? new Set(allKeys) : new Set(),
                      );
                    }}
                    aria-label="Select all"
                  />
                </th>
                <SortableHeader
                  label="Name"
                  col="name"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={(k) => {
                    if (sortKey === k)
                      setSortDir(sortDir === "asc" ? "desc" : "asc");
                    else {
                      setSortKey(k);
                      setSortDir("asc");
                    }
                  }}
                  align="left"
                />
                <SortableHeader
                  label="Type"
                  col="type"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={(k) => {
                    if (sortKey === k)
                      setSortDir(sortDir === "asc" ? "desc" : "asc");
                    else {
                      setSortKey(k);
                      setSortDir("asc");
                    }
                  }}
                  align="left"
                  width="w-20"
                />
                <SortableHeader
                  label="Storage"
                  col="storage"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={(k) => {
                    if (sortKey === k)
                      setSortDir(sortDir === "asc" ? "desc" : "asc");
                    else {
                      setSortKey(k);
                      setSortDir("asc");
                    }
                  }}
                  align="left"
                  width="w-28"
                />
                <SortableHeader
                  label="Size"
                  col="size"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={(k) => {
                    if (sortKey === k)
                      setSortDir(sortDir === "asc" ? "desc" : "asc");
                    else {
                      setSortKey(k);
                      setSortDir("desc");
                    }
                  }}
                  align="right"
                  width="w-24"
                />
                <SortableHeader
                  label="Modified"
                  col="modified"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={(k) => {
                    if (sortKey === k)
                      setSortDir(sortDir === "asc" ? "desc" : "asc");
                    else {
                      setSortKey(k);
                      setSortDir("desc");
                    }
                  }}
                  align="right"
                  width="w-36"
                />
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {visibleFolders.map((folder) =>
                renderFolderRow(folder, prefix, 0),
              )}
              {visibleFiles.map((file) => renderFileRow(file, prefix, 0))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Path bar (Finder-style) ── */}
      {/*
        Finder shows the full hierarchy as a clickable breadcrumb pinned to
        the bottom of the window. We mirror that here so the top toolbar can
        focus on history navigation and actions while the path bar stays
        out of the way until it's needed.
      */}
      <nav
        className="shrink-0 flex items-center gap-0.5 px-3 py-1.5 border-t border-black/8 dark:border-white/8 bg-black/3 dark:bg-white/3 text-xs overflow-x-auto"
        aria-label="Path"
        data-testid="path-bar"
      >
        <button
          type="button"
          onClick={() => setPrefix("")}
          className={cn(
            "shrink-0 px-1.5 py-0.5 rounded hover:bg-black/8 dark:hover:bg-white/8 transition-colors truncate max-w-[200px]",
            breadcrumbSegments.length === 0
              ? "font-medium text-neutral-700 dark:text-neutral-200"
              : "text-neutral-500 dark:text-neutral-400",
          )}
        >
          {bucket}
        </button>
        {breadcrumbSegments.map((seg, idx) => (
          <React.Fragment key={idx}>
            <ChevronRight
              className="w-3 h-3 text-neutral-400 shrink-0"
              aria-hidden="true"
            />
            <button
              type="button"
              onClick={() => navigateToBreadcrumb(idx)}
              className={cn(
                "px-1.5 py-0.5 rounded hover:bg-black/8 dark:hover:bg-white/8 transition-colors truncate max-w-[140px]",
                idx === breadcrumbSegments.length - 1
                  ? "font-medium text-neutral-700 dark:text-neutral-200"
                  : "text-neutral-500 dark:text-neutral-400",
              )}
            >
              {seg}
            </button>
          </React.Fragment>
        ))}
      </nav>

      {/* ── Context Menu ── */}
      {contextMenu && (
        <ContextMenu
          position={contextMenu.position}
          items={buildContextMenuItems(contextMenu)}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* ── Delete Modal ── */}
      {modal?.type === "delete" && (
        <Modal
          open
          onClose={() => setModal(null)}
          title={`Delete ${modal.keys.length} item${modal.keys.length !== 1 ? "s" : ""}?`}
        >
          <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-3">
            This action cannot be undone.
            {modal.keys.some((k) => listing.folders.includes(k)) && (
              <>
                {" "}
                All objects inside selected folders will also be permanently
                deleted.
              </>
            )}
          </p>
          <ul className="mb-4 max-h-48 overflow-y-auto rounded-md border border-black/8 dark:border-white/8 bg-black/3 dark:bg-white/4 text-xs">
            {modal.keys.slice(0, 100).map((k) => {
              const isFolder = listing.folders.includes(k);
              const display = isFolder
                ? k.slice(prefix.length).replace(/\/$/, "") + "/"
                : k.slice(prefix.length);
              return (
                <li
                  key={k}
                  className="flex items-center gap-2 px-2.5 py-1 border-b last:border-b-0 border-black/5 dark:border-white/5"
                >
                  {isFolder ? (
                    <Folder className="w-3.5 h-3.5 text-yellow-500 shrink-0" />
                  ) : (
                    <FileIcon className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                  )}
                  <span className="truncate font-mono">{display}</span>
                </li>
              );
            })}
            {modal.keys.length > 100 && (
              <li className="px-2.5 py-1 text-neutral-500 italic">
                …and {modal.keys.length - 100} more
              </li>
            )}
          </ul>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setModal(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => handleDeleteConfirm(modal.keys)}
            >
              Delete
            </Button>
          </div>
        </Modal>
      )}

      {/* ── Rename Modal ── */}
      {modal?.type === "rename" && (
        <Modal
          open
          onClose={() => setModal(null)}
          title={modal.isFolder ? "Rename or move folder" : "Rename or move"}
        >
          <div className="flex flex-col gap-4">
            <Input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter")
                  handleRename(modal.key, renameValue, modal.isFolder);
              }}
              autoFocus
            />
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              {modal.isFolder
                ? "All objects under this folder will be copied to the new prefix and the originals deleted. This may take a moment for large folders. Use a slash to move into a subfolder, e.g. archive/2024."
                : "Use a slash to move the file into a subfolder, e.g. images/photo.jpg."}
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setModal(null)}>
                Cancel
              </Button>
              <Button
                onClick={() =>
                  handleRename(modal.key, renameValue, modal.isFolder)
                }
              >
                Rename
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── New Folder Modal ── */}
      {modal?.type === "newFolder" && (
        <Modal open onClose={() => setModal(null)} title="New Folder">
          <div className="flex flex-col gap-4">
            <Input
              placeholder="Folder name"
              value={newFolderValue}
              onChange={(e) => setNewFolderValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleNewFolder(newFolderValue);
              }}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setModal(null)}>
                Cancel
              </Button>
              <Button
                onClick={() => handleNewFolder(newFolderValue)}
                disabled={!newFolderValue.trim()}
              >
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
          objectKey={infoKey ?? ""}
          mode="info"
        />
      )}

      {/* ── Edit Headers Modal ── */}
      {connId && bucket && (
        <ObjectInfoModal
          open={editHeadersKey !== null}
          onClose={() => setEditHeadersKey(null)}
          connectionId={connId}
          bucket={bucket}
          objectKey={editHeadersKey ?? ""}
          mode="edit"
          onSaved={() => softRefresh()}
        />
      )}

      {/* ── File Preview Modal ── */}
      {connId && bucket && previewKey && (
        <FilePreviewModal
          open
          onClose={() => setPreviewKey(null)}
          connectionId={connId}
          bucket={bucket}
          objectKey={previewKey}
        />
      )}

      {/* ── Copy / Move Modal ── */}
      {connId && bucket && modal?.type === "copyTo" && (
        <CopyToModal
          open
          onClose={() => setModal(null)}
          srcConnectionId={connId}
          srcBucket={bucket}
          keys={modal.keys}
          mode={modal.mode}
          onCompleted={() => softRefresh()}
        />
      )}
    </div>
  );
}
