import type { Op } from '../data/ops';
import { buildData, EMPTY_RAW, type Data, type RawData } from '../data/snapshot';
import { libraryOps } from '../db/seed';
import type { Entry, Plan, PlanItem, PlannedSet } from '../db/types';

/** Apply put ops (and, with `deletes`, delete ops) to an in-memory RawData (test helper; no IndexedDB). */
export function rawFromOps(ops: Op[], base: RawData = EMPTY_RAW, { deletes = false } = {}): RawData {
  const raw: RawData = Object.fromEntries(Object.entries(base).map(([k, v]) => [k, [...v]])) as unknown as RawData;
  for (const op of ops) {
    if (op.table === 'tombstones' || op.type === 'clear') continue;
    const list = raw[op.table] as { id?: string; key?: string }[];
    if (op.type === 'delete') {
      if (deletes) raw[op.table] = list.filter((r) => (r.id ?? r.key) !== op.key) as never;
      continue;
    }
    const key = (op.value as { id?: string; key?: string }).id ?? (op.value as { key?: string }).key;
    const i = list.findIndex((r) => (r.id ?? r.key) === key);
    if (i >= 0) list[i] = op.value;
    else list.push(op.value);
  }
  return raw;
}

/** The snapshot after applying ops, deletes included, as the live query would rebuild it. */
export const applyTo = (d: Data, ops: Op[]): Data => buildData(rawFromOps(ops, d.raw, { deletes: true }));

export function library(extra: Op[] = []): Data {
  return buildData(rawFromOps([...libraryOps(0), ...extra]));
}

let n = 0;
export function entry(exerciseId: string, date: string, perf: Pick<Entry, 'sets' | 'values'>, extra: Partial<Entry> = {}): Entry {
  n++;
  return { id: `en_test_${n}`, exerciseId, date, notes: '', source: 'log', createdAt: 1_000_000 + n, ...perf, ...extra };
}

/** A plan for tests: an id, a date and items, with everything else defaulted. */
export function plan(id: string, date: string, items: PlanItem[], extra: Partial<Plan> = {}): Plan {
  return { id, date, name: 'Upper A', sessionId: null, items, notes: '', order: 1, finishedAt: null, createdAt: 1, ...extra };
}

/** A set-based plan item: targets, with `done` for ticked ones. */
export function liftItem(key: string, exerciseId: string, sets: PlannedSet[], extra: Partial<PlanItem> = {}): PlanItem {
  return { key, exerciseId, sets, notes: '', ...extra };
}
