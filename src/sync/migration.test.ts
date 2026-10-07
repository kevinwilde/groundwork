import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { bootstrap } from '../data/bootstrap';
import { readAll } from '../data/ops';
import { db as defaultDb, GroundworkDB } from '../db/db';
import { libraryOps, seedIndex } from '../db/seed';
import { TABLES } from '../db/types';
import { encode, isHlc, SEED_GONE_HLC, SEED_HLC } from './hlc';
import { stampLegacy } from './legacy';
import { getMeta, readSyncSet } from './local';

const FIRST_RUN = 1_758_790_000_000;
const NOW = 1_791_380_000_000;
const names: string[] = [];

afterEach(async () => {
  for (const n of names.splice(0)) await Dexie.delete(n);
});

/** A v2 database as a real install left it: the library seeded at first run, unstamped, then used. */
async function makeV2(name: string) {
  names.push(name);
  const v2 = new Dexie(name);
  v2.version(1).stores({
    types: 'id', tags: 'id, name', exercises: 'id, typeId, *tagIds', entries: 'id, date, exerciseId, snackId',
    snacks: 'id', bodyParts: 'id', checkins: 'id, date', views: 'id', settings: 'key',
  });
  v2.version(2).stores({ entries: 'id, date, exerciseId, snackId, sessionId', sessions: 'id' });
  await v2.open();
  for (const op of libraryOps(FIRST_RUN)) {
    if (op.type !== 'put') continue;
    const { hlc: _, ...rec } = op.value as unknown as Record<string, unknown>;
    if (op.table === 'tags' && rec.id === 'tag_calves') continue; // deleted by the user in v2
    if (op.table === 'exercises' && rec.id === 'ex_rdl') Object.assign(rec, { name: 'RDL', updatedAt: FIRST_RUN + 5000 });
    await v2.table(op.table).put(rec);
  }
  await v2.table('entries').bulkPut([
    { id: 'en_mine', exerciseId: 'ex_rdl', date: '2026-09-30', notes: '', source: 'log', createdAt: FIRST_RUN + 1000, sets: [{ reps: 6, weight: 95 }] },
    { id: 'en_sample', exerciseId: 'ex_rdl', date: '2026-09-20', notes: '', source: 'log', sample: true, createdAt: FIRST_RUN },
  ]);
  await v2.table('settings').bulkPut([
    { key: 'seeded', value: true },
    { key: 'weekStart', value: 1 },
    { key: 'lastExportAt', value: FIRST_RUN + 2000 },
  ]);
  v2.close();
}

async function dump(db: GroundworkDB) {
  return { ...(await readAll(db)), tombstones: await db.tombstones.toArray() };
}

describe('upgrading a v2 database', () => {
  it('opens as v3 with its data intact', async () => {
    await makeV2('gw-migrate-open');
    const db = new GroundworkDB('gw-migrate-open');
    await db.open();
    expect(db.verno).toBe(3);
    expect(await db.entries.get('en_mine')).toMatchObject({ exerciseId: 'ex_rdl', sets: [{ reps: 6, weight: 95 }] });
    expect(await db.exercises.get('ex_rdl')).toMatchObject({ name: 'RDL', createdAt: FIRST_RUN });
    expect(await db.tags.count()).toBe([...seedIndex().values()].filter((x) => x.table === 'tags').length - 1);
    expect(await db.tombstones.count()).toBe(0);
    expect(await db.meta.count()).toBe(0);
    db.close();
  });

  it('stamps every record once, keeping unchanged starter records identical to the seed', async () => {
    await makeV2('gw-migrate-stamp');
    const db = new GroundworkDB('gw-migrate-stamp');
    await stampLegacy(db, () => NOW);
    const raw = await readAll(db);
    for (const table of TABLES) for (const rec of raw[table]) expect(isHlc(rec.hlc), `${table} ${JSON.stringify(rec)}`).toBe(true);

    // Unchanged starter records become the exact seed record.
    for (const [id, { table, rec }] of seedIndex()) {
      if (id === 'tags:tag_calves' || id === 'exercises:ex_rdl') continue;
      expect(await db.table(table).get(rec.id as string)).toEqual(rec);
    }
    // Edited ones and the user's own records get legacy stamps from their own times.
    expect(await db.exercises.get('ex_rdl')).toMatchObject({ name: 'RDL', createdAt: FIRST_RUN, hlc: encode(FIRST_RUN + 5000, 0, 'legacy') });
    expect((await db.entries.get('en_mine'))!.hlc).toBe(encode(FIRST_RUN + 1000, 0, 'legacy'));
    expect((await db.settings.get('weekStart'))!.hlc).toBe(encode(0, 0, 'legacy'));
    // A missing starter record was deleted by the user.
    expect(await db.tombstones.toArray()).toEqual([{ id: 'tags:tag_calves', table: 'tags', key: 'tag_calves', hlc: SEED_GONE_HLC, deletedAt: NOW }]);
    expect(await getMeta(db, 'legacyStamped')).toBe(true);

    // Running again changes nothing, even without the flag.
    const before = await dump(db);
    await stampLegacy(db, () => NOW + 1);
    await db.meta.delete('legacyStamped');
    await stampLegacy(db, () => NOW + 2);
    expect(await dump(db)).toEqual(before);
    db.close();
  });

  it('leaves sample data and device-local settings out of the sync set', async () => {
    await makeV2('gw-migrate-set');
    const db = new GroundworkDB('gw-migrate-set');
    await stampLegacy(db, () => NOW);
    const snap = await readSyncSet(db);
    expect(snap.set.has('entries:en_mine')).toBe(true);
    expect(snap.set.has('entries:en_sample')).toBe(false);
    expect(snap.set.has('settings:weekStart')).toBe(true);
    expect(snap.set.has('settings:seeded') || snap.set.has('settings:lastExportAt')).toBe(false);
    expect(snap.set.get('tags:tag_calves')).toMatchObject({ live: false, hlc: SEED_GONE_HLC });
    expect(snap.samples.entries.map((e) => e.id)).toEqual(['en_sample']);
    db.close();
  });
});

describe('first run on v3', () => {
  it('seeds the starter library and sample data verbatim', async () => {
    await defaultDb.delete();
    await bootstrap();
    const raw = await readAll();
    expect(raw.exercises.length).toBeGreaterThan(10);
    for (const ex of raw.exercises) expect(ex).toEqual(seedIndex().get(`exercises:${ex.id}`)!.rec);
    expect(raw.entries.length).toBeGreaterThan(10);
    expect(raw.entries.every((e) => e.sample && e.hlc === SEED_HLC)).toBe(true);
    expect(raw.settings.find((s) => s.key === 'seeded')).toEqual({ key: 'seeded', value: true, hlc: SEED_HLC });
    expect(await defaultDb.tombstones.count()).toBe(0);
    expect((await getMeta(defaultDb, 'device'))!.id).toMatch(/^[0-9a-z]{10}$/);
    expect(await getMeta(defaultDb, 'legacyStamped')).toBe(true);
  });
});
