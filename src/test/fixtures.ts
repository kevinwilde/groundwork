import type { Op } from '../data/ops';
import { buildData, EMPTY_RAW, type Data, type RawData } from '../data/snapshot';
import { libraryOps } from '../db/seed';
import type { Entry } from '../db/types';

/** Apply put ops to an in-memory RawData (test helper; no IndexedDB). */
export function rawFromOps(ops: Op[], base: RawData = EMPTY_RAW): RawData {
  const raw: RawData = Object.fromEntries(Object.entries(base).map(([k, v]) => [k, [...v]])) as unknown as RawData;
  for (const op of ops) {
    if (op.type !== 'put') continue;
    const list = raw[op.table] as { id?: string; key?: string }[];
    const key = (op.value as { id?: string; key?: string }).id ?? (op.value as { key?: string }).key;
    const i = list.findIndex((r) => (r.id ?? r.key) === key);
    if (i >= 0) list[i] = op.value;
    else list.push(op.value);
  }
  return raw;
}

export function library(extra: Op[] = []): Data {
  return buildData(rawFromOps([...libraryOps(0), ...extra]));
}

let n = 0;
export function entry(exerciseId: string, date: string, perf: Pick<Entry, 'sets' | 'values'>, extra: Partial<Entry> = {}): Entry {
  n++;
  return { id: `en_test_${n}`, exerciseId, date, notes: '', source: 'log', createdAt: 1_000_000 + n, ...perf, ...extra };
}
