import { z } from 'zod';
import { clear, put, type Op } from '../data/ops';
import type { RawData } from '../data/snapshot';
import { TABLES, type TableName } from './types';

export const BACKUP_APP = 'groundwork';
/** 2 added saved sessions. Older backups import fine; sessions default to none. */
export const BACKUP_SCHEMA = 2;

const id = z.string().min(1);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dates must look like 2026-09-25');
const setValues = z.record(z.string(), z.union([z.number(), z.string()]));
const perf = { sets: z.array(setValues).optional(), values: setValues.optional() };
const ts = z.number();

const field = z.object({
  key: z.string().min(1),
  label: z.string(),
  kind: z.enum(['int', 'number', 'duration', 'text']),
  unit: z.string().optional(),
  plain: z.enum(['s', 'min']).optional(),
});

// Unknown keys pass through (z.looseObject) so newer backups keep extra data.
const schemas = {
  types: z.looseObject({ id, name: z.string(), mode: z.enum(['sets', 'single']), fields: z.array(field), color: z.string(), order: z.number().default(50), createdAt: ts.default(0) }),
  tags: z.looseObject({ id, name: z.string(), color: z.string(), createdAt: ts.default(0) }),
  exercises: z.looseObject({ id, name: z.string(), typeId: id, tagIds: z.array(z.string()).default([]), color: z.string().default('#687686'), notes: z.string().default(''), archived: z.boolean().default(false), createdAt: ts.default(0) }),
  entries: z.looseObject({ id, exerciseId: id, date, notes: z.string().default(''), source: z.enum(['log', 'snack']).default('log'), snackId: z.string().nullable().optional(), sessionId: z.string().nullable().optional(), sample: z.boolean().optional(), createdAt: ts.default(0), ...perf }),
  snacks: z.looseObject({ id, exerciseId: id, instruction: z.string().default(''), perDay: z.number().default(0), active: z.boolean().default(true), order: z.number().default(0), createdAt: ts.default(0), ...perf }),
  sessions: z.looseObject({
    id, name: z.string(), items: z.array(z.looseObject({ exerciseId: id, ...perf })).default([]), notes: z.string().default(''), order: z.number().default(0), createdAt: ts.default(0),
  }),
  bodyParts: z.looseObject({ id, name: z.string(), active: z.boolean().default(true), notes: z.string().default(''), order: z.number().default(0), createdAt: ts.default(0) }),
  checkins: z.looseObject({
    id, date, time: z.string().default(''), moment: z.string().default(''), overall: z.number().min(1).max(5).nullable().default(null), notes: z.string().default(''),
    pains: z.array(z.object({ bodyPartId: id, score: z.number().min(0).max(10) })).default([]), sample: z.boolean().optional(), createdAt: ts.default(0),
  }),
  views: z.looseObject({ id, name: z.string(), config: z.record(z.string(), z.unknown()), createdAt: ts.default(0) }),
  settings: z.object({ key: z.string().min(1), value: z.unknown() }),
} satisfies Record<TableName, z.ZodType>;

const backupSchema = z.object({
  app: z.literal(BACKUP_APP, { error: 'This file is not a Groundwork backup.' }),
  schema: z.number().max(BACKUP_SCHEMA, { error: 'This backup comes from a newer version of Groundwork.' }).default(1),
  exportedAt: z.string().optional(),
  data: z.object(Object.fromEntries(TABLES.map((t) => [t, z.array(schemas[t] as z.ZodType).default([])])) as unknown as Record<TableName, z.ZodType>),
});

export interface Backup {
  app: typeof BACKUP_APP;
  schema: number;
  exportedAt: string;
  counts: Record<TableName, number>;
  data: RawData;
}

export function buildBackup(raw: RawData): Backup {
  const counts = Object.fromEntries(TABLES.map((t) => [t, raw[t].length])) as Record<TableName, number>;
  return { app: BACKUP_APP, schema: BACKUP_SCHEMA, exportedAt: new Date().toISOString(), counts, data: raw };
}

export type ParsedBackup = { ok: true; backup: { exportedAt?: string; data: RawData } } | { ok: false; error: string };

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
  return { ok: true, backup: { exportedAt: res.data.exportedAt, data: res.data.data as unknown as RawData } };
}

/** Merge overwrites records with the same id; replace clears every table first. */
export function importOps(data: RawData, mode: 'merge' | 'replace'): Op[] {
  const ops: Op[] = [];
  for (const t of TABLES) {
    if (mode === 'replace') ops.push(clear(t));
    for (const rec of data[t]) ops.push(put(t, rec as never));
  }
  ops.push(put('settings', { key: 'seeded', value: true }));
  return ops;
}
