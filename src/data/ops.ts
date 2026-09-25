import { db } from '../db/db';
import { TABLES, type TableName, type Tables } from '../db/types';

/** A single write. Every change to the database goes through `applyOps`. */
export type Op = {
  [K in TableName]:
    | { table: K; type: 'put'; value: Tables[K] }
    | { table: K; type: 'delete'; key: string }
    | { table: K; type: 'clear' };
}[TableName];

export const put = <K extends TableName>(table: K, value: Tables[K]): Op => ({ table, type: 'put', value }) as Op;
export const del = (table: TableName, key: string): Op => ({ table, type: 'delete', key });
export const clear = (table: TableName): Op => ({ table, type: 'clear' });

const keyOf = (table: TableName, value: unknown): string =>
  table === 'settings' ? (value as { key: string }).key : (value as { id: string }).id;

type AnyRecord = Record<string, unknown>;
/** Untyped view of an op, used inside applyOps where tables are handled generically. */
type LooseOp = { table: TableName; type: 'put' | 'delete' | 'clear'; value?: AnyRecord; key?: string };
const toOp = (o: LooseOp) => o as unknown as Op;

/**
 * Apply ops in one transaction and return the ops that undo them.
 * Consecutive ops of the same table and type are batched.
 */
export async function applyOps(ops: Op[]): Promise<Op[]> {
  if (!ops.length) return [];
  const loose = ops as unknown as LooseOp[];
  const tables = [...new Set(loose.map((o) => o.table))];
  const inverse: LooseOp[] = [];

  // Batch runs of the same (table, type).
  const runs: LooseOp[][] = [];
  for (const op of loose) {
    const last = runs[runs.length - 1];
    if (last && last[0].table === op.table && last[0].type === op.type && op.type !== 'clear') last.push(op);
    else runs.push([op]);
  }

  await db.transaction('rw', tables.map((t) => db.table(t)), async () => {
    for (const run of runs) {
      const { table, type } = run[0];
      const t = db.table<AnyRecord, string>(table);
      if (type === 'put') {
        const values = run.map((o) => o.value!);
        const keys = values.map((v) => keyOf(table, v));
        const prev = await t.bulkGet(keys);
        const undo: LooseOp[] = keys.map((k, i) => (prev[i] ? { table, type: 'put', value: prev[i] } : { table, type: 'delete', key: k }));
        inverse.unshift(...undo.reverse());
        await t.bulkPut(values);
      } else if (type === 'delete') {
        const keys = run.map((o) => o.key!);
        const prev = await t.bulkGet(keys);
        inverse.unshift(...prev.filter((v): v is AnyRecord => !!v).map((v): LooseOp => ({ table, type: 'put', value: v })));
        await t.bulkDelete(keys);
      } else {
        const all = await t.toArray();
        inverse.unshift(...all.map((v): LooseOp => ({ table, type: 'put', value: v })));
        await t.clear();
      }
    }
  });
  return inverse.map(toOp);
}

export async function readAll() {
  return db.transaction('r', TABLES.map((t) => db.table(t)), async () => {
    const [types, tags, exercises, entries, snacks, sessions, bodyParts, checkins, views, settings] = await Promise.all([
      db.types.toArray(),
      db.tags.toArray(),
      db.exercises.toArray(),
      db.entries.toArray(),
      db.snacks.toArray(),
      db.sessions.toArray(),
      db.bodyParts.toArray(),
      db.checkins.toArray(),
      db.views.toArray(),
      db.settings.toArray(),
    ]);
    return { types, tags, exercises, entries, snacks, sessions, bodyParts, checkins, views, settings };
  });
}

export const setSetting = (key: string, value: unknown) => applyOps([put('settings', { key, value })]);
