import { useLiveQuery } from 'dexie-react-hooks';
import { setSetting } from '../data/ops';
import type { RawData } from '../data/snapshot';
import { buildBackup } from '../db/backup';
import { db } from '../db/db';
import type { Tombstone } from '../db/types';
import { today } from '../lib/dates';
import { saveTextFile } from '../lib/files';
import { notify, notifyError } from './toast';

/**
 * Tombstones for backups, read ahead of time: building the file synchronously inside the click keeps
 * Safari's clipboard and download permissions, which lapse after an await.
 */
export const useTombstones = (): Tombstone[] => useLiveQuery(() => db.tombstones.toArray(), []) ?? [];

/** The backup as JSON. Device-local state (sync settings, token) is never included. */
export const backupJson = (raw: RawData, tombstones: Tombstone[], space?: number) => JSON.stringify(buildBackup(raw, tombstones), null, space);

/** Export all data to a file (the Backup card, and the first-sync review). */
export async function exportBackupFile(raw: RawData, tombstones: Tombstone[]): Promise<boolean> {
  const res = await saveTextFile(`groundwork-backup-${today()}.json`, backupJson(raw, tombstones, 2));
  if (res === 'saved') {
    await setSetting('lastExportAt', Date.now());
    notify('Backup saved');
    return true;
  }
  if (res === 'unavailable') notifyError('Saving files is not available here. Use Copy JSON instead.');
  return false;
}
