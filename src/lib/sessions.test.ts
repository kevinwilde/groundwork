import { describe, expect, it } from 'vitest';
import { put } from '../data/ops';
import { STARTER_TYPES } from '../db/seed';
import type { ExerciseType, SavedSession } from '../db/types';
import { entry, library } from '../test/fixtures';
import { itemsFromDay, parsePlan, planText, prefill, sessionRuns, sessionStats } from './sessions';

const type = (id: string) => ({ ...STARTER_TYPES.find((t) => t.id === id)!, createdAt: 0 }) as ExerciseType;
const lift = type('type_lift');
const hold = type('type_hold');
const run = type('type_run');

const upper: SavedSession = {
  id: 'ses_test',
  name: 'Upper T',
  items: [
    { exerciseId: 'ex_bench', sets: [{ reps: 8, weight: 115 }] },
    { exerciseId: 'ex_pullup' },
    { exerciseId: 'ex_ohp', sets: [{ reps: 6, weight: 65 }] },
  ],
  notes: '',
  order: 0,
  createdAt: 0,
};

describe('prefill order', () => {
  // Bench logged in the session on the 10th; logged alone (heavier) on the 12th; a push-up snack on the 13th.
  const inSession = entry('ex_bench', '2026-09-10', { sets: [{ reps: 8, weight: 120 }] }, { sessionId: 'ses_test' });
  const pullInSession = entry('ex_pullup', '2026-09-10', { sets: [{ reps: 7 }] }, { sessionId: 'ses_test' });
  const benchAlone = entry('ex_bench', '2026-09-12', { sets: [{ reps: 5, weight: 135 }] });
  const ohpSnack = entry('ex_ohp', '2026-09-13', { sets: [{ reps: 20, weight: 20 }] }, { source: 'snack', snackId: 'x' });
  const d = library([put('sessions', upper), ...[inSession, pullInSession, benchAlone, ohpSnack].map((e) => put('entries', e))]);

  it('uses the last time this session was logged first', () => {
    const p = prefill(d, upper, upper.items[0], '2026-09-17');
    expect(p.source).toEqual({ kind: 'session', date: '2026-09-10' });
    expect(p.perf).toEqual({ sets: [{ reps: 8, weight: 120 }] });
  });
  it('ignores session runs after the date being logged', () => {
    const p = prefill(d, upper, upper.items[0], '2026-09-09');
    expect(p.source.kind).toBe('plan');
  });
  it('falls back to the plan, skipping snack entries', () => {
    const p = prefill(d, upper, upper.items[2], '2026-09-17');
    expect(p.source).toEqual({ kind: 'plan' });
    expect(p.perf).toEqual({ sets: [{ reps: 6, weight: 65 }] });
  });
  it("uses the exercise's latest entry when the session has never been logged", () => {
    const withoutSession = { ...upper, id: 'ses_other' };
    const p = prefill(d, withoutSession, upper.items[0], '2026-09-17');
    expect(p.source).toEqual({ kind: 'history', date: '2026-09-12' });
  });
  it('returns nothing when there is no history and no plan', () => {
    const p = prefill(library([]), upper, upper.items[1], '2026-09-17');
    expect(p).toEqual({ source: { kind: 'none' } });
  });
  it('copies values instead of sharing them', () => {
    const p = prefill(d, upper, upper.items[0], '2026-09-17');
    p.perf!.sets![0].weight = 999;
    expect(inSession.sets![0].weight).toBe(120);
  });
  it('counts runs by day', () => {
    expect(sessionRuns(d, 'ses_test').map((r) => [r.date, r.entries.length])).toEqual([['2026-09-10', 2]]);
    expect(sessionStats(d, 'ses_test')).toEqual({ count: 1, last: '2026-09-10' });
  });
});

describe('plan text', () => {
  it('formats and parses identical sets', () => {
    const sets = [{ reps: 8, weight: 135 }, { reps: 8, weight: 135 }, { reps: 8, weight: 135 }];
    expect(planText(lift, { sets })).toBe('3x8@135');
    expect(parsePlan(lift, '3x8@135').sets).toEqual(sets);
  });
  it('round-trips varied sets', () => {
    const sets = [{ reps: 6, weight: 100 }, { reps: 6, weight: 100 }, { reps: 5, weight: 110 }];
    const text = planText(lift, { sets });
    expect(text).toBe('2x6@100, 5@110');
    expect(parsePlan(lift, text).sets).toEqual(sets);
  });
  it('round-trips timed holds', () => {
    const text = planText(hold, { sets: [{ duration: 60 }, { duration: 60 }] });
    expect(text).toBe('2x60s');
    expect(parsePlan(hold, text).sets).toEqual([{ duration: 60 }, { duration: 60 }]);
  });
  it('treats empty text as no plan and reports bad text', () => {
    expect(parsePlan(lift, '  ')).toEqual({});
    expect(parsePlan(lift, '3x8@heavy').error).toMatch(/Couldn't read/);
    expect(parsePlan(run, '3x1').error).toMatch(/don't take/);
    expect(planText(run, { values: { duration: 1800 } })).toBe('');
  });
});

describe('save a day as a session', () => {
  it('keeps order, drops snacks and repeats, and keeps the sets', () => {
    const d = library(
      [
        entry('ex_squat', '2026-09-14', { sets: [{ reps: 5, weight: 165 }] }),
        entry('ex_plank', '2026-09-14', { sets: [{ duration: 60 }] }, { source: 'snack', snackId: 'sn_plank' }),
        entry('ex_rdl', '2026-09-14', { sets: [{ reps: 6, weight: 125 }] }),
        entry('ex_squat', '2026-09-14', { sets: [{ reps: 3, weight: 185 }] }),
        entry('ex_run', '2026-09-14', { values: { duration: 1800, distance: 3 } }),
      ].map((e) => put('entries', e)),
    );
    expect(itemsFromDay(d, '2026-09-14')).toEqual([
      { exerciseId: 'ex_squat', sets: [{ reps: 5, weight: 165 }] },
      { exerciseId: 'ex_rdl', sets: [{ reps: 6, weight: 125 }] },
      { exerciseId: 'ex_run' },
    ]);
  });
});
