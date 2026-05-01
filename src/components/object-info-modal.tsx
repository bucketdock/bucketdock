'use client';

import * as React from 'react';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

import { getObjectMetadata, updateObjectMetadata, type ObjectMetadata } from '@/lib/tauri';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes < 1024 ** 4) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${(bytes / 1024 ** 4).toFixed(1)} TB`;
}

const META_KEY_RE = /^[a-z][a-z0-9-]{0,63}$/;

function validateMetaKey(k: string): string | null {
  if (!k) return 'Key is required';
  if (!/^[a-z]/.test(k)) return 'Must start with a lowercase letter';
  if (!/^[a-z0-9-]+$/.test(k)) return 'Only lowercase a–z, 0–9, hyphen allowed';
  if (k.length > 64) return 'Max 64 characters';
  return null;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface MetaRow {
  id: number;
  key: string;
  value: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  connectionId: string;
  bucket: string;
  objectKey: string;
  onSaved?: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ObjectInfoModal({ open, onClose, connectionId, bucket, objectKey, onSaved }: Props) {
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [metadata, setMetadata] = React.useState<ObjectMetadata | null>(null);

  // Header fields
  const [contentType, setContentType] = React.useState('');
  const [cacheControl, setCacheControl] = React.useState('');
  const [contentDisposition, setContentDisposition] = React.useState('');
  const [contentEncoding, setContentEncoding] = React.useState('');
  const [contentLanguage, setContentLanguage] = React.useState('');

  // User metadata rows
  const nextId = React.useRef(0);
  const [metaRows, setMetaRows] = React.useState<MetaRow[]>([]);

  const fileName = objectKey.split('/').filter(Boolean).pop() ?? objectKey;

  // Load on open
  React.useEffect(() => {
    if (!open || !objectKey) return;
    setLoading(true);
    setMetadata(null);
    setMetaRows([]);
    getObjectMetadata(connectionId, bucket, objectKey)
      .then((m) => {
        setMetadata(m);
        setContentType(m.content_type ?? '');
        setCacheControl(m.cache_control ?? '');
        setContentDisposition(m.content_disposition ?? '');
        setContentEncoding(m.content_encoding ?? '');
        setContentLanguage(m.content_language ?? '');
        const rows: MetaRow[] = Object.entries(m.metadata).map(([k, v]) => ({
          id: nextId.current++,
          key: k,
          value: v,
        }));
        setMetaRows(rows);
      })
      .catch((err) => {
        toast.error(`Failed to load metadata: ${err}`);
        onClose();
      })
      .finally(() => setLoading(false));
  }, [open, objectKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const addRow = () => {
    setMetaRows((rows) => [...rows, { id: nextId.current++, key: '', value: '' }]);
  };

  const updateRow = (id: number, field: 'key' | 'value', val: string) => {
    setMetaRows((rows) => rows.map((r) => (r.id === id ? { ...r, [field]: val } : r)));
  };

  const removeRow = (id: number) => {
    setMetaRows((rows) => rows.filter((r) => r.id !== id));
  };

  const keyErrors = React.useMemo(() => {
    const errs: Record<number, string> = {};
    for (const row of metaRows) {
      if (row.key !== '') {
        const e = validateMetaKey(row.key);
        if (e) errs[row.id] = e;
      }
    }
    return errs;
  }, [metaRows]);

  const hasKeyErrors = Object.keys(keyErrors).length > 0;
  const isSaveDisabled = loading || saving || hasKeyErrors;

  const handleSave = async () => {
    if (!metadata) return;
    setSaving(true);
    try {
      // Dedupe: later wins
      const userMeta: Record<string, string> = {};
      for (const row of metaRows) {
        const k = row.key.trim();
        if (k) userMeta[k] = row.value.trim();
      }

      const updated: ObjectMetadata = {
        ...metadata,
        content_type: contentType.trim() || null,
        cache_control: cacheControl.trim() || null,
        content_disposition: contentDisposition.trim() || null,
        content_encoding: contentEncoding.trim() || null,
        content_language: contentLanguage.trim() || null,
        metadata: userMeta,
      };

      await updateObjectMetadata(connectionId, bucket, objectKey, updated);
      toast.success('Updated');
      onSaved?.();
      onClose();
    } catch (err) {
      toast.error(`Failed to update: ${err}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={fileName}
      className="max-w-lg max-h-[85vh] flex flex-col"
    >
      {loading || !metadata ? (
        <div className="flex items-center justify-center py-10">
          <Spinner className="w-6 h-6 text-neutral-400" />
        </div>
      ) : (
        <div className="flex flex-col gap-5 overflow-y-auto">
          {/* ── Properties (read-only) ── */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400 mb-2">
              Properties
            </h3>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-neutral-500">Key</dt>
              <dd className="truncate font-mono text-xs break-all">{objectKey}</dd>
              <dt className="text-neutral-500">Size</dt>
              <dd>{formatSize(metadata.size)}</dd>
              <dt className="text-neutral-500">Modified</dt>
              <dd>
                {metadata.last_modified
                  ? format(new Date(metadata.last_modified), 'yyyy-MM-dd HH:mm:ss')
                  : '—'}
              </dd>
              <dt className="text-neutral-500">ETag</dt>
              <dd className="font-mono text-xs truncate">{metadata.etag ?? '—'}</dd>
            </dl>
          </section>

          {/* ── HTTP Headers ── */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400 mb-2">
              Headers
            </h3>
            <div className="flex flex-col gap-2">
              {(
                [
                  ['Content-Type', contentType, setContentType],
                  ['Cache-Control', cacheControl, setCacheControl],
                  ['Content-Disposition', contentDisposition, setContentDisposition],
                  ['Content-Encoding', contentEncoding, setContentEncoding],
                  ['Content-Language', contentLanguage, setContentLanguage],
                ] as [string, string, React.Dispatch<React.SetStateAction<string>>][]
              ).map(([label, value, setter]) => (
                <div key={label} className="grid grid-cols-[140px_1fr] items-center gap-2">
                  <label className="text-sm text-neutral-600 dark:text-neutral-400 truncate">
                    {label}
                  </label>
                  <Input
                    value={value}
                    onChange={(e) => setter(e.target.value)}
                    placeholder="—"
                    className="text-sm"
                  />
                </div>
              ))}
            </div>
          </section>

          {/* ── User Metadata ── */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                User Metadata
              </h3>
              <Button variant="ghost" size="sm" onClick={addRow}>
                + Add
              </Button>
            </div>
            <div className="flex flex-col gap-2">
              {metaRows.map((row) => (
                <div key={row.id} className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <Input
                      value={row.key}
                      onChange={(e) => updateRow(row.id, 'key', e.target.value)}
                      placeholder="key"
                      className="text-sm flex-1"
                    />
                    <Input
                      value={row.value}
                      onChange={(e) => updateRow(row.id, 'value', e.target.value)}
                      placeholder="value"
                      className="text-sm flex-1"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeRow(row.id)}
                      aria-label="Remove"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-red-500" />
                    </Button>
                  </div>
                  {keyErrors[row.id] && (
                    <p className="text-xs text-red-500 pl-1">{keyErrors[row.id]}</p>
                  )}
                </div>
              ))}
              {metaRows.length === 0 && (
                <p className="text-xs text-neutral-400 italic">No user metadata</p>
              )}
            </div>
          </section>

          {/* ── Actions ── */}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isSaveDisabled}>
              {saving ? <Spinner className="w-3.5 h-3.5 mr-1" /> : null}
              Save
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
