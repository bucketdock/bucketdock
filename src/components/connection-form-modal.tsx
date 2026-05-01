'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { InfoHint } from '@/components/ui/info-hint';
import { AlertTriangle } from 'lucide-react';
import {
  addConnection,
  updateConnection,
  testConnection,
  listBuckets,
  listObjects,
  type Connection,
  type ConnectionInput,
  type Provider,
} from '@/lib/tauri';
import { useAppStore } from '@/store/app-store';

interface Props {
  open: boolean;
  onClose: () => void;
  initial?: Connection;
}

export default function ConnectionFormModal({ open, onClose, initial }: Props) {
  const isEdit = !!initial;

  const [name, setName] = React.useState('');
  const [provider, setProvider] = React.useState<Provider>('aws');
  const [region, setRegion] = React.useState('us-east-1');
  const [endpoint, setEndpoint] = React.useState('');
  const [r2AccountId, setR2AccountId] = React.useState('');
  const [accessKeyId, setAccessKeyId] = React.useState('');
  const [secretAccessKey, setSecretAccessKey] = React.useState('');
  const [bucketFilter, setBucketFilter] = React.useState('');

  const [saving, setSaving] = React.useState(false);
  const [testing, setTesting] = React.useState(false);

  // Populate form when modal opens
  React.useEffect(() => {
    if (!open) return;
    if (initial) {
      setName(initial.name);
      setProvider(initial.provider);
      setRegion(initial.region);
      setEndpoint(initial.endpoint ?? '');
      // Parse R2 account id back out of the saved endpoint
      const r2Match = (initial.endpoint ?? '').match(
        /^https?:\/\/([^.]+)\.r2\.cloudflarestorage\.com/i,
      );
      setR2AccountId(r2Match ? r2Match[1] : '');
      setAccessKeyId(initial.access_key_id);
      // Secret is intentionally blank — it lives in the macOS Keychain and is
      // never sent back to the UI. Empty submit = keep existing.
      setSecretAccessKey('');
      setBucketFilter(initial.bucket_filter ?? '');
    } else {
      setName('');
      setProvider('aws');
      setRegion('us-east-1');
      setEndpoint('');
      setR2AccountId('');
      setAccessKeyId('');
      setSecretAccessKey('');
      setBucketFilter('');
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Update default region when provider changes (only for new connections)
  const prevProvider = React.useRef(provider);
  React.useEffect(() => {
    if (prevProvider.current === provider) return;
    prevProvider.current = provider;
    if (provider === 'r2') setRegion('auto');
    else setRegion('us-east-1');
  }, [provider]);

  // Auto-build R2 endpoint from account ID
  React.useEffect(() => {
    if (provider === 'r2' && r2AccountId.trim()) {
      setEndpoint(`https://${r2AccountId.trim()}.r2.cloudflarestorage.com`);
    }
  }, [r2AccountId, provider]);

  const showEndpoint = provider === 'r2' || provider === 'custom';

  const isValid =
    name.trim() !== '' &&
    region.trim() !== '' &&
    accessKeyId.trim() !== '' &&
    (isEdit || secretAccessKey !== '');

  function buildInput(): ConnectionInput {
    return {
      name: name.trim(),
      provider,
      region: region.trim(),
      endpoint: showEndpoint && endpoint.trim() ? endpoint.trim() : null,
      access_key_id: accessKeyId.trim(),
      secret_access_key: secretAccessKey.trim(),
      bucket_filter: bucketFilter.trim() || null,
    };
  }

  async function handleTest() {
    setTesting(true);
    try {
      const input = buildInput();
      // In edit mode with no new secret entered, test the *saved* connection
      // (which uses the secret stored in the macOS Keychain). For new
      // connections we must have a secret in hand to even attempt this.
      if (isEdit && initial && !input.secret_access_key) {
        const list = await listBuckets(initial.id);
        if (list.length > 0) {
          await listObjects(initial.id, list[0].name, '');
        }
        toast.success(`Found ${list.length} bucket${list.length !== 1 ? 's' : ''}`);
        return;
      }
      if (!input.access_key_id || !input.secret_access_key) {
        toast.error('Enter Access Key ID and Secret Access Key to test');
        return;
      }
      const count = await testConnection(input);
      toast.success(`Found ${count} bucket${count !== 1 ? 's' : ''}`);
    } catch (err: unknown) {
      toast.error(`Test failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setTesting(false);
    }
  }

  async function handleSave() {
    if (!isValid) return;
    setSaving(true);
    try {
      if (isEdit && initial) {
        const updated = await updateConnection(initial.id, buildInput());
        useAppStore.getState().updateConnectionLocal(updated);
        toast.success('Connection updated');
      } else {
        const created = await addConnection(buildInput());
        useAppStore.getState().addConnectionLocal(created);
        toast.success('Connection added');
      }
      onClose();
    } catch (err: unknown) {
      toast.error(`Failed to save: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit Connection' : 'Add Connection'}
      className="max-w-lg"
    >
      <div className="flex flex-col gap-4">
        {/* Name */}
        <div>
          <Label htmlFor="conn-name">Name *</Label>
          <Input
            id="conn-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My S3 bucket"
          />
        </div>

        {/* Provider */}
        <div>
          <Label htmlFor="conn-provider">Provider *</Label>
          <Select
            id="conn-provider"
            value={provider}
            onChange={(e) => setProvider(e.target.value as Provider)}
          >
            <option value="aws">AWS S3</option>
            <option value="r2">Cloudflare R2</option>
            <option value="custom">S3-Compatible</option>
          </Select>
        </div>

        {/* Region */}
        <div>
          <Label htmlFor="conn-region">Region *</Label>
          <Input
            id="conn-region"
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            placeholder="us-east-1"
          />
        </div>

        {/* Endpoint fields (R2 / custom) */}
        {showEndpoint && (
          <>
            {provider === 'r2' && (
              <div>
                <Label htmlFor="conn-account-id">Account ID</Label>
                <Input
                  id="conn-account-id"
                  value={r2AccountId}
                  onChange={(e) => setR2AccountId(e.target.value)}
                  placeholder="abcdef1234567890abcdef1234567890"
                />
              </div>
            )}
            <div>
              <Label htmlFor="conn-endpoint">
                {provider === 'r2'
                  ? 'Endpoint (auto-filled, or paste full URL)'
                  : 'Endpoint *'}
              </Label>
              <Input
                id="conn-endpoint"
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
                placeholder={
                  provider === 'r2'
                    ? 'https://<account>.r2.cloudflarestorage.com'
                    : 'https://s3.example.com'
                }
              />
            </div>
          </>
        )}

        {/* Access Key ID */}
        <div>
          <Label htmlFor="conn-access-key" className="flex items-center gap-1.5">
            Access Key ID *
            <InfoHint tone="info" label="Where is this stored?">
              The Access Key ID and other connection details are saved in
              <code className="mx-1 font-mono text-[10px]">~/Library/Application Support/BucketDock/connections.json</code>
              (readable only by your macOS user). The secret key is <strong>not</strong> stored there.
            </InfoHint>
          </Label>
          <Input
            id="conn-access-key"
            value={accessKeyId}
            onChange={(e) => setAccessKeyId(e.target.value)}
            placeholder="AKIAIOSFODNN7EXAMPLE"
          />
        </div>

        {/* Secret Access Key */}
        <div>
          <Label htmlFor="conn-secret" className="flex items-center gap-1.5">
            Secret Access Key{!isEdit && ' *'}
            <InfoHint tone="security" label="How is my secret stored?">
              Stored in the macOS <strong>Keychain</strong> (encrypted, gated by your login
              password). Never written to disk in plain text and never sent anywhere except
              directly to your S3 endpoint to sign API requests via SigV4.
            </InfoHint>
          </Label>
          <Input
            id="conn-secret"
            type="password"
            value={secretAccessKey}
            onChange={(e) => setSecretAccessKey(e.target.value)}
            placeholder={isEdit ? '•••••••• saved · type to replace' : '••••••••'}
            autoComplete="off"
            spellCheck={false}
          />
          {endpoint.trim().toLowerCase().startsWith('http://') && (
            <div className="mt-2 flex gap-2 rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-2.5 py-2 text-[11px] leading-snug text-amber-800 dark:text-amber-300">
              <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" />
              <span>
                Insecure endpoint. <code className="font-mono">http://</code> sends credentials in
                plain text — only use on a trusted local network.
              </span>
            </div>
          )}
        </div>

        {/* Bucket filter */}
        <div>
          <Label htmlFor="conn-filter" className="flex items-center gap-1.5">
            Buckets (optional)
            <InfoHint tone="info" label="When to use this">
              For <strong>scoped tokens</strong> (e.g. a Cloudflare R2 token limited to specific
              buckets), enter the bucket name(s) explicitly here — comma or space separated. The
              app will skip the account-wide <code>ListBuckets</code> call (which scoped tokens
              cannot perform) and use these names directly. Leave blank to auto-list all buckets.
            </InfoHint>
          </Label>
          <Input
            id="conn-filter"
            value={bucketFilter}
            onChange={(e) => setBucketFilter(e.target.value)}
            placeholder="my-bucket, another-bucket"
          />
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 pt-1">
          <Button
            variant="secondary"
            size="sm"
            onClick={handleTest}
            disabled={testing || saving}
          >
            {testing && <Spinner className="w-3.5 h-3.5" />}
            Test
          </Button>
          <div className="flex-1" />
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving || testing}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={!isValid || saving || testing}>
            {saving && <Spinner className="w-3.5 h-3.5" />}
            {isEdit ? 'Save' : 'Add'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
