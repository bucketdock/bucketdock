"use client";

import * as React from "react";
import { toast } from "sonner";

import {
  getPresignedUrl,
  readObjectPreview,
  type ObjectPreview,
} from "@/lib/tauri";
import { Modal } from "@/components/ui/modal";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";

// Files larger than this are not pulled into memory for the inline preview;
// the user is offered a presigned link instead.
const PREVIEW_MAX_BYTES = 4 * 1024 * 1024;

type PreviewKind = "image" | "text" | "audio" | "video" | "pdf" | "other";

const TEXT_EXT = new Set([
  "txt",
  "md",
  "json",
  "csv",
  "tsv",
  "log",
  "yaml",
  "yml",
  "toml",
  "xml",
  "html",
  "htm",
  "css",
  "scss",
  "js",
  "mjs",
  "cjs",
  "ts",
  "tsx",
  "jsx",
  "rs",
  "py",
  "go",
  "rb",
  "java",
  "c",
  "cc",
  "cpp",
  "h",
  "hpp",
  "sh",
  "bash",
  "zsh",
  "ini",
  "env",
  "sql",
  "graphql",
  "lock",
]);
const IMAGE_EXT = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "bmp",
  "ico",
]);
const AUDIO_EXT = new Set(["mp3", "wav", "ogg", "flac", "m4a"]);
const VIDEO_EXT = new Set(["mp4", "webm", "mov", "m4v"]);
const PDF_EXT = new Set(["pdf"]);

function ext(key: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(key);
  return m ? m[1].toLowerCase() : "";
}

function detectKind(key: string, contentType: string | null): PreviewKind {
  const e = ext(key);
  if (IMAGE_EXT.has(e) || (contentType ?? "").startsWith("image/"))
    return "image";
  if (PDF_EXT.has(e) || (contentType ?? "") === "application/pdf") return "pdf";
  if (AUDIO_EXT.has(e) || (contentType ?? "").startsWith("audio/"))
    return "audio";
  if (VIDEO_EXT.has(e) || (contentType ?? "").startsWith("video/"))
    return "video";
  if (TEXT_EXT.has(e) || (contentType ?? "").startsWith("text/")) return "text";
  return "other";
}

function decodeText(b64: string): string {
  // atob → binary string → UTF-8 decode
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  try {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } catch {
    return binary;
  }
}

interface Props {
  open: boolean;
  onClose: () => void;
  connectionId: string;
  bucket: string;
  objectKey: string;
}

export function FilePreviewModal({
  open,
  onClose,
  connectionId,
  bucket,
  objectKey,
}: Props) {
  const [loading, setLoading] = React.useState(false);
  const [preview, setPreview] = React.useState<ObjectPreview | null>(null);
  const [presigned, setPresigned] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const fileName = objectKey.split("/").filter(Boolean).pop() ?? objectKey;
  const kind = detectKind(objectKey, preview?.content_type ?? null);

  React.useEffect(() => {
    if (!open) return;
    setLoading(true);
    setPreview(null);
    setPresigned(null);
    setError(null);

    const e = ext(objectKey);
    const wantsMedia =
      IMAGE_EXT.has(e) ||
      AUDIO_EXT.has(e) ||
      VIDEO_EXT.has(e) ||
      PDF_EXT.has(e);

    // For media/PDF a presigned URL is always required (browsers can't render
    // a base64 video/PDF practically). For text-ish we read inline.
    Promise.allSettled([
      readObjectPreview(connectionId, bucket, objectKey, PREVIEW_MAX_BYTES),
      wantsMedia
        ? getPresignedUrl(connectionId, bucket, objectKey, 3600)
        : Promise.resolve<string | null>(null),
    ])
      .then(([p, u]) => {
        if (p.status === "fulfilled") setPreview(p.value);
        else setError(String((p as PromiseRejectedResult).reason));
        if (u.status === "fulfilled" && u.value) setPresigned(u.value);
      })
      .finally(() => setLoading(false));
  }, [open, connectionId, bucket, objectKey]);

  const renderBody = () => {
    if (loading) {
      return (
        <div className="flex items-center justify-center py-12">
          <Spinner className="w-6 h-6 text-neutral-400" />
        </div>
      );
    }
    if (error && !preview) {
      return (
        <p className="text-sm text-red-500 break-all">
          Failed to load: {error}
        </p>
      );
    }

    if (kind === "image" && presigned) {
      // eslint-disable-next-line @next/next/no-img-element
      return (
        <img
          src={presigned}
          alt={fileName}
          className="max-h-[60vh] mx-auto rounded-md object-contain"
        />
      );
    }
    if (kind === "image" && preview) {
      const ct = preview.content_type ?? "image/png";
      // eslint-disable-next-line @next/next/no-img-element
      return (
        <img
          src={`data:${ct};base64,${preview.body_b64}`}
          alt={fileName}
          className="max-h-[60vh] mx-auto rounded-md object-contain"
        />
      );
    }
    if (kind === "video" && presigned) {
      return (
        <video
          src={presigned}
          controls
          className="max-h-[60vh] w-full rounded-md bg-black"
        />
      );
    }
    if (kind === "audio" && presigned) {
      return <audio src={presigned} controls className="w-full" />;
    }
    if (kind === "pdf" && presigned) {
      return (
        <iframe
          src={presigned}
          title={fileName}
          className="w-full h-[60vh] rounded-md border border-black/10 dark:border-white/10"
        />
      );
    }
    if (kind === "text" && preview) {
      const text = decodeText(preview.body_b64);
      return (
        <pre className="max-h-[60vh] overflow-auto text-xs font-mono whitespace-pre-wrap wrap-break-word p-3 rounded-md bg-black/4 dark:bg-white/5">
          {text}
        </pre>
      );
    }

    // Fallback
    return (
      <div className="text-sm text-neutral-500 dark:text-neutral-400 space-y-3">
        <p>No inline preview available for this file type.</p>
        {presigned && (
          <Button
            variant="secondary"
            size="sm"
            onClick={async () => {
              try {
                const { openUrl } = await import("@tauri-apps/plugin-opener");
                await openUrl(presigned);
              } catch (err) {
                toast.error(`Failed to open: ${err}`);
              }
            }}
          >
            Open in browser
          </Button>
        )}
      </div>
    );
  };

  return (
    <Modal open={open} onClose={onClose} title={fileName} className="max-w-3xl">
      <div className="flex flex-col gap-3">
        {renderBody()}
        {preview && !preview.complete && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            Preview truncated to {(PREVIEW_MAX_BYTES / 1024 / 1024).toFixed(0)}{" "}
            MB. Open the full file in a browser for the complete content.
          </p>
        )}
      </div>
    </Modal>
  );
}
