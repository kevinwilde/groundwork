import { applyOps, put, readAll, type Op } from '../data/ops';
import type { RawData } from '../data/snapshot';
import { db as defaultDb, type GroundworkDB } from '../db/db';
import { seedIndex } from '../db/seed';
import { TABLES, type DataTable, type Tables, type Tombstone } from '../db/types';
import { sameContent } from './canonical';
import { isHlc, legacyStamp, SEED_GONE_HLC } from './hlc';
import { getMeta, setMeta } from './local';
import { keyOf, tombstoneId } from './scope';

type AnyRecord = Record<string, unknown>;

/** Starter records count as unchanged whatever their stamps and first-run time. */
const SEED_IGNORE = ['hlc', 'createdAt', 'updatedAt'];

/**
 * A stamp for a record written before v3 (or read from a v1/v2 backup). An unchanged starter
 * record becomes the exact seed record, so its file line is identical on every device;
 * anything else gets a legacy stamp from its own times.
 */
export function stampRecord(table: DataTable, rec: AnyRecord): AnyRecord {
  if (isHlc(rec.hlc)) return rec;
  const seed = seedIndex().get(tombstoneId(table, keyOf(table, rec)));
  if (seed && sameContent(rec, seed.rec, SEED_IGNORE)) return seed.rec;
  return { ...rec, hlc: legacyStamp(rec) };
}

/**
 * Ops that stamp every unstamped record and, once the starter library has been seeded,
 * tombstone the starter records that are missing: every deployed install was seeded with
 * the full library, so a missing one was deleted by the user. Pure.
 */
export function legacyOps(raw: RawData, tombstoneIds: Set<string>, now: number): Op[] {
  const ops: Op[] = [];
  const live = new Set<string>();
  for (const table of TABLES) {
    for (const rec of raw[table] as unknown as AnyRecord[]) {
      live.add(tombstoneId(table, keyOf(table, rec)));
      if (!isHlc(rec.hlc)) ops.push(put(table, stampRecord(table, rec) as unknown as Tables[typeof table]));
    }
  }
  if (raw.settings.some((s) => s.key === 'seeded' && s.value === true)) {
    for (const [id, { table, rec }] of seedIndex()) {
      if (live.has(id) || tombstoneIds.has(id)) continue;
      ops.push(put('tombstones', { id, table, key: keyOf(table, rec), hlc: SEED_GONE_HLC, deletedAt: now } satisfies Tombstone));
    }
  }
  return ops;
}

/** Stamp records from before v3, once, in one transaction. Runs in bootstrap before anything reads the data. */
export async function stampLegacy(db: GroundworkDB = defaultDb, now = Date.now): Promise<void> {
  if (await getMeta(db, 'legacyStamped')) return;
  await db.transaction('rw', [...TABLES, 'tombstones', 'meta'], async () => {
    if (await getMeta(db, 'legacyStamped')) return;
    const raw = await readAll(db);
    const ids = new Set(await db.tombstones.toCollection().primaryKeys());
    const ops = legacyOps(raw, ids, now());
    if (ops.length) await applyOps(ops, { db, mode: 'verbatim', origin: 'bootstrap', now });
    await setMeta(db, 'legacyStamped', true);
  });
}
