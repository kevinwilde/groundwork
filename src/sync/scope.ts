import type { DataTable } from '../db/types';

/** Settings that follow the user to every device. Any other key stays on its device (a safe default). */
export const SHARED_SETTINGS = new Set(['weekStart']);

/** Whether a record is synced. Sample data and device-local settings (`seeded`, `lastExportAt`) never leave the device. */
export function isSynced(table: DataTable, rec: object): boolean {
  if (table === 'settings') return SHARED_SETTINGS.has((rec as { key: string }).key);
  return (rec as { sample?: unknown }).sample !== true;
}

export const tombstoneId = (table: DataTable, key: string) => `${table}:${key}`;

/** The primary key of a record: `key` for settings, `id` for everything else. */
export const keyOf = (table: string, rec: unknown): string => (table === 'settings' ? (rec as { key: string }).key : (rec as { id: string }).id);
