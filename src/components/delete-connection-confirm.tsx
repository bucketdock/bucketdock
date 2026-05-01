'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { deleteConnection, type Connection } from '@/lib/tauri';
import { useAppStore } from '@/store/app-store';

interface Props {
  open: boolean;
  onClose: () => void;
  connection: Connection | null;
}

export default function DeleteConnectionConfirm({ open, onClose, connection }: Props) {
  const [deleting, setDeleting] = React.useState(false);

  async function handleDelete() {
    if (!connection) return;
    setDeleting(true);
    try {
      await deleteConnection(connection.id);
      useAppStore.getState().removeConnectionLocal(connection.id);
      toast.success(`"${connection.name}" deleted`);
      onClose();
    } catch (err: unknown) {
      toast.error(`Failed to delete: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Delete Connection">
      <div className="flex flex-col gap-5">
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Delete connection{' '}
          <span className="font-semibold text-foreground">"{connection?.name}"</span>?{' '}
          Stored credentials will be removed from your keychain.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={deleting}>
            Cancel
          </Button>
          <Button variant="destructive" size="sm" onClick={handleDelete} disabled={deleting}>
            {deleting && <Spinner className="w-3.5 h-3.5" />}
            Delete
          </Button>
        </div>
      </div>
    </Modal>
  );
}
