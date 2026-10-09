import { z } from 'zod';
import { clear, put, type Op } from '../data/ops';
import type { RawData } from '../data/snapshot';
import { Clock, HLC_PATTERN, maxHlc, SEED_HLC } from '../sync/hlc';
import { stampRecord } from '../sync/legacy';
import type { Snapshot } from '../sync/local';
import { index, liveVersion, mergeSets, planToOps, tombVersion, type Counts, type Version } from '../sync/merge';
import { isSynced } from '../sync/scope';
import { TABLES, type DataTable, type Tables, type Tombstone } from './types';

export const BACKUP_APP = 'groundwork';
/**
 * 2 added saved sessions; 3 added sync stamps (`hlc`) and tombstones. Older backups import fine:
 * sessions default to none, and their records get legacy stamps.
 */
export const BACKUP_SCHEMA = 3;

const id = z.string().min(1);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dates must look like 2026-09-25');
const setValues = z.record(z.string(), z.union([z.number(), z.string()]));
const perf = { sets: z.array(setValues).optional(), values: setValues.optional() };
const ts = z.number();
const stamps = { hlc: z.string().regex(HLC_PATTERN, 'sync stamps look like 0mgv7q2xs.0000.k3j9x0a1b2').optional(), updatedAt: ts.optional() };

const field = z.object({
  key: z.string().min(1),
  label: z.string(),
  kind: z.enum(['int', 'number', 'duration', 'text']),
  unit: z.string().optional(),
  plain: z.enum(['s', 'min']).optional(),
});

const plannedSet = z.looseObject({ target: setValues, done: setValues.optional(), skipped: z.boolean().optional(), added: z.boolean().optional() });
const planItem = z.looseObject({
  key: z.string().min(1), exerciseId: id, sets: z.array(plannedSet).optional(), target: setValues.optional(), done: setValues.optional(), skipped: z.boolean().optional(),
  notes: z.string().default(''), entryId: z.string().nullable().optional(),
});

// Unknown keys pass through (z.looseObject) so newer backups keep extra data.
// Also used to validate the files synced to GitHub (src/sync/layout.ts), without applying defaults there.
export const recordSchemas = {
  types: z.looseObject({ id, name: z.string(), mode: z.enum(['sets', 'single']), fields: z.array(field), color: z.string(), order: z.number().default(50), createdAt: ts.default(0), ...stamps }),
  tags: z.looseObject({ id, name: z.string(), color: z.string(), createdAt: ts.default(0), ...stamps }),
  exercises: z.looseObject({ id, name: z.string(), typeId: id, tagIds: z.array(z.string()).default([]), color: z.string().default('#687686'), notes: z.string().default(''), archived: z.boolean().default(false), createdAt: ts.default(0), ...stamps }),
  entries: z.looseObject({ id, exerciseId: id, date, notes: z.string().default(''), source: z.enum(['log', 'snack']).default('log'), snackId: z.string().nullable().optional(), sessionId: z.string().nullable().optional(), sample: z.boolean().optional(), createdAt: ts.default(0), ...stamps, ...perf }),
  snacks: z.looseObject({ id, exerciseId: id, instruction: z.string().default(''), perDay: z.number().default(0), active: z.boolean().default(true), order: z.number().default(0), createdAt: ts.default(0), ...stamps, ...perf }),
  sessions: z.looseObject({
    id, name: z.string(), items: z.array(z.looseObject({ exerciseId: id, ...perf })).default([]), notes: z.string().default(''), order: z.number().default(0), createdAt: ts.default(0), ...stamps,
  }),
  plans: z.looseObject({
    id, date, name: z.string(), sessionId: z.string().nullable().optional(), items: z.array(planItem).default([]), notes: z.string().default(''), order: z.number().default(0),
    finishedAt: z.number().nullable().optional(), createdAt: ts.default(0), ...stamps,
  }),
  bodyParts: z.looseObject({ id, name: z.string(), active: z.boolean().default(true), notes: z.string().default(''), order: z.number().default(0), createdAt: ts.default(0), ...stamps }),
  checkins: z.looseObject({
    id, date, time: z.string().default(''), moment: z.string().default(''), overall: z.number().min(1).max(5).nullable().default(null), notes: z.string().default(''),
    pains: z.array(z.object({ bodyPartId: id, score: z.number().min(0).max(10) })).default([]), sample: z.boolean().optional(), createdAt: ts.default(0), ...stamps,
  }),
  views: z.looseObject({ id, name: z.string(), config: z.record(z.string(), z.unknown()), createdAt: ts.default(0), ...stamps }),
  settings: z.object({ key: z.string().min(1), value: z.unknown(), ...stamps }),
} satisfies Record<DataTable, z.ZodType>;

export const tombstoneSchema = z
  .object({ id, table: z.enum(TABLES), key: z.string().min(1), hlc: z.string().regex(HLC_PATTERN, 'sync stamps look like 0mgv7q2xs.0000.k3j9x0a1b2'), deletedAt: ts })
  .refine((t) => t.id === `${t.table}:${t.key}`, { error: 'a tombstone id must be table:key', path: ['id'] });

const backupSchema = z.object({
  app: z.literal(BACKUP_APP, { error: 'This file is not a Groundwork backup.' }),
  schema: z.number().max(BACKUP_SCHEMA, { error: 'This backup comes from a newer version of Groundwork.' }).default(1),
  exportedAt: z.string().optional(),
  data: z.object(Object.fromEntries(TABLES.map((t) => [t, z.array(recordSchemas[t] as z.ZodType).default([])])) as unknown as Record<DataTable, z.ZodType>),
  tombstones: z.array(tombstoneSchema).default([]),
});

export interface Backup {
  app: typeof BACKUP_APP;
  schema: number;
  exportedAt: string;
  counts: Record<DataTable, number>;
  data: RawData;
  /** Deletions, so a merge import applies them instead of bringing the records back. */
  tombstones: Tombstone[];
}

/** A backup of the data tables and tombstones. Device-local state (`meta`, including any sync token) is never part of it. */
export function buildBackup(raw: RawData, tombstones: Tombstone[] = []): Backup {
  const counts = Object.fromEntries(TABLES.map((t) => [t, raw[t].length])) as Record<DataTable, number>;
  return { app: BACKUP_APP, schema: BACKUP_SCHEMA, exportedAt: new Date().toISOString(), counts, data: raw, tombstones };
}

export interface BackupContents {
  exportedAt?: string;
  data: RawData;
  tombstones: Tombstone[];
}

export type ParsedBackup = { ok: true; backup: BackupContents } | { ok: false; error: string };

export function parseBackup(text: string): ParsedBackup {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: 'That is not valid JSON.' };
  }
  const res = backupSchema.safeParse(json);
  if (!res.success) {
    const issue = res.error.issues[0];
    const where = issue.path.length ? ` (at ${issue.path.join('.')})` : '';
    return { ok: false, error: `${issue.message}${where}` };
  }
  return { ok: true, backup: { exportedAt: res.data.exportedAt, data: res.data.data as unknown as RawData, tombstones: res.data.tombstones as Tombstone[] } };
}

type AnyRecord = Record<string, unknown>;

/**
 * Merge a backup into this device the way a sync would: per record the most recently changed copy
 * wins, and deletions saved in the backup apply. Records written with fresh stamps instead would
 * overwrite newer edits from other devices. Sample records and device-local settings are skipped.
 * Apply the ops verbatim with `expectSeq: local.seq`.
 */
export function mergeImport(local: Snapshot, backup: BackupContents, now = Date.now()): { ops: Op[]; counts: Counts } {
  const versions: Version[] = [];
  for (const t of TABLES) for (const rec of backup.data[t] as unknown as AnyRecord[]) if (isSynced(t, rec)) versions.push(liveVersion(t, stampRecord(t, rec)));
  for (const tomb of backup.tombstones) versions.push(tombVersion(tomb));
  const theirs = index(versions);
  const stamp = Clock.from(local.clock).observe(maxHlc([...theirs.values()].map((v) => v.hlc))).stamper(local.device?.id ?? 'import', now);
  const m = mergeSets(local.set, theirs, { stamp, now });
  return { ops: planToOps(m.local, local.samples), counts: m.counts.local };
}

/**
 * Reset this device to the backup: everything (sample data included) exactly as saved, with legacy
 * stamps for records from older backups. Apply verbatim, then forget `meta.syncState`: the next
 * sync merges with GitHub, so newer changes from other devices still win.
 */
export function replaceImportOps(backup: BackupContents): Op[] {
  const ops: Op[] = [...TABLES.map((t) => clear(t)), clear('tombstones')];
  for (const t of TABLES) for (const rec of backup.data[t] as unknown as AnyRecord[]) ops.push(put(t, stampRecord(t, rec) as unknown as Tables[typeof t]));
  for (const tomb of backup.tombstones) ops.push(put('tombstones', tomb));
  ops.push(put('settings', { key: 'seeded', value: true, hlc: SEED_HLC }));
  return ops;
}
