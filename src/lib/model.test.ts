import { describe, expect, it } from 'vitest';
import { put } from '../data/ops';
import { STARTER_TYPES } from '../db/seed';
import type { ExerciseType } from '../db/types';
import { entry, library } from '../test/fixtures';
import { parseField, parseQuick } from './fields';
import { lastEntry, metrics, opsDeleteBodyPart, opsDeleteExercise, opsDeleteTag, pace, snackQueue, summarize } from './model';

const type = (id: string) => ({ ...STARTER_TYPES.find((t) => t.id === id)!, createdAt: 0 }) as ExerciseType;
const lift = type('type_lift');
const run = type('type_run');
const hold = type('type_hold');
const bw = type('type_bw');

describe('summaries', () => {
  it('collapses identical sets', () => {
    expect(summarize(lift, { sets: [{ reps: 6, weight: 100 }, { reps: 6, weight: 100 }, { reps: 6, weight: 100 }] })).toBe('3 × 6 @ 100 lb');
  });
  it('lists varied sets', () => {
    expect(summarize(lift, { sets: [{ reps: 6, weight: 100 }, { reps: 6, weight: 100 }, { reps: 5, weight: 110 }] })).toBe('2 × 6 @ 100 lb, 5 @ 110 lb');
  });
  it('formats holds and bodyweight sets', () => {
    expect(summarize(hold, { sets: [{ duration: 60 }] })).toBe('60 s');
    expect(summarize(bw, { sets: [{ reps: 15 }, { reps: 15 }] })).toBe('2 × 15');
  });
  it('formats a run with pace and labelled secondary fields', () => {
    expect(summarize(run, { values: { duration: 1665, distance: 3.1, avgHr: 152 } })).toBe('27:45 · 3.1 mi · 8:57 /mi · Avg HR 152 bpm');
  });
  it('computes pace only with both time and distance', () => {
    expect(pace(run, { duration: 1800, distance: 3 })).toBe('10:00 /mi');
    expect(pace(run, { duration: 1800 })).toBeNull();
    expect(pace(lift, { duration: 1800, distance: 3 })).toBeNull();
  });
});

describe('metrics', () => {
  it('adds sets, reps and volume', () => {
    expect(metrics({ sets: [{ reps: 6, weight: 100 }, { reps: 5, weight: 110 }] })).toMatchObject({ entries: 1, sets: 2, reps: 11, volume: 1150 });
  });
  it('reads single-effort values', () => {
    expect(metrics({ values: { duration: 1800, distance: 3.5 } })).toMatchObject({ sets: 0, duration: 1800, distance: 3.5 });
  });
});

describe('quick entry', () => {
  it('parses sets × reps @ weight', () => {
    expect(parseQuick(lift, '3x6@100')).toEqual([
      { reps: 6, weight: 100 },
      { reps: 6, weight: 100 },
      { reps: 6, weight: 100 },
    ]);
    expect(parseQuick(lift, '5x5 225')).toHaveLength(5);
    expect(parseQuick(lift, '3 × 6 @ 100 lb')?.[0]).toEqual({ reps: 6, weight: 100 });
    expect(parseQuick(lift, '6@100')).toEqual([{ reps: 6, weight: 100 }]);
  });
  it('parses timed holds', () => {
    expect(parseQuick(hold, '3 × 60s')).toEqual([{ duration: 60 }, { duration: 60 }, { duration: 60 }]);
    expect(parseQuick(hold, '2x1:30')).toEqual([{ duration: 90 }, { duration: 90 }]);
    expect(parseQuick(hold, '3 x 45 s')).toHaveLength(3);
  });
  it('rejects input it cannot map', () => {
    expect(parseQuick(lift, 'heavy')).toBeNull();
    expect(parseQuick(bw, '3x10@20')).toBeNull(); // bodyweight has one field
    expect(parseQuick(lift, '')).toBeNull();
  });
  it('validates single fields', () => {
    expect(parseField(lift.fields[0], '6.4')).toEqual({ value: 6 });
    expect(parseField(lift.fields[1], '102.5 lb')).toEqual({ value: 102.5 });
    expect(parseField(lift.fields[1], 'lots').error).toMatch(/number/);
    expect(parseField(run.fields[0], '27:45')).toEqual({ value: 1665 });
    expect(parseField(run.fields[0], '30')).toEqual({ value: 1800 });
  });
});

describe('lookups and snacks', () => {
  const e1 = entry('ex_rdl', '2026-09-10', { sets: [{ reps: 6, weight: 95 }] });
  const e2 = entry('ex_rdl', '2026-09-17', { sets: [{ reps: 6, weight: 100 }] });
  const snackDone = entry('ex_plank', '2026-09-25', { sets: [{ duration: 60 }] }, { source: 'snack', snackId: 'sn_plank' });
  const d = library([put('entries', e1), put('entries', e2), put('entries', snackDone)]);

  it('finds the last entry on or before a date', () => {
    expect(lastEntry(d, 'ex_rdl', '2026-09-20')?.id).toBe(e2.id);
    expect(lastEntry(d, 'ex_rdl', '2026-09-12')?.id).toBe(e1.id);
    expect(lastEntry(d, 'ex_rdl', '2026-09-20', e2.id)?.id).toBe(e1.id);
    expect(lastEntry(d, 'ex_rdl', '2026-09-01')).toBeNull();
  });

  it('puts snacks that met their daily target at the back', () => {
    const q = snackQueue(d, '2026-09-25');
    expect(q.map((x) => x.snack.id)).not.toContain(undefined);
    expect(q[q.length - 1].snack.id).toBe('sn_plank');
    expect(q.find((x) => x.snack.id === 'sn_plank')!.stats).toMatchObject({ doneToday: 1, need: false });
  });
});

describe('cascading deletes', () => {
  const d = library([put('entries', entry('ex_plank', '2026-09-01', { sets: [{ duration: 60 }] }))]);
  it('deletes an exercise with its entries and snacks', () => {
    const ops = opsDeleteExercise(d, 'ex_plank');
    expect(ops.filter((o) => o.table === 'entries')).toHaveLength(1);
    expect(ops.filter((o) => o.table === 'snacks')).toHaveLength(1);
    expect(ops.at(-1)).toEqual({ table: 'exercises', type: 'delete', key: 'ex_plank' });
  });
  it('removes a tag from every exercise that uses it', () => {
    const ops = opsDeleteTag(d, 'tag_glutes');
    const updated = ops.filter((o) => o.type === 'put');
    expect(updated.length).toBeGreaterThan(2);
    for (const o of updated) expect((o as { value: { tagIds: string[] } }).value.tagIds).not.toContain('tag_glutes');
  });
  it('removes a body part from check-ins', () => {
    const withCheckin = library([put('checkins', { id: 'ci1', date: '2026-09-01', time: '07:00', moment: '', overall: 3, notes: '', pains: [{ bodyPartId: 'bp_rknee', score: 4 }, { bodyPartId: 'bp_lperoneal', score: 2 }], createdAt: 0 })]);
    const ops = opsDeleteBodyPart(withCheckin, 'bp_rknee');
    expect((ops[0] as { value: { pains: unknown[] } }).value.pains).toEqual([{ bodyPartId: 'bp_lperoneal', score: 2 }]);
  });
});
