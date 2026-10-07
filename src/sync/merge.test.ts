import { describe, expect, it } from 'vitest';
import type { DataTable, Tombstone } from '../db/types';
import { libraryOps } from '../db/seed';
import { encode, SEED_GONE_HLC, SEED_HLC } from './hlc';
import { count, diff, index, liveVersion, mergeSets, planToOps, tombVersion, winner, type AnyRecord, type Change, type SyncSet, type Version } from './merge';
import { isSynced, keyOf, TOMBSTONE_TTL } from './scope';

const NOW = 1_791_380_000_000;
const h = (wall: number, node = 'a', counter = 0) => encode(NOW - 1_000_000 + wall, counter, node);
let stampN = 0;
const opts = () => ({ stamp: () => h(900_000, 'z', ++stampN), now: NOW });

const rec = (table: DataTable, id: string, hlc: string, extra: AnyRecord = {}): Version =>
  liveVersion(table, table === 'settings' ? { key: id, value: 0, hlc, ...extra } : { id, name: id, createdAt: 1, hlc, ...extra });
const tomb = (table: DataTable, key: string, hlc: string, deletedAt = NOW - 1000): Version => tombVersion({ id: `${table}:${key}`, table, key, hlc, deletedAt } satisfies Tombstone);
const set = (...vs: Version[]) => index(vs);

/** What the plan does to a side, without IndexedDB. */
function apply(side: SyncSet, changes: Change[]): SyncSet {
  const out = new Map(side);
  for (const c of changes) {
    if (c.kind === 'put') out.set(c.key, liveVersion(c.table, c.rec));
    else if (c.kind === 'tombstone') out.set(c.key, tombVersion(c.tomb));
    else out.delete(c.id as Version['key']);
  }
  return out;
}

const libSet = () => index(libraryOps().flatMap((o) => (o.type === 'put' && o.table !== 'tombstones' ? [liveVersion(o.table, o.value as unknown as AnyRecord)] : [])));

describe('winner', () => {
  it('picks the higher stamp, the deletion on an exact tie, and content order otherwise', () => {
    const a = rec('tags', 't', h(1));
    const b = rec('tags', 't', h(2));
    const gone = tomb('tags', 't', h(1));
    expect(winner(a, b)).toBe(b);
    expect(winner(a, gone)).toBe(gone);
    expect(winner(gone, a)).toBe(gone);
    const x = rec('tags', 't', h(1, 'legacy'), { name: 'x' });
    const y = rec('tags', 't', h(1, 'legacy'), { name: 'y' });
    expect(winner(x, y)).toBe(winner(y, x));
    // Two tombstones with the same stamp (SEED_GONE made on two devices) are ordered by content too.
    const g1 = tomb('tags', 't', SEED_GONE_HLC, 5);
    const g2 = tomb('tags', 't', SEED_GONE_HLC, 9);
    expect(winner(g1, g2)).toBe(winner(g2, g1));
    expect(winner(undefined, a)).toBe(a);
  });
});

describe('mergeSets: the edge cases', () => {
  const cases: { name: string; L: Version[]; R: Version[]; expect: (m: ReturnType<typeof mergeSets>) => void }[] = [
    {
      name: 'same record edited on both devices: the higher stamp wins the whole record',
      L: [rec('exercises', 'ex', h(5), { name: 'local', notes: 'mine' })],
      R: [rec('exercises', 'ex', h(7, 'b'), { name: 'remote' })],
      expect: (m) => {
        expect(m.merged.get('exercises:ex')).toMatchObject({ live: true, rec: { name: 'remote' } });
        expect((m.merged.get('exercises:ex') as { rec: AnyRecord }).rec.notes).toBeUndefined();
        expect(m.counts.local.updated).toEqual({ exercises: 1 });
        expect(m.counts.remote.updated).toEqual({});
      },
    },
    {
      name: 'deleted on A, unchanged on B: deleted on B',
      L: [rec('tags', 't', SEED_HLC)],
      R: [tomb('tags', 't', h(3, 'b'))],
      expect: (m) => {
        expect(m.local).toEqual([expect.objectContaining({ kind: 'tombstone', hadLive: true })]);
        expect(m.counts.local.deleted).toEqual({ tags: 1 });
      },
    },
    {
      name: 'deleted on A, edited later on B: comes back on A',
      L: [tomb('exercises', 'ex', h(3))],
      R: [rec('exercises', 'ex', h(4, 'b'), { name: 'edited' })],
      expect: (m) => {
        expect(m.local).toEqual([expect.objectContaining({ kind: 'put', verb: 'added', rec: expect.objectContaining({ name: 'edited' }) })]);
        expect(m.counts.remote).toMatchObject({ added: {}, deleted: {} });
      },
    },
    {
      name: 'undo of a delete: the re-put is newer than the tombstone that already synced',
      L: [rec('entries', 'en', h(9), { date: '2026-10-01' })],
      R: [tomb('entries', 'en', h(8))],
      expect: (m) => {
        expect(m.local).toEqual([]);
        expect(m.counts.remote.added).toEqual({ entries: 1 });
      },
    },
    {
      name: 'starter records unchanged on both sides produce nothing',
      L: [...libSet().values()],
      R: [...libSet().values()],
      expect: (m) => {
        expect(m.local).toEqual([]);
        expect(diff(libSet(), m.merged)).toEqual([]);
      },
    },
    {
      name: 'an edit of a starter record beats the seed copy',
      L: [rec('exercises', 'ex_rdl', SEED_HLC)],
      R: [rec('exercises', 'ex_rdl', h(1, 'b'), { name: 'RDL' })],
      expect: (m) => expect(m.counts.local.updated).toEqual({ exercises: 1 }),
    },
    {
      name: 'a starter record deleted before v3 beats an unchanged copy but loses to an edited one',
      L: [tomb('tags', 'gone', SEED_GONE_HLC), tomb('tags', 'kept', SEED_GONE_HLC)],
      R: [rec('tags', 'gone', SEED_HLC), rec('tags', 'kept', h(1, 'legacy'), { name: 'edited' })],
      expect: (m) => {
        expect(m.merged.get('tags:gone')!.live).toBe(false);
        expect(m.merged.get('tags:kept')!.live).toBe(true);
      },
    },
    {
      name: 'shared settings merge like records',
      L: [rec('settings', 'weekStart', h(1), { value: 0 })],
      R: [rec('settings', 'weekStart', h(2, 'b'), { value: 1 })],
      expect: (m) => expect(m.merged.get('settings:weekStart')).toMatchObject({ rec: { value: 1 } }),
    },
    {
      name: 'a tombstone for a record this device never had is stored without a delete',
      L: [],
      R: [tomb('entries', 'en', h(2, 'b'))],
      expect: (m) => {
        expect(m.local).toEqual([expect.objectContaining({ kind: 'tombstone', hadLive: false })]);
        expect(planToOps(m.local, { entries: [], checkins: [] }).map((o) => `${o.type} ${o.table}`)).toEqual(['put tombstones']);
        expect(m.counts.local.deleted).toEqual({});
      },
    },
    {
      name: 'expired tombstones drop out of both sides and become purge changes',
      L: [tomb('tags', 'old', h(1), NOW - TOMBSTONE_TTL - 1), tomb('tags', 'both', h(1), NOW - TOMBSTONE_TTL - 5)],
      R: [tomb('tags', 'both', h(1), NOW - TOMBSTONE_TTL - 5), tomb('tags', 'theirs', h(2, 'b'), NOW - TOMBSTONE_TTL - 9)],
      expect: (m) => {
        expect(m.merged.size).toBe(0);
        expect(m.local).toEqual([
          { kind: 'purge', id: 'tags:old' },
          { kind: 'purge', id: 'tags:both' },
        ]);
        expect(m.counts.remote.purged).toBe(2);
      },
    },
    {
      name: 'a record deleted more than a year ago on the other side comes back',
      L: [rec('tags', 't', h(1))],
      R: [tomb('tags', 't', h(2, 'b'), NOW - TOMBSTONE_TTL - 1)],
      expect: (m) => {
        expect(m.local).toEqual([]);
        expect(m.merged.get('tags:t')!.live).toBe(true);
        expect(m.counts.remote.added).toEqual({ tags: 1 });
      },
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const L = set(...c.L);
      const R = set(...c.R);
      const m = mergeSets(L, R, opts());
      c.expect(m);

      // Merging the same pair again, after applying the plan, gives nothing more to do.
      const L2 = apply(L, m.local);
      const again = mergeSets(L2, m.merged, opts());
      expect(again.local).toEqual([]);
      expect(diff(m.merged, again.merged)).toEqual([]);

      // Swapping sides mirrors the counts and gives the same merged state.
      const swapped = mergeSets(R, L, opts());
      expect(swapped.counts.local).toEqual(m.counts.remote);
      expect(swapped.counts.remote).toEqual(m.counts.local);
      expect(diff(m.merged, swapped.merged)).toEqual([]);
    });
  }

  it('is associative across three devices', () => {
    const A = set(rec('tags', 't1', h(3)), tomb('tags', 't2', h(5)), rec('entries', 'e', h(1), { date: '2026-10-01' }));
    const B = set(rec('tags', 't1', h(4, 'b')), rec('tags', 't2', h(4, 'b')));
    const C = set(tomb('entries', 'e', h(2, 'c')), rec('tags', 't3', h(1, 'c')));
    const ab_c = mergeSets(mergeSets(A, B, opts()).merged, C, opts()).merged;
    const a_bc = mergeSets(A, mergeSets(B, C, opts()).merged, opts()).merged;
    expect(diff(ab_c, a_bc)).toEqual([]);
    expect(ab_c.size).toBe(4);
  });

  it('never lets sample records or device-local settings into a set', () => {
    expect(isSynced('entries', { sample: true })).toBe(false);
    expect(isSynced('settings', { key: 'seeded' })).toBe(false);
    expect(isSynced('settings', { key: 'lastExportAt' })).toBe(false);
    expect(keyOf('settings', { key: 'weekStart' })).toBe('weekStart');
  });

  it('counts added, updated and deleted per table', () => {
    const L = set(rec('tags', 'a', h(1)), rec('tags', 'b', h(1)));
    const R = set(rec('tags', 'a', h(2, 'b')), tomb('tags', 'b', h(2, 'b')), rec('entries', 'n', h(2, 'b'), { date: '2026-10-01' }), rec('entries', 'm', h(2, 'b'), { date: '2026-10-02' }));
    const m = mergeSets(L, R, opts());
    expect(count(m.local)).toEqual({ added: { entries: 2 }, updated: { tags: 1 }, deleted: { tags: 1 }, restored: {}, purged: 0 });
  });
});

describe('planToOps', () => {
  it('cascades deletions from other devices to sample data', () => {
    const L = set(rec('exercises', 'ex_run', SEED_HLC), rec('bodyParts', 'bp_knee', SEED_HLC));
    const R = set(tomb('exercises', 'ex_run', h(1, 'b')), tomb('bodyParts', 'bp_knee', h(1, 'b')));
    const m = mergeSets(L, R, opts());
    const samples = {
      entries: [
        { id: 'en_s1', exerciseId: 'ex_run', date: '2026-10-01', notes: '', source: 'log' as const, sample: true, createdAt: 1, hlc: SEED_HLC },
        { id: 'en_s2', exerciseId: 'ex_other', date: '2026-10-01', notes: '', source: 'log' as const, sample: true, createdAt: 1, hlc: SEED_HLC },
      ],
      checkins: [
        {
          id: 'ci_s', date: '2026-10-01', time: '07:00', moment: 'Morning', overall: 3, notes: '', sample: true, createdAt: 1, hlc: SEED_HLC,
          pains: [{ bodyPartId: 'bp_knee', score: 3 }, { bodyPartId: 'bp_other', score: 1 }],
        },
      ],
    };
    const ops = planToOps(m.local, samples);
    expect(ops).toContainEqual({ table: 'entries', type: 'delete', key: 'en_s1' });
    expect(ops).not.toContainEqual({ table: 'entries', type: 'delete', key: 'en_s2' });
    expect(ops).toContainEqual({ table: 'checkins', type: 'put', value: { ...samples.checkins[0], pains: [{ bodyPartId: 'bp_other', score: 1 }] } });
    expect(ops.filter((o) => o.table === 'tombstones')).toHaveLength(2);
  });
});
