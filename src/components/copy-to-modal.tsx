"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  ChevronRight,
  Folder as FolderIcon,
  FolderPlus,
  Check,
  Loader2,
  Home,
} from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { useAppStore } from "@/store/app-store";
import { useTransfersStore, type MoveBatchItem } from "@/store/transfers-store";
import {
  listBuckets,
  listObjects,
  listKeysUnder,
  createFolder,
  type BucketInfo,
} from "@/lib/tauri";
import { normalizeDstPrefix, selfCopyReason } from "@/lib/copy-targets";

export interface CopyToModalProps {
  open: boolean;
  onClose: () => void;
  /** Source connection */
  srcConnectionId: string;
  srcBucket: string;
  /** Object keys to copy. Folders (keys ending in '/') are expanded recursively. */
  keys: string[];
  /**
   * `copy` enqueues a copy per file and leaves the source intact.
   * `move` does the same and then deletes each source whose copy succeeded
   * (the deletion is performed by the transfers store, not here).
   */
  mode?: "copy" | "move";
  /** Fired right after the queue has been populated, so the caller can
   *  refresh its view. Move-completion deletes happen asynchronously. */
  onCompleted?: () => void;
}

interface TreeNode {
  prefix: string;
  children: string[] | null;
  loading: boolean;
  error: string | null;
  expanded: boolean;
}

/**
 * Bucket-to-bucket (or same-bucket) copy / move modal.
 *
 * The destination is picked from a folder tree: every folder has a
 * disclosure triangle that expands its children inline (matching the main
 * object browser), and clicking a row *selects* that folder as the
 * destination. A "New Folder" button creates a sub-folder under the
 * currently selected destination so the user can carve out a fresh
 * target without leaving the modal.
 *
 * Move semantics: source files are deleted only after their individual
 * copy succeeds (delegated to the transfers store), so a partial /
 * cancelled / failed copy never destroys the original.
 */
export default function CopyToModal({
  open,
  onClose,
  srcConnectionId,
  srcBucket,
  keys,
  mode = "copy",
  onCompleted,
}: CopyToModalProps) {
  const connections = useAppStore((s) => s.connections);
  const enqueueCopy = useTransfersStore((s) => s.enqueueCopy);
  const enqueueMove = useTransfersStore((s) => s.enqueueMove);
  const srcPrefix = useAppStore((s) => s.prefix);

  const [dstConnId, setDstConnId] = React.useState<string>(srcConnectionId);
  const [dstBuckets, setDstBuckets] = React.useState<BucketInfo[] | null>(null);
  const [dstBucket, setDstBucket] = React.useState<string>(srcBucket);
  const [selectedPrefix, setSelectedPrefix] = React.useState<string>("");
  const [tree, setTree] = React.useState<Record<string, TreeNode>>({
    "": {
      prefix: "",
      children: null,
      loading: false,
      error: null,
      expanded: true,
    },
  });
  const [loadingBuckets, setLoadingBuckets] = React.useState(false);
  const [expanding, setExpanding] = React.useState(false);
  const [creatingFolder, setCreatingFolder] = React.useState(false);
  const [newFolderName, setNewFolderName] = React.useState("");
  const [showNewFolderInput, setShowNewFolderInput] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional reset when modal (re)opens with new src context
    setDstConnId(srcConnectionId);
    setDstBucket(srcBucket);
    setSelectedPrefix("");
    setTree({
      "": {
        prefix: "",
        children: null,
        loading: false,
        error: null,
        expanded: true,
      },
    });
    setShowNewFolderInput(false);
    setNewFolderName("");
  }, [open, srcConnectionId, srcBucket]);

  React.useEffect(() => {
    if (!open || !dstConnId) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing async fetch state
    setLoadingBuckets(true);
    setDstBuckets(null);
    listBuckets(dstConnId)
      .then((list) => {
        if (cancelled) return;
        setDstBuckets(list);
        if (list.length > 0 && !list.find((b) => b.name === dstBucket)) {
          setDstBucket(list[0].name);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        toast.error(
          `Failed to load buckets: ${err instanceof Error ? err.message : String(err)}`,
        );
        setDstBuckets([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingBuckets(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, dstConnId, dstBucket]);

  // Reset the tree when the destination bucket / connection changes —
  // listings from a previous destination are meaningless.
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional reset on destination change
    setSelectedPrefix("");
    setTree({
      "": {
        prefix: "",
        children: null,
        loading: false,
        error: null,
        expanded: true,
      },
    });
  }, [dstBucket, dstConnId]);

  const loadChildren = React.useCallback(
    async (prefix: string) => {
      setTree((t) => ({
        ...t,
        [prefix]: {
          prefix,
          children: t[prefix]?.children ?? null,
          loading: true,
          error: null,
          expanded: t[prefix]?.expanded ?? true,
        },
      }));
      try {
        const page = await listObjects(dstConnId, dstBucket, prefix);
        setTree((t) => ({
          ...t,
          [prefix]: {
            ...(t[prefix] ?? {
              prefix,
              expanded: true,
              children: null,
              loading: false,
              error: null,
            }),
            prefix,
            children: page.folders,
            loading: false,
            error: null,
          },
        }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setTree((t) => ({
          ...t,
          [prefix]: {
            ...(t[prefix] ?? {
              prefix,
              expanded: true,
              children: null,
              loading: false,
              error: null,
            }),
            prefix,
            loading: false,
            error: msg,
          },
        }));
      }
    },
    [dstConnId, dstBucket],
  );

  // Fetch the root listing once the modal is showing and we know the
  // destination bucket.
  React.useEffect(() => {
    if (!open || !dstConnId || !dstBucket) return;
    const root = tree[""];
    if (root && (root.children !== null || root.loading)) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch trigger
    void loadChildren("");
  }, [open, dstConnId, dstBucket, tree, loadChildren]);

  function toggleExpand(prefix: string) {
    const node = tree[prefix];
    const isExpanded = node?.expanded ?? false;
    if (!isExpanded && (node?.children == null || node?.error)) {
      void loadChildren(prefix);
    }
    setTree((t) => {
      const n = t[prefix] ?? {
        prefix,
        children: null,
        loading: false,
        error: null,
        expanded: false,
      };
      return { ...t, [prefix]: { ...n, expanded: !isExpanded } };
    });
  }

  async function handleCreateFolder() {
    const name = newFolderName.trim().replace(/^\/+|\/+$/g, "");
    if (!name) {
      setShowNewFolderInput(false);
      return;
    }
    setCreatingFolder(true);
    const parent = selectedPrefix; // create under current selection
    const fullPrefix = parent + name + "/";
    try {
      await createFolder(dstConnId, dstBucket, fullPrefix);
      toast.success(`Created "${name}"`);
      setShowNewFolderInput(false);
      setNewFolderName("");

      // Refresh the parent listing so the new folder appears, expand the
      // parent, and select the freshly-created folder. Mirrors the
      // expectation: "I created it because I want to put my files there."
      await loadChildren(parent);
      setTree((t) => {
        const p = t[parent];
        return p
          ? {
              ...t,
              [parent]: { ...p, expanded: true },
              [fullPrefix]: {
                prefix: fullPrefix,
                children: [],
                loading: false,
                error: null,
                expanded: false,
              },
            }
          : t;
      });
      setSelectedPrefix(fullPrefix);
    } catch (err) {
      toast.error(
        `Failed to create folder: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setCreatingFolder(false);
    }
  }

  function blockingReason(): string | null {
    return selfCopyReason({
      srcConnectionId,
      srcBucket,
      srcPrefix,
      selectedKeys: keys,
      dstConnectionId: dstConnId,
      dstBucket,
      dstPrefixRaw: selectedPrefix,
    });
  }

  async function handleConfirm() {
    if (!dstConnId || !dstBucket) {
      toast.error("Pick a destination bucket.");
      return;
    }
    const reason = blockingReason();
    if (reason) {
      toast.error(reason);
      return;
    }
    const dstPrefix = normalizeDstPrefix(selectedPrefix);

    const fileKeys = keys.filter((k) => !k.endsWith("/"));
    const folderKeys = keys.filter((k) => k.endsWith("/"));

    setExpanding(true);
    let queued = 0;
    try {
      if (mode === "move") {
        const items: MoveBatchItem[] = [];
        for (const key of fileKeys) {
          const name = key.split("/").filter(Boolean).pop() ?? key;
          const dstKey = dstPrefix + name;
          if (
            dstConnId === srcConnectionId &&
            dstBucket === srcBucket &&
            dstKey === key
          ) {
            continue;
          }
          items.push({
            kind: "file",
            srcKey: key,
            dstConnectionId: dstConnId,
            dstBucket,
            dstKey,
            name,
            subtitle: `${srcBucket}/${key}  →  ${dstBucket}/${dstKey}`,
          });
          queued++;
        }
        for (const folderKey of folderKeys) {
          const objects = await listKeysUnder(
            srcConnectionId,
            srcBucket,
            folderKey,
          );
          const folderName =
            folderKey.replace(/\/$/, "").split("/").pop() ?? "folder";
          const files: Extract<MoveBatchItem, { kind: "folder" }>["files"] = [];
          for (const obj of objects) {
            if (obj.key.endsWith("/")) continue;
            const rel = obj.key.slice(folderKey.length);
            if (!rel) continue;
            const dstKey = `${dstPrefix}${folderName}/${rel}`;
            if (
              dstConnId === srcConnectionId &&
              dstBucket === srcBucket &&
              dstKey === obj.key
            )
              continue;
            const name = rel.split("/").pop() ?? rel;
            files.push({
              srcKey: obj.key,
              dstConnectionId: dstConnId,
              dstBucket,
              dstKey,
              name,
              subtitle: `${srcBucket}/${obj.key}  →  ${dstBucket}/${dstKey}`,
            });
            queued++;
          }
          items.push({ kind: "folder", srcFolderKey: folderKey, files });
        }
        if (items.length > 0) {
          enqueueMove({ srcConnectionId, srcBucket, items });
        }
      } else {
        for (const key of fileKeys) {
          const name = key.split("/").filter(Boolean).pop() ?? key;
          const dstKey = dstPrefix + name;
          if (
            dstConnId === srcConnectionId &&
            dstBucket === srcBucket &&
            dstKey === key
          ) {
            continue;
          }
          enqueueCopy({
            srcConnectionId,
            srcBucket,
            srcKey: key,
            dstConnectionId: dstConnId,
            dstBucket,
            dstKey,
            name,
            subtitle: `${srcBucket}/${key}  →  ${dstBucket}/${dstKey}`,
          });
          queued++;
        }
        for (const folderKey of folderKeys) {
          const objects = await listKeysUnder(
            srcConnectionId,
            srcBucket,
            folderKey,
          );
          const folderName =
            folderKey.replace(/\/$/, "").split("/").pop() ?? "folder";
          for (const obj of objects) {
            if (obj.key.endsWith("/")) continue;
            const rel = obj.key.slice(folderKey.length);
            if (!rel) continue;
            const dstKey = `${dstPrefix}${folderName}/${rel}`;
            if (
              dstConnId === srcConnectionId &&
              dstBucket === srcBucket &&
              dstKey === obj.key
            )
              continue;
            const name = rel.split("/").pop() ?? rel;
            enqueueCopy({
              srcConnectionId,
              srcBucket,
              srcKey: obj.key,
              dstConnectionId: dstConnId,
              dstBucket,
              dstKey,
              name,
              subtitle: `${srcBucket}/${obj.key}  →  ${dstBucket}/${dstKey}`,
            });
            queued++;
          }
        }
      }
    } catch (err) {
      toast.error(
        `Failed to expand folder: ${err instanceof Error ? err.message : String(err)}`,
      );
      setExpanding(false);
      return;
    }
    setExpanding(false);
    if (queued === 0) {
      toast.error(
        "Nothing to transfer — every item in the selection already exists at that destination.",
      );
      return;
    }
    if (mode === "move") {
      toast.success(
        `Queued ${queued} move transfer${queued === 1 ? "" : "s"} — sources will be removed once each copy completes.`,
      );
    } else {
      toast.success(`Queued ${queued} copy transfer${queued === 1 ? "" : "s"}`);
    }
    onCompleted?.();
    onClose();
  }

  const fileCount = keys.filter((k) => !k.endsWith("/")).length;
  const folderCount = keys.length - fileCount;
  const destinationLabel = selectedPrefix
    ? `${dstBucket}/${selectedPrefix}`
    : `${dstBucket}/`;

  function renderNode(prefix: string, depth: number): React.ReactNode {
    const node = tree[prefix];
    const isSelected = selectedPrefix === prefix;
    const isExpanded = !!node?.expanded;
    const isRoot = prefix === "";
    const label = isRoot
      ? dstBucket || "bucket"
      : (prefix.replace(/\/$/, "").split("/").pop() ?? prefix);

    const rows: React.ReactNode[] = [];
    rows.push(
      <li key={`row-${prefix || "__root__"}`}>
        <div
          className={cn(
            "group flex items-center gap-1 px-2 py-1 text-[13px] cursor-pointer rounded-md mx-1",
            isSelected
              ? "bg-[#007AFF]/15 text-[#007AFF]"
              : "hover:bg-black/5 dark:hover:bg-white/5",
          )}
          style={{ paddingLeft: `${depth * 16 + 6}px` }}
          onClick={() => setSelectedPrefix(prefix)}
          aria-selected={isSelected}
          data-testid={`copy-tree-row-${prefix || "__root__"}`}
        >
          {/* Disclosure triangle. The bucket-root row also gets one so
              the user can collapse the whole tree if the bucket has many
              top-level folders. */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              toggleExpand(prefix);
            }}
            className={cn(
              "p-0.5 rounded hover:bg-black/8 dark:hover:bg-white/8 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 transition-transform shrink-0",
              isExpanded && "rotate-90",
            )}
            aria-label={isExpanded ? `Collapse ${label}` : `Expand ${label}`}
            aria-expanded={isExpanded}
            data-testid={`copy-tree-disclosure-${prefix || "__root__"}`}
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
          {isRoot ? (
            <Home className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
          ) : (
            <FolderIcon className="w-3.5 h-3.5 text-yellow-500 shrink-0" />
          )}
          <span className="truncate">{label}</span>
          {isSelected && (
            <Check className="w-3.5 h-3.5 ml-auto text-[#007AFF] shrink-0" />
          )}
        </div>
      </li>,
    );

    if (isExpanded && node) {
      if (
        node.loading &&
        (node.children == null || node.children.length === 0)
      ) {
        rows.push(
          <li key={`load-${prefix}`}>
            <div
              className="flex items-center gap-2 px-2 py-1 text-xs text-neutral-500"
              style={{ paddingLeft: `${(depth + 1) * 16 + 6}px` }}
            >
              <Loader2 className="w-3 h-3 animate-spin" /> Loading…
            </div>
          </li>,
        );
      } else if (node.error) {
        rows.push(
          <li key={`err-${prefix}`}>
            <div
              className="px-2 py-1 text-xs text-red-500"
              style={{ paddingLeft: `${(depth + 1) * 16 + 6}px` }}
            >
              {node.error}
            </div>
          </li>,
        );
      } else if (node.children && node.children.length === 0) {
        rows.push(
          <li key={`empty-${prefix}`}>
            <div
              className="px-2 py-1 text-xs text-neutral-400 italic"
              style={{ paddingLeft: `${(depth + 1) * 16 + 6}px` }}
            >
              No subfolders
            </div>
          </li>,
        );
      } else if (node.children) {
        for (const child of node.children) {
          rows.push(renderNode(child, depth + 1));
        }
      }

      // Inline "New folder" input under the selected destination row.
      if (showNewFolderInput && isSelected) {
        rows.push(
          <li key={`new-${prefix}`}>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handleCreateFolder();
              }}
              className="flex items-center gap-2 px-2 py-1"
              style={{ paddingLeft: `${(depth + 1) * 16 + 6}px` }}
            >
              <FolderIcon className="w-3.5 h-3.5 text-yellow-500 shrink-0" />
              <Input
                autoFocus
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="New folder name"
                className="h-6 text-xs px-2"
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setShowNewFolderInput(false);
                    setNewFolderName("");
                  }
                }}
                data-testid="copy-new-folder-input"
              />
              <Button
                type="submit"
                size="sm"
                disabled={creatingFolder || !newFolderName.trim()}
              >
                Create
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowNewFolderInput(false);
                  setNewFolderName("");
                }}
              >
                Cancel
              </Button>
            </form>
          </li>,
        );
      }
    }

    return rows;
  }

  const verb = mode === "move" ? "Move" : "Copy";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${verb} ${keys.length} item${keys.length !== 1 ? "s" : ""} to…`}
      className="max-w-lg"
    >
      <div className="flex flex-col gap-3">
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          {fileCount} file{fileCount === 1 ? "" : "s"}
          {folderCount > 0 && (
            <>
              {", "}
              {folderCount} folder{folderCount === 1 ? "" : "s"} (contents
              expanded)
            </>
          )}
        </p>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Connection</Label>
            <Select
              value={dstConnId}
              onChange={(e) => setDstConnId(e.target.value)}
            >
              {connections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Bucket</Label>
            <Select
              value={dstBucket}
              onChange={(e) => setDstBucket(e.target.value)}
              disabled={loadingBuckets || !dstBuckets}
            >
              {loadingBuckets && <option>Loading…</option>}
              {!loadingBuckets && dstBuckets?.length === 0 && (
                <option value="">No buckets</option>
              )}
              {dstBuckets?.map((b) => (
                <option key={b.name} value={b.name}>
                  {b.name}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {/* Tree picker — click ▶︎ to expand a folder, click the row body to
            choose it as the destination. The selected row gets the macOS
            accent tint and a check on the right. */}
        <div className="rounded-md border border-black/10 dark:border-white/10 bg-white/60 dark:bg-neutral-900/60 overflow-hidden">
          <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-black/8 dark:border-white/8">
            <span className="text-[11px] uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
              Destination
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setShowNewFolderInput(true);
                // Ensure the parent has a tree entry, is expanded, and its
                // children are loaded so the inline input renders under it.
                setTree((t) => {
                  const p = t[selectedPrefix];
                  return {
                    ...t,
                    [selectedPrefix]: p
                      ? { ...p, expanded: true }
                      : {
                          prefix: selectedPrefix,
                          children: null,
                          loading: false,
                          error: null,
                          expanded: true,
                        },
                  };
                });
                if (
                  !tree[selectedPrefix] ||
                  (tree[selectedPrefix].children == null &&
                    !tree[selectedPrefix].loading)
                ) {
                  void loadChildren(selectedPrefix);
                }
              }}
              disabled={!dstBucket}
              data-testid="copy-create-folder-button"
            >
              <FolderPlus className="w-3.5 h-3.5" />
              New Folder
            </Button>
          </div>
          <ul
            className="max-h-64 overflow-auto py-1 pane-scroll"
            aria-label="Destination folder tree"
          >
            {renderNode("", 0)}
          </ul>
        </div>

        <div className="flex items-center gap-2 px-1 text-xs text-neutral-600 dark:text-neutral-400">
          <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
          <span className="truncate">
            {verb === "Move" ? "Moving to" : "Copying to"}:{" "}
            <span
              className="font-mono text-neutral-900 dark:text-neutral-100"
              data-testid="copy-destination"
            >
              {destinationLabel}
            </span>
          </span>
        </div>

        <div className="flex justify-end gap-2 mt-2">
          <Button variant="secondary" onClick={onClose} disabled={expanding}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={keys.length === 0 || !dstBucket || expanding}
            data-testid="copy-confirm-button"
          >
            {expanding ? "Queueing…" : verb}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
