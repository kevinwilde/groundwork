import { db as defaultDb, type GroundworkDB } from '../db/db';
import { TABLES, type DataTable, type TableName, type Tables, type Tombstone } from '../db/types';
import { sameContent } from '../sync/canonical';
import { newDevice, type DeviceInfo } from '../sync/device';
import { Clock, isHlc, maxHlc, type ClockState } from '../sync/hlc';
import { isSynced, keyOf, tombstoneId } from '../sync/scope';

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

type AnyRecord = Record<string, unknown>;
/** Untyped view of an op, used inside applyOps where tables are handled generically. */
type LooseOp = { table: TableName; type: 'put' | 'delete' | 'clear'; value?: AnyRecord; key?: string };
const toOp = (o: LooseOp) => o as unknown as Op;

export interface ApplyOptions {
  /**
   * `local` (user edits, Undo): puts get a fresh stamp and deletes leave tombstones; tombstone ops in the
   * input are ignored, because tombstones follow from the data ops. `verbatim` (sync, imports, seeding):
   * records are written exactly as given and must already carry `hlc`; the caller supplies tombstones.
   */
  mode?: 'local' | 'verbatim';
  /** Refuse with StaleError unless `meta.seq` still equals this, i.e. nothing was written since a snapshot. */
  expectSeq?: number;
  /** Who is writing. Sync and bootstrap writes aren't user changes (automatic sync will rely on this). */
  origin?: 'user' | 'sync' | 'bootstrap';
  now?: () => number;
  db?: GroundworkDB;
}

/** Thrown when `expectSeq` no longer matches: something was saved after the snapshot the ops were built from. */
export class StaleError extends Error {
  constructor() {
    super('Something was saved on this device in the meantime.');
    this.name = 'StaleError';
  }
}

/** The record with another record's stamps (or none). */
function withStampOf(value: AnyRecord, prev: AnyRecord): AnyRecord {
  const out: AnyRecord = { ...value };
  delete out.hlc;
  delete out.updatedAt;
  if (prev.hlc !== undefined) out.hlc = prev.hlc;
  if (prev.updatedAt !== undefined) out.updatedAt = prev.updatedAt;
  return out;
}

/**
 * Apply ops in one transaction and return the ops that undo them (including tombstone changes).
 * Consecutive ops of the same table and type are batched. Every non-empty call increments `meta.seq`.
 */
export async function applyOps(ops: Op[], opts: ApplyOptions = {}): Promise<Op[]> {
  const { mode = 'local', expectSeq, now = Date.now, db = defaultDb } = opts;
  let loose = ops as unknown as LooseOp[];
  if (mode === 'local') loose = loose.filter((o) => o.table !== 'tombstones');
  if (!loose.length) return [];
  const tables = [...new Set<string>([...loose.map((o) => o.table), 'tombstones', 'meta'])];
  const inverse: LooseOp[] = [];

  // Batch runs of the same (table, type).
  const runs: LooseOp[][] = [];
  for (const op of loose) {
    const last = runs[runs.length - 1];
    if (last && last[0].table === op.table && last[0].type === op.type && op.type !== 'clear') last.push(op);
    else runs.push([op]);
  }

  await db.transaction('rw', tables, async () => {
    const [clockRow, seqRow, deviceRow] = await db.meta.bulkGet(['clock', 'seq', 'device']);
    const seq = (seqRow?.value as number | undefined) ?? 0;
    if (expectSeq !== undefined && expectSeq !== seq) throw new StaleError();
    let device = deviceRow?.value as DeviceInfo | undefined;
    if (!device) {
      device = newDevice(now());
      await db.meta.put({ key: 'device', value: device });
    }
    const clock = Clock.from(clockRow?.value as ClockState | undefined);
    const node = device.id;
    const tombs = db.tombstones;
    const written: string[] = [];

    for (const run of runs) {
      const { table, type } = run[0];
      const t = db.table<AnyRecord, string>(table);
      const undo: LooseOp[] = [];

      if (table === 'tombstones') {
        // Only reached in verbatim mode.
        if (type === 'put') {
          const values = run.map((o) => o.value!);
          const prev = await t.bulkGet(values.map((v) => v.id as string));
          values.forEach((v, i) => undo.push(prev[i] ? { table, type: 'put', value: prev[i] } : { table, type: 'delete', key: v.id as string }));
          written.push(...values.map((v) => v.hlc as string));
          await t.bulkPut(values);
        } else if (type === 'delete') {
          const keys = run.map((o) => o.key!);
          const prev = await t.bulkGet(keys);
          undo.push(...prev.filter((v): v is AnyRecord => !!v).map((v): LooseOp => ({ table, type: 'put', value: v })));
          await t.bulkDelete(keys);
        } else {
          undo.push(...(await t.toArray()).map((v): LooseOp => ({ table, type: 'put', value: v })));
          await t.clear();
        }
        inverse.unshift(...undo.reverse());
        continue;
      }

      const dt = table as DataTable;
      if (type === 'put') {
        const keys = run.map((o) => keyOf(dt, o.value));
        const prev = await t.bulkGet(keys);
        const values = run.map((o, i) => {
          const v = o.value!;
          if (mode === 'verbatim') {
            if (!isHlc(v.hlc)) throw new Error(`Can't save ${dt} ${keys[i]} without a sync stamp.`);
            written.push(v.hlc);
            return v;
          }
          // Saving without changes keeps the old stamp, so it can't override a real edit made on another device.
          const p = prev[i];
          if (p && sameContent(p, v)) return withStampOf(v, p);
          const at = now();
          return { ...v, hlc: clock.next(at, node), updatedAt: at };
        });
        keys.forEach((k, i) => undo.push(prev[i] ? { table, type: 'put', value: prev[i] } : { table, type: 'delete', key: k }));
        // A key is either live or tombstoned, never both.
        const ids = keys.map((k) => tombstoneId(dt, k));
        const gone = (await tombs.bulkGet(ids)).filter((x): x is Tombstone => !!x);
        undo.push(...gone.map((x): LooseOp => ({ table: 'tombstones', type: 'put', value: x as unknown as AnyRecord })));
        await t.bulkPut(values);
        if (gone.length) await tombs.bulkDelete(gone.map((x) => x.id));
      } else if (type === 'delete') {
        const keys = run.map((o) => o.key!);
        const prev = await t.bulkGet(keys);
        undo.push(...prev.filter((v): v is AnyRecord => !!v).map((v): LooseOp => ({ table, type: 'put', value: v })));
        await t.bulkDelete(keys);
        if (mode === 'local') {
          // Deleted records leave tombstones so the deletion reaches other devices. Sample data and device-local settings don't.
          const dead = keys.filter((_, i) => prev[i] && isSynced(dt, prev[i]!));
          if (dead.length) {
            const ids = dead.map((k) => tombstoneId(dt, k));
            const prevT = await tombs.bulkGet(ids);
            ids.forEach((id, i) => undo.push(prevT[i] ? { table: 'tombstones', type: 'put', value: prevT[i] as unknown as AnyRecord } : { table: 'tombstones', type: 'delete', key: id }));
            const at = now();
            await tombs.bulkPut(dead.map((key, i): Tombstone => ({ id: ids[i], table: dt, key, hlc: clock.next(at, node), deletedAt: at })));
          }
        }
      } else {
        // Clearing never creates tombstones; callers that reset the device clear tombstones themselves.
        undo.push(...(await t.toArray()).map((v): LooseOp => ({ table, type: 'put', value: v })));
        await t.clear();
      }
      inverse.unshift(...undo.reverse());
    }

    if (mode === 'verbatim') clock.observe(maxHlc(written));
    await db.meta.bulkPut([
      { key: 'clock', value: clock.state },
      { key: 'seq', value: seq + 1 },
    ]);
  });
  return inverse.map(toOp);
}

export async function readAll(db: GroundworkDB = defaultDb) {
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
