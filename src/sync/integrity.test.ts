import { describe, expect, it } from 'vitest';
import type { DataTable, Tombstone } from '../db/types';
import { decode, encode, maxHlc } from './hlc';
import { index, liveVersion, mergeSets, tombVersion, type AnyRecord, type SyncSet, type Version } from './merge';

const NOW = 1_791_380_000_000;
const h = (wall: number, node = 'a') => encode(NOW - 100_000 + wall, 0, node);
const live = (table: DataTable, id: string, hlc: string, extra: AnyRecord = {}): Version => liveVersion(table, { id, name: id, createdAt: 1, hlc, ...extra });
const gone = (table: DataTable, key: string, hlc: string): Version => tombVersion({ id: `${table}:${key}`, table, key, hlc, deletedAt: NOW - 10 } satisfies Tombstone);

function merge(L: Version[], R: Version[]) {
  let n = 0;
  const stamp = () => encode(NOW, ++n, 'repair');
  return mergeSets(index(L), index(R), { stamp, now: NOW });
}
const recOf = (set: SyncSet, key: string) => {
  const v = set.get(key as Version['key']);
  return v?.live ? v.rec : null;
};

describe('integrity pass', () => {
  it('brings back an exercise deleted on one device while the other logged it', () => {
    const exercise = live('exercises', 'ex', h(1), { typeId: 'type_lift', tagIds: [] });
    const m = merge([gone('exercises', 'ex', h(5)), live('types', 'type_lift', h(0))], [exercise, live('types', 'type_lift', h(0)), live('entries', 'en', h(6, 'b'), { exerciseId: 'ex', date: '2026-10-01' })]);
    expect(recOf(m.merged, 'exercises:ex')).toMatchObject({ name: 'ex', typeId: 'type_lift' });
    expect(m.repairs).toBe(1);
    expect(m.counts.local.restored).toEqual({ exercises: 1 });
    expect(m.counts.remote.updated).toEqual({ exercises: 1 });
  });

  it('brings back a mini-exercise\'s exercise, an exercise\'s type and a check-in\'s body part', () => {
    const m = merge(
      [gone('exercises', 'ex', h(5)), gone('types', 'ty', h(5)), gone('bodyParts', 'bp', h(5))],
      [
        live('exercises', 'ex', h(1), { typeId: 'ty_ok', tagIds: [] }),
        live('types', 'ty_ok', h(1)),
        live('types', 'ty', h(1)),
        live('bodyParts', 'bp', h(1)),
        live('snacks', 'sn', h(6, 'b'), { exerciseId: 'ex' }),
        live('exercises', 'ex2', h(6, 'b'), { typeId: 'ty', tagIds: [] }),
        live('checkins', 'ci', h(6, 'b'), { date: '2026-10-01', pains: [{ bodyPartId: 'bp', score: 2 }] }),
      ],
    );
    for (const k of ['exercises:ex', 'types:ty', 'bodyParts:bp']) expect(m.merged.get(k as Version['key'])!.live).toBe(true);
    expect(m.counts.local.restored).toEqual({ exercises: 1, types: 1, bodyParts: 1 });
  });

  it('strips deleted tags from exercises with a new stamp', () => {
    const m = merge([gone('tags', 'tg', h(5))], [live('tags', 'tg', h(1)), live('exercises', 'ex', h(6, 'b'), { typeId: 't', tagIds: ['tg', 'other'] })]);
    expect(recOf(m.merged, 'exercises:ex')!.tagIds).toEqual(['other']);
    expect(m.merged.get('tags:tg')!.live).toBe(false);
    expect(m.counts.local.added).toEqual({ exercises: 1 });
    expect(m.counts.remote.updated).toEqual({ exercises: 1 });
  });

  it('stamps repairs newer than everything in both sets', () => {
    const L = [gone('exercises', 'ex', h(50, 'zzzz'))];
    const R = [live('exercises', 'ex', h(1), { tagIds: [] }), live('entries', 'en', h(60, 'b'), { exerciseId: 'ex', date: '2026-10-01' })];
    const m = merge(L, R);
    const top = maxHlc([...L, ...R].map((v) => v.hlc))!;
    const repaired = m.merged.get('exercises:ex')!;
    expect(repaired.hlc > top).toBe(true);
    expect(decode(repaired.hlc).node).toBe('repair');
    expect(recOf(m.merged, 'exercises:ex')!.hlc).toBe(repaired.hlc);
  });

  it('repeats until nothing changes', () => {
    // The entry needs its exercise back; the restored exercise then needs its type back and loses a deleted tag.
    const m = merge(
      [gone('exercises', 'ex', h(5)), gone('types', 'ty', h(5)), gone('tags', 'tg', h(5))],
      [live('exercises', 'ex', h(1), { typeId: 'ty', tagIds: ['tg'] }), live('types', 'ty', h(1)), live('tags', 'tg', h(1)), live('entries', 'en', h(6, 'b'), { exerciseId: 'ex', date: '2026-10-01' })],
    );
    expect(recOf(m.merged, 'exercises:ex')).toMatchObject({ typeId: 'ty', tagIds: [] });
    expect(m.merged.get('types:ty')!.live).toBe(true);
    expect(m.merged.get('tags:tg')!.live).toBe(false);
    // Merging the result again needs no further repairs.
    const again = mergeSets(m.merged, m.merged, { stamp: () => encode(NOW, 999, 'x'), now: NOW });
    expect(again.repairs).toBe(0);
    expect(again.local).toEqual([]);
  });

  it('leaves a reference alone when no side has the parent live', () => {
    const m = merge([gone('exercises', 'ex', h(5))], [gone('exercises', 'ex', h(5)), live('entries', 'en', h(6, 'b'), { exerciseId: 'ex', date: '2026-10-01' })]);
    expect(m.merged.get('exercises:ex')!.live).toBe(false);
    expect(m.repairs).toBe(0);
  });
});
