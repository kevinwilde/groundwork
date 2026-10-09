import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterAll, describe, expect, it } from 'vitest';
import { applyOps, put, readAll, type Op } from '../data/ops';
import { buildData } from '../data/snapshot';
import type { GroundworkDB } from '../db/db';
import { int, randomEdit, rng, seededDevice, setText } from '../test/randomEdits';
import { Clock, maxHlc } from './hlc';
import { readSyncSet } from './local';
import { mergeSets, planToOps } from './merge';

const BASE = 1_791_380_000_000;
const MIN = 60_000;
const names: string[] = [];
afterAll(async () => {
  for (const n of names) await Dexie.delete(n);
});

interface Device {
  db: GroundworkDB;
  offset: number;
  undo: Op[][];
}

let wall = BASE;
const nowOf = (dev: Device) => () => wall + dev.offset;

async function device(name: string, offset: number, samples = false): Promise<Device> {
  names.push(name);
  return { db: await seededDevice(name, { samples }), offset, undo: [] };
}

/** Merge Y into X, then give Y the merged state too, as pushing to GitHub would. */
async function merge(X: Device, Y: Device) {
  const sx = await readSyncSet(X.db);
  const sy = await readSyncSet(Y.db);
  const stamp = Clock.from(sx.clock).observe(maxHlc([...sy.set.values()].map((v) => v.hlc))).stamper(sx.device!.id, nowOf(X)());
  const m = mergeSets(sx.set, sy.set, { stamp, now: nowOf(X)() });
  if (m.local.length) await applyOps(planToOps(m.local, sx.samples), { db: X.db, mode: 'verbatim', expectSeq: sx.seq, now: nowOf(X) });
  const my = mergeSets(sy.set, m.merged, { stamp: () => 'unused', now: nowOf(Y)() });
  expect(my.repairs).toBe(0);
  if (my.local.length) await applyOps(planToOps(my.local, sy.samples), { db: Y.db, mode: 'verbatim', expectSeq: sy.seq, now: nowOf(Y) });
}

async function edit(r: () => number, dev: Device) {
  const d = buildData(await readAll(dev.db));
  const ops = randomEdit(r, d, nowOf(dev)());
  if (!ops?.length) return;
  dev.undo.push(await applyOps(ops, { db: dev.db, now: nowOf(dev) }));
}

describe('merge convergence (two databases, no GitHub)', () => {
  for (const seed of [1, 2, 3]) {
    it(`converges after random edits, undos and merges (seed ${seed})`, async () => {
      const r = rng(seed);
      wall = BASE;
      const A = await device(`conv-a-${seed}`, int(r, -10, 10) * MIN, true);
      const B = await device(`conv-b-${seed}`, int(r, -10, 10) * MIN);
      for (let step = 0; step < 200; step++) {
        wall += int(r, 0, 30_000);
        const dev = r() < 0.5 ? A : B;
        const roll = r();
        if (roll < 0.75) await edit(r, dev);
        else if (roll < 0.85) {
          const inverse = dev.undo.pop();
          if (inverse) await applyOps(inverse, { db: dev.db, now: nowOf(dev) });
        } else if (r() < 0.5) await merge(A, B);
        else await merge(B, A);
        if (r() < 0.05) dev.offset = int(r, -10, 10) * MIN;
      }
      await merge(A, B);
      const a = await readSyncSet(A.db);
      const b = await readSyncSet(B.db);
      expect(setText(a.set)).toBe(setText(b.set));
      // Both devices' own work arrived on the other: entries, tombstones and edits.
      expect([...a.set.values()].filter((v) => v.table === 'entries' && v.live).length).toBeGreaterThan(0);
      expect([...a.set.values()].some((v) => !v.live)).toBe(true);
      // Plans were created, ticked and deleted along the way.
      expect([...a.set.values()].some((v) => v.table === 'plans')).toBe(true);
      // Nothing left to do in either direction.
      expect(mergeSets(a.set, b.set, { stamp: () => 'x', now: wall }).local).toEqual([]);
      expect(mergeSets(b.set, a.set, { stamp: () => 'x', now: wall }).local).toEqual([]);
      // A key is never both live and tombstoned on a device.
      for (const dev of [A, B]) {
        const raw = await readAll(dev.db);
        const tombs = new Set(await dev.db.tombstones.toCollection().primaryKeys());
        for (const [table, list] of Object.entries(raw)) for (const rec of list as { id?: string; key?: string }[]) expect(tombs.has(`${table}:${rec.id ?? rec.key}`)).toBe(false);
      }
    }, 60_000);
  }

  it('lets an edit made after a merge win, even on a device whose clock is 5 minutes slow', async () => {
    wall = BASE;
    const A = await device('skew-a', -5 * MIN);
    const B = await device('skew-b', 0);
    const rename = async (dev: Device, name: string) => {
      const ex = (await dev.db.exercises.get('ex_rdl'))!;
      await applyOps([put('exercises', { ...ex, name })], { db: dev.db, now: nowOf(dev) });
    };
    await rename(B, 'from B');
    await merge(A, B);
    wall += 1000;
    await rename(A, 'from A, later');
    await merge(B, A);
    for (const dev of [A, B]) expect((await dev.db.exercises.get('ex_rdl'))!.name).toBe('from A, later');
  });

  it('keeps sample data out of the other device', async () => {
    wall = BASE;
    const A = await device('samples-a', 0, true);
    const B = await device('samples-b', 0);
    await merge(A, B);
    expect((await readAll(A.db)).entries.length).toBeGreaterThan(10);
    expect((await readAll(B.db)).entries).toEqual([]);
  });
});
