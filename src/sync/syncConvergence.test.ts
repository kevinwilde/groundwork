import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterAll, describe, expect, it } from 'vitest';
import { applyOps, readAll, type Op } from '../data/ops';
import { buildData } from '../data/snapshot';
import type { GroundworkDB } from '../db/db';
import { FakeGitHub, type Route } from '../test/fakeGitHub';
import { int, pick, randomEdit, rng, seededDevice, setText, type Rng } from '../test/randomEdits';
import { openContext, runSync, testConnection, type SyncContext } from './engine';
import { SyncError } from './errors';
import { isManagedPath, parseFile } from './layout';
import { readSyncSet } from './local';
import { index, winner, type SyncSet, type Version } from './merge';

const MIN = 60_000;
const ROUTES: Route[] = ['getRef', 'getCommit', 'getTree', 'getBlob', 'createTree', 'createCommit', 'updateRef', 'getRepo'];
const names: string[] = [];
afterAll(async () => {
  for (const n of names) await Dexie.delete(n);
});

interface Device {
  name: string;
  db: GroundworkDB;
  ctx: SyncContext;
  undo: Op[][];
  /** Set this device's clock offset. */
  skew: (ms: number) => void;
}

async function run(seed: number) {
  const r: Rng = rng(seed);
  let wall = Date.UTC(2026, 9, 7, 8);
  const fake = new FakeGitHub();
  fake.now = () => wall;

  const devices: Device[] = [];
  for (const [i, name] of ['Mac', 'iPhone', 'iPad'].entries()) {
    const dbName = `sync-conv-${seed}-${name}`;
    names.push(dbName);
    const db = await seededDevice(dbName, { samples: i === 1 });
    let offset = int(r, -10, 10) * MIN;
    const now = () => wall + offset;
    const res = await testConnection({ repo: 'kevinwilde/groundwork-data', token: `github_pat_${name}`, deviceName: name }, { db, fetch: fake.fetch, now });
    if (!res.ok) throw res.error;
    const ctx = (await openContext(db, { fetch: fake.fetch, now, lock: (fn) => fn(), sleep: async () => {}, random: r, online: () => true }))!;
    devices.push({ name, db, ctx, undo: [], skew: (ms) => (offset = ms) });
  }

  const sync = async (dev: Device) => {
    try {
      await runSync(dev.ctx);
    } catch (e) {
      if (!(e instanceof SyncError)) throw e;
    }
  };

  // Per key, the newest version any device has ever held.
  const oracle: SyncSet = new Map();
  const fold = async () => {
    for (const dev of devices) for (const [k, v] of (await readSyncSet(dev.db)).set) oracle.set(k, winner(oracle.get(k), v));
  };

  for (let step = 0; step < 300; step++) {
    wall += int(r, 0, 20_000);
    const dev = pick(r, devices)!;
    const roll = r();
    if (roll < 0.6) {
      const ops = randomEdit(r, buildData(await readAll(dev.db)), dev.ctx.now());
      if (ops?.length) dev.undo.push(await applyOps(ops, { db: dev.db, now: dev.ctx.now }));
    } else if (roll < 0.68) {
      const inverse = dev.undo.pop();
      if (inverse) await applyOps(inverse, { db: dev.db, now: dev.ctx.now });
    } else {
      fake.chaos = { rate: 0.05, random: r };
      if (r() < 0.2) {
        // Another device runs a whole sync at a random point in this one.
        const other = pick(
          r,
          devices.filter((d) => d !== dev),
        )!;
        fake.before(pick(r, ROUTES)!, () => sync(other));
      }
      await sync(dev);
      fake.chaos = null;
      fake.clearHooks();
    }
    if (r() < 0.03) dev.skew(int(r, -10, 10) * MIN);
    await fold();
  }

  // Sync everyone until a whole round makes no commit.
  let rounds = 0;
  for (let before = -1; before !== fake.commits.size && rounds < 8; rounds++) {
    before = fake.commits.size;
    for (const dev of devices) {
      wall += 1000;
      await runSync(dev.ctx);
    }
  }
  await fold();
  return { fake, devices, oracle, rounds };
}

/** The records in a set of files (the branch head by default). */
const remoteSet = (fake: FakeGitHub, files = fake.files()) => index([...files].flatMap(([p, text]) => (isManagedPath(p) ? parseFile(p, text) : [])));

describe('sync convergence (three devices, one fake GitHub)', () => {
  for (const seed of [11, 12]) {
    it(`converges after random edits, syncs, interleavings and failures (seed ${seed})`, async () => {
      const { fake, devices, oracle, rounds } = await run(seed);
      expect(rounds).toBeLessThan(8);
      const remote = remoteSet(fake);
      for (const dev of devices) expect(setText((await readSyncSet(dev.db)).set), dev.name).toBe(setText(remote));
      expect(setText(remote)).toBe(setText(oracle));
      expect([...remote.values()].filter((v: Version) => v.table === 'entries' && v.live).length).toBeGreaterThan(5);

      // Every commit's files parse, and no commit repeats its parent's tree.
      for (const c of fake.commits.values()) {
        const files = new Map([...fake.trees.get(c.tree)!].map(([p, sha]) => [p, fake.blobs.get(sha)!]));
        expect(() => remoteSet(fake, files)).not.toThrow();
        for (const p of c.parents) expect(fake.commits.get(p)!.tree).not.toBe(c.tree);
      }
      expect(fake.forcedUpdates).toBe(0);
      expect(fake.history().every((c) => c.parents.length <= 1)).toBe(true);
    }, 120_000);
  }
});
