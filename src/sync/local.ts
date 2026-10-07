import { applyOps, del, readAll } from '../data/ops';
import { db as defaultDb, type GroundworkDB } from '../db/db';
import { TABLES } from '../db/types';
import { newDevice, type DeviceInfo } from './device';
import type { ClockState } from './hlc';
import { index, liveVersion, tombVersion, type Samples, type SyncSet, type Version } from './merge';
import { isSynced, TOMBSTONE_TTL } from './scope';

/** Which repository this device syncs with. Holds no secret, so the Sync card's live query may read it. */
export interface GitHubConfig {
  owner: string;
  repo: string;
  branch: string;
  htmlUrl: string;
  /** The token's last four characters, e.g. "…X9aB". */
  tokenHint: string;
  tokenExpiresAt?: number;
  connectedAt: number;
}

/** Where the latest change on GitHub came from (commit trailers and date). */
export interface RemoteInfo {
  device?: string;
  deviceId?: string;
  at: number;
}

/** Saved after a sync that left both sides equal. */
export interface SyncState {
  commit: string;
  tree: string;
  seq: number;
  at: number;
  remote: RemoteInfo;
}

/**
 * Typed rows of the `meta` table. The token lives in its own row, `githubToken`, which only
 * src/sync/engine.ts reads or writes, so it isn't listed here.
 */
export interface MetaValues {
  device: DeviceInfo;
  clock: ClockState;
  seq: number;
  legacyStamped: boolean;
  github: GitHubConfig;
  syncState: SyncState;
}
export type MetaKey = keyof MetaValues;

export async function getMeta<K extends MetaKey>(db: GroundworkDB, key: K): Promise<MetaValues[K] | undefined> {
  return (await db.meta.get(key))?.value as MetaValues[K] | undefined;
}

export const setMeta = <K extends MetaKey>(db: GroundworkDB, key: K, value: MetaValues[K]) => db.meta.put({ key, value });

export const deleteMeta = (db: GroundworkDB, ...keys: MetaKey[]) => db.meta.bulkDelete(keys);

/** This device's id and name, created on first use. */
export function ensureDevice(db: GroundworkDB = defaultDb): Promise<DeviceInfo> {
  return db.transaction('rw', db.meta, async () => {
    const found = await getMeta(db, 'device');
    if (found) return found;
    const device = newDevice();
    await setMeta(db, 'device', device);
    return device;
  });
}

/** Drop tombstones older than a year. Merges drop them too, so they leave GitHub at the next push. */
export async function purgeTombstones(db: GroundworkDB = defaultDb, now = Date.now()) {
  const ids = await db.tombstones.where('deletedAt').below(now - TOMBSTONE_TTL).primaryKeys();
  if (ids.length) await applyOps(ids.map((id) => del('tombstones', id)), { db, mode: 'verbatim', origin: 'bootstrap' });
}

export interface Snapshot {
  /** Synced records and tombstones. */
  set: SyncSet;
  seq: number;
  clock: ClockState | undefined;
  device: DeviceInfo | undefined;
  /** This device's sample records, for cascading deletes that arrive from other devices. */
  samples: Samples;
}

/** Everything a sync needs from this device, read in one transaction. */
export function readSyncSet(db: GroundworkDB = defaultDb): Promise<Snapshot> {
  return db.transaction('r', [...TABLES, 'tombstones', 'meta'], async () => {
    const [raw, tombs, seq, clock, device] = await Promise.all([readAll(db), db.tombstones.toArray(), getMeta(db, 'seq'), getMeta(db, 'clock'), getMeta(db, 'device')]);
    const versions: Version[] = [];
    for (const table of TABLES) for (const rec of raw[table]) if (isSynced(table, rec)) versions.push(liveVersion(table, rec as unknown as Record<string, unknown>));
    for (const t of tombs) versions.push(tombVersion(t));
    return {
      set: index(versions),
      seq: seq ?? 0,
      clock,
      device,
      samples: { entries: raw.entries.filter((e) => e.sample), checkins: raw.checkins.filter((c) => c.sample) },
    };
  });
}
