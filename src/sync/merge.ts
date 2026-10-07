import type { DataTable, Tombstone } from '../db/types';
import { canonical } from './canonical';
import { isHlc, legacyStamp } from './hlc';
import { keyOf, tombstoneId } from './scope';

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
