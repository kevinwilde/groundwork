import { del, put, type Op } from '../data/ops';
import type { Checkin, DataTable, Entry, Tombstone } from '../db/types';
import { canonical } from './canonical';
import { isHlc, legacyStamp } from './hlc';
import { repair } from './integrity';
import { keyOf, TOMBSTONE_TTL, tombstoneId } from './scope';

export type AnyRecord = Record<string, unknown>;
export type Key = `${DataTable}:${string}`;

/** One record's state on one side: live with its record, or deleted with its tombstone. */
export type Version = { live: true; key: Key; table: DataTable; hlc: string; rec: AnyRecord } | { live: false; key: Key; table: DataTable; hlc: string; tomb: Tombstone };

/** Every synced record and tombstone on one side, by key. */
export type SyncSet = Map<Key, Version>;

export function liveVersion(table: DataTable, rec: AnyRecord): Version {
  // After bootstrap every record has a stamp; this is extra safety for anything written before.
  const stamped = isHlc(rec.hlc) ? rec : { ...rec, hlc: legacyStamp(rec) };
  return { live: true, key: tombstoneId(table, keyOf(table, rec)) as Key, table, hlc: stamped.hlc as string, rec: stamped };
}

export const tombVersion = (tomb: Tombstone): Version => ({ live: false, key: tomb.id as Key, table: tomb.table, hlc: tomb.hlc, tomb });

const body = (v: Version) => canonical(v.live ? v.rec : v.tomb);

/**
 * The newer of two versions of a record. On an exact tie the deletion wins; two copies with the same
 * stamp but different content (only legacy stamps or hand edits) are ordered by content, so every
 * device picks the same one.
 */
export function winner(a: Version | undefined, b: Version | undefined): Version {
  if (!a || !b) return (a ?? b)!;
  if (a.hlc !== b.hlc) return a.hlc > b.hlc ? a : b;
  if (a.live !== b.live) return a.live ? b : a;
  return body(a) >= body(b) ? a : b;
}

/** Build a set from versions, keeping the winner when a key appears twice. */
export function index(versions: Iterable<Version>): SyncSet {
  const set: SyncSet = new Map();
  for (const v of versions) set.set(v.key, winner(set.get(v.key), v));
  return set;
}

/** Same stamp, same state and same content. */
export const sameVersion = (a: Version | undefined, b: Version | undefined) => !!a && !!b && a.hlc === b.hlc && a.live === b.live && body(a) === body(b);

export type Verb = 'added' | 'updated' | 'deleted' | 'restored';
export const VERBS: Verb[] = ['added', 'updated', 'deleted', 'restored'];
export type TableCounts = Partial<Record<DataTable, number>>;

/** What changed on one side, per verb and table. `purged` counts expired tombstones dropped. */
export type Counts = Record<Verb, TableCounts> & { purged: number };

export const emptyCounts = (): Counts => ({ added: {}, updated: {}, deleted: {}, restored: {}, purged: 0 });

export function addCounts(into: Counts, from: Counts): Counts {
  for (const verb of VERBS) for (const [t, n] of Object.entries(from[verb]) as [DataTable, number][]) into[verb][t] = (into[verb][t] ?? 0) + n;
  into.purged += from.purged;
  return into;
}

/** Records changed (expired tombstones aside). */
export const totalCount = (c: Counts, verbs: Verb[] = VERBS) => verbs.reduce((n, v) => n + Object.values(c[v]).reduce((a, b) => a + (b ?? 0), 0), 0);

/** One change needed to bring a side to the merged state. */
export type Change =
  | { kind: 'put'; key: Key; table: DataTable; rec: AnyRecord; verb: 'added' | 'updated' | 'restored' }
  | { kind: 'tombstone'; key: Key; table: DataTable; tomb: Tombstone; hadLive: boolean }
  | { kind: 'purge'; id: string };

export interface MergeOptions {
  /** Stamps for repairs, newer than everything in both sets. */
  stamp: () => string;
  now: number;
}

export interface MergeResult {
  merged: SyncSet;
  /** Changes for this device. The remote side has no ops: the engine renders `merged` into files. */
  local: Change[];
  counts: { local: Counts; remote: Counts };
  repairs: number;
}

function filter(set: SyncSet, keep: (v: Version) => boolean): SyncSet {
  return new Map([...set].filter(([, v]) => keep(v)));
}

/** The changes that turn `side` into `merged`. Keys whose stamp, state and content already match are skipped. */
export function diff(side: SyncSet, merged: SyncSet, repaired: ReadonlySet<Key> = new Set()): Change[] {
  const out: Change[] = [];
  for (const [key, m] of merged) {
    const s = side.get(key);
    if (sameVersion(s, m)) continue;
    // A repair that brings back a record this side had deleted counts as restored.
    if (m.live) out.push({ kind: 'put', key, table: m.table, rec: m.rec, verb: s?.live ? 'updated' : s && repaired.has(key) ? 'restored' : 'added' });
    else out.push({ kind: 'tombstone', key, table: m.table, tomb: m.tomb, hadLive: !!s?.live });
  }
  return out;
}

const expired = (set: SyncSet, cutoff: number): Change[] =>
  [...set.values()].flatMap((v): Change[] => (!v.live && v.tomb.deletedAt < cutoff ? [{ kind: 'purge', id: v.tomb.id }] : []));

export function count(changes: Change[]): Counts {
  const c = emptyCounts();
  for (const ch of changes) {
    if (ch.kind === 'put') c[ch.verb][ch.table] = (c[ch.verb][ch.table] ?? 0) + 1;
    else if (ch.kind === 'tombstone') {
      if (ch.hadLive) c.deleted[ch.table] = (c.deleted[ch.table] ?? 0) + 1;
    } else c.purged++;
  }
  return c;
}

/**
 * Merge two sides record by record: the newest stamp wins, and deletions win exact ties. Then the
 * integrity pass repairs broken references with newly stamped versions. Idempotent, commutative and
 * associative (repairs only add newer versions), so syncing again always converges. Pure.
 */
export function mergeSets(L: SyncSet, R: SyncSet, { stamp, now }: MergeOptions): MergeResult {
  const cutoff = now - TOMBSTONE_TTL;
  // Expired tombstones drop out of both sides; this device purges its own.
  const keep = (v: Version) => v.live || v.tomb.deletedAt >= cutoff;
  const lv = filter(L, keep);
  const rv = filter(R, keep);
  const merged: SyncSet = new Map();
  for (const key of new Set([...lv.keys(), ...rv.keys()])) merged.set(key, winner(lv.get(key), rv.get(key)));
  const repaired = repair(merged, lv, rv, stamp);
  const local = [...diff(lv, merged, repaired), ...expired(L, cutoff)];
  const remote = [...diff(rv, merged, repaired), ...expired(R, cutoff)];
  return { merged, local, counts: { local: count(local), remote: count(remote) }, repairs: repaired.size };
}

export interface Samples {
  entries: Entry[];
  checkins: Checkin[];
}

/** Ops that apply `changes` to this device, verbatim. Includes the cascade to this device's sample data. */
export function planToOps(changes: Change[], samples: Samples): Op[] {
  const ops: Op[] = [];
  const goneExercises = new Set<string>();
  const goneParts = new Set<string>();
  for (const c of changes) {
    if (c.kind === 'put') ops.push(put(c.table, c.rec as never));
    else if (c.kind === 'tombstone') {
      if (c.hadLive) {
        ops.push(del(c.table, c.tomb.key));
        if (c.table === 'exercises') goneExercises.add(c.tomb.key);
        if (c.table === 'bodyParts') goneParts.add(c.tomb.key);
      }
      ops.push(put('tombstones', c.tomb));
    } else ops.push(del('tombstones', c.id));
  }
  // Sample data never syncs, so deletions from other devices reach it here, as opsDeleteExercise and opsDeleteBodyPart would.
  for (const e of samples.entries) if (goneExercises.has(e.exerciseId)) ops.push(del('entries', e.id));
  for (const c of samples.checkins) {
    if (!c.pains.some((p) => goneParts.has(p.bodyPartId))) continue;
    ops.push(put('checkins', { ...c, pains: c.pains.filter((p) => !goneParts.has(p.bodyPartId)), hlc: c.hlc ?? legacyStamp(c) }));
  }
  return ops;
}
