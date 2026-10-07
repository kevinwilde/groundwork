import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GroundworkDB } from '../db/db';
import type { Entry, Tag } from '../db/types';
import { decode, encode, SEED_HLC } from '../sync/hlc';
import { applyOps, clear, del, put, StaleError } from './ops';

let db: GroundworkDB;
let t = 1_000_000;
const now = () => t;
const local = () => ({ db, now });
const verbatim = () => ({ db, now, mode: 'verbatim' as const });

const tag = (id: string, name = id): Tag => ({ id, name, color: '#2459D1', createdAt: 1 });
const entry = (id: string, extra: Partial<Entry> = {}): Entry => ({ id, exerciseId: 'ex_rdl', date: '2026-10-01', notes: '', source: 'log', createdAt: 1, ...extra });

async function dump(target = db) {
  const out: Record<string, unknown[]> = {};
  for (const table of target.tables) if (table.name !== 'meta') out[table.name] = await table.toArray();
  return out;
}

beforeEach(async () => {
  db = new GroundworkDB(`ops-test-${Math.random()}`);
  await db.open();
  t = 1_000_000;
});
afterEach(async () => {
  db.close();
  await Dexie.delete(db.name);
});

describe('applyOps stamping', () => {
  it('stamps puts with this device and the time', async () => {
    await applyOps([put('tags', tag('tag_a'))], local());
    const device = (await db.meta.get('device'))!.value as { id: string };
    const rec = (await db.tags.get('tag_a'))!;
    expect(decode(rec.hlc!)).toEqual({ wall: 1_000_000, counter: 0, node: device.id });
    expect(rec.updatedAt).toBe(1_000_000);
    expect((await db.meta.get('seq'))!.value).toBe(1);
  });

  it('keeps the stamp when a put changes nothing', async () => {
    await applyOps([put('tags', tag('tag_a'))], local());
    const first = (await db.tags.get('tag_a'))!;
    t += 5000;
    await applyOps([put('tags', { ...first, updatedAt: t })], local());
    expect(await db.tags.get('tag_a')).toEqual(first);
    await applyOps([put('tags', { ...first, name: 'renamed' })], local());
    const edited = (await db.tags.get('tag_a'))!;
    expect(edited.hlc! > first.hlc!).toBe(true);
    expect(edited.updatedAt).toBe(t);
  });

  it('leaves a tombstone when a synced record is deleted', async () => {
    await applyOps([put('tags', tag('tag_a'))], local());
    const rec = (await db.tags.get('tag_a'))!;
    t += 10;
    await applyOps([del('tags', 'tag_a')], local());
    const tomb = (await db.tombstones.get('tags:tag_a'))!;
    expect(tomb).toMatchObject({ table: 'tags', key: 'tag_a', deletedAt: t });
    expect(tomb.hlc > rec.hlc!).toBe(true);
    // Deleting something that isn't there leaves nothing.
    await applyOps([del('tags', 'tag_missing')], local());
    expect(await db.tombstones.get('tags:tag_missing')).toBeUndefined();
  });

  it('leaves no tombstone for sample records or device-local settings', async () => {
    await applyOps([put('entries', entry('en_s', { sample: true })), put('settings', { key: 'lastExportAt', value: 5 }), put('settings', { key: 'weekStart', value: 1 })], local());
    await applyOps([del('entries', 'en_s'), del('settings', 'lastExportAt'), del('settings', 'weekStart')], local());
    expect((await db.tombstones.toArray()).map((x) => x.id)).toEqual(['settings:weekStart']);
  });

  it('lets Undo of a delete beat its tombstone and remove it', async () => {
    await applyOps([put('tags', tag('tag_a'))], local());
    t += 10;
    const inverse = await applyOps([del('tags', 'tag_a')], local());
    const tomb = (await db.tombstones.get('tags:tag_a'))!;
    t += 10;
    await applyOps(inverse, local());
    const back = (await db.tags.get('tag_a'))!;
    expect(back.name).toBe('tag_a');
    expect(back.hlc! > tomb.hlc).toBe(true);
    expect(await db.tombstones.count()).toBe(0);
  });

  it('counts Undo of an edit as a new edit', async () => {
    await applyOps([put('tags', tag('tag_a'))], local());
    t += 10;
    const inverse = await applyOps([put('tags', tag('tag_a', 'renamed'))], local());
    const edited = (await db.tags.get('tag_a'))!;
    t += 10;
    await applyOps(inverse, local());
    const undone = (await db.tags.get('tag_a'))!;
    expect(undone.name).toBe('tag_a');
    expect(undone.hlc! > edited.hlc!).toBe(true);
  });

  it('ignores tombstone ops in local mode', async () => {
    const tomb = { id: 'tags:x', table: 'tags' as const, key: 'x', hlc: SEED_HLC, deletedAt: 0 };
    expect(await applyOps([put('tombstones', tomb)], local())).toEqual([]);
    expect(await db.tombstones.count()).toBe(0);
    expect(await db.meta.get('seq')).toBeUndefined();
  });

  it('restores the exact state, tombstones included, when the inverse is replayed verbatim', async () => {
    await applyOps([put('tags', tag('tag_a')), put('tags', tag('tag_b')), put('entries', entry('en_1')), put('entries', entry('en_s', { sample: true }))], local());
    t += 10;
    await applyOps([del('tags', 'tag_b')], local());
    const before = await dump();
    t += 10;
    const inverse = await applyOps(
      [put('tags', tag('tag_b', 'revived')), put('tags', tag('tag_a', 'edited')), put('tags', tag('tag_c')), del('entries', 'en_1'), del('entries', 'en_s'), put('settings', { key: 'weekStart', value: 1 })],
      local(),
    );
    expect(await dump()).not.toEqual(before);
    await applyOps(inverse, verbatim());
    expect(await dump()).toEqual(before);
  });

  it('writes verbatim records as given, and requires a stamp', async () => {
    const rec = { ...tag('tag_a'), hlc: encode(5, 0, 'x'), updatedAt: 3 };
    await applyOps([put('tags', rec)], verbatim());
    expect(await db.tags.get('tag_a')).toEqual(rec);
    await expect(applyOps([put('tags', tag('tag_b'))], verbatim())).rejects.toThrow(/sync stamp/);
    expect(await db.tags.get('tag_b')).toBeUndefined();
  });

  it('removes a tombstone when a verbatim put brings the record back, but adds none on delete', async () => {
    await applyOps([put('tags', tag('tag_a'))], local());
    await applyOps([del('tags', 'tag_a')], local());
    await applyOps([put('tags', { ...tag('tag_a'), hlc: encode(t + 99, 0, 'x') })], verbatim());
    expect(await db.tombstones.count()).toBe(0);
    await applyOps([del('tags', 'tag_a')], verbatim());
    expect(await db.tombstones.count()).toBe(0);
  });

  it('raises the clock to the newest stamp written verbatim', async () => {
    const future = encode(t + 3_600_000, 4, 'zzzz');
    await applyOps([put('tags', { ...tag('tag_a'), hlc: future })], verbatim());
    await applyOps([put('tags', tag('tag_b'))], local());
    expect((await db.tags.get('tag_b'))!.hlc! > future).toBe(true);
  });

  it('refuses with StaleError when something was written since the snapshot', async () => {
    await applyOps([put('tags', tag('tag_a'))], local());
    await applyOps([put('tags', tag('tag_b'))], local());
    expect((await db.meta.get('seq'))!.value).toBe(2);
    await expect(applyOps([put('tags', tag('tag_c'))], { ...local(), expectSeq: 1 })).rejects.toBeInstanceOf(StaleError);
    expect(await db.tags.get('tag_c')).toBeUndefined();
    await applyOps([put('tags', tag('tag_c'))], { ...local(), expectSeq: 2 });
    expect((await db.meta.get('seq'))!.value).toBe(3);
  });

  it('never creates tombstones when clearing', async () => {
    await applyOps([put('tags', tag('tag_a'))], local());
    await applyOps([clear('tags')], local());
    expect(await db.tags.count()).toBe(0);
    expect(await db.tombstones.count()).toBe(0);
  });
});
