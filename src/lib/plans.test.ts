import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterAll, describe, expect, it } from 'vitest';
import { applyOps, put, readAll, type Op } from '../data/ops';
import { buildData, type Data } from '../data/snapshot';
import { GroundworkDB } from '../db/db';
import { libraryOps, STARTER_TYPES } from '../db/seed';
import type { Entry, ExerciseType, Plan, PlannedSet, SavedSession } from '../db/types';
import { applyTo, entry, library, liftItem, plan } from '../test/fixtures';
import {
  blankPlan, bumpStep, bumpTargets, changedFields, currentSet, dayLabel, daysToCopy, diffFromTarget, itemComplete, lastDone, missedPlans, opsAddExercise, opsAddSet,
  opsDeleteEntry, opsDeletePlan, opsDuplicatePlan, opsFinish, opsMovePlan, opsRemoveSet, opsReopen, opsSavePlan, opsSetNotes, opsSetTargets, opsSkipExercise, opsSkipSet,
  opsTick, opsUntick, planExercises, planFromDay, planFromSession, planProgress, planShortfalls, planStatus, sameNamePlan, setLabel, setsSharingTarget, setsText, shortfall,
  upcomingPlans, visiblePlan, withTargets,
} from './plans';

const type = (id: string) => ({ ...STARTER_TYPES.find((t) => t.id === id)!, createdAt: 0 }) as ExerciseType;
const lift = type('type_lift');
const run = type('type_run');
const hold = type('type_hold');
const bw = type('type_bw');

const TODAY = '2026-10-09';
const set = (reps: number, weight: number) => ({ reps, weight });
const bench = (sets: PlannedSet[] = [{ target: set(5, 190) }, { target: set(5, 190) }, { target: set(5, 190) }]) => liftItem('pi_bench', 'ex_bench', sets);
const runItem = { key: 'pi_run', exerciseId: 'ex_run', target: { duration: 1500, distance: 3.1 }, notes: '' };

/** The value a put op writes, by table. */
const puts = <T>(ops: Op[], table: string) => ops.flatMap((o) => (o.type === 'put' && o.table === table ? [o.value as T] : []));
const planOf = (ops: Op[]) => puts<Plan>(ops, 'plans')[0];
const entryOf = (ops: Op[]) => puts<Entry>(ops, 'entries')[0];

describe('status, progress and the current set', () => {
  it('is planned until something is ticked, then missed once the day has passed', () => {
    expect(planStatus(plan('p', TODAY, [bench()]), TODAY)).toBe('planned');
    expect(planStatus(plan('p', '2026-10-12', [bench()]), TODAY)).toBe('planned');
    expect(planStatus(plan('p', '2026-10-07', [bench()]), TODAY)).toBe('missed');
    // Skipping alone isn't doing.
    expect(planStatus(plan('p', '2026-10-07', [bench([{ target: set(5, 190), skipped: true }, { target: set(5, 190) }])]), TODAY)).toBe('missed');
  });
  it('is in progress once a set is ticked, and done when finished or when every set is ticked or skipped', () => {
    const half = plan('p', '2026-10-07', [bench([{ target: set(5, 190), done: set(5, 190) }, { target: set(5, 190) }])]);
    expect(planStatus(half, TODAY)).toBe('in-progress');
    expect(planStatus({ ...half, finishedAt: 5 }, TODAY)).toBe('done');
    expect(planStatus(plan('p', TODAY, [bench([{ target: set(5, 190), done: set(5, 190) }, { target: set(5, 190), skipped: true }])]), TODAY)).toBe('done');
    expect(planStatus(plan('p', TODAY, [bench([{ target: set(5, 190), skipped: true }])]), TODAY)).toBe('done');
    expect(planStatus(plan('p', '2026-10-01', []), TODAY)).toBe('missed');
  });
  it('counts sets, with a single effort as one', () => {
    const p = plan('p', TODAY, [bench([{ target: set(5, 190), done: set(5, 190) }, { target: set(5, 190), skipped: true }, { target: set(5, 190) }]), { ...runItem, done: { duration: 1490 } }]);
    expect(planProgress(p)).toEqual({ done: 2, skipped: 1, total: 4 });
  });
  it('finds the first set that is neither ticked nor skipped', () => {
    const p = plan('p', TODAY, [bench([{ target: set(5, 190), done: set(5, 190) }, { target: set(5, 190), skipped: true }]), runItem]);
    expect(currentSet(p)).toEqual({ itemKey: 'pi_run', index: 0 });
    expect(currentSet(plan('p', TODAY, [bench()]))).toEqual({ itemKey: 'pi_bench', index: 0 });
    expect(currentSet(plan('p', TODAY, [{ ...runItem, skipped: true }]))).toBeNull();
    expect(itemComplete({ ...runItem, skipped: true })).toBe(true);
  });
  it('hides items whose exercise was deleted', () => {
    const d = library();
    const p = plan('p', TODAY, [bench(), liftItem('pi_gone', 'ex_gone', [{ target: set(1, 1) }])]);
    expect(planExercises(d, p).map((x) => x.ex.id)).toEqual(['ex_bench']);
    expect(planProgress(visiblePlan(d, p)).total).toBe(3);
  });
});

describe('building a plan', () => {
  const upper: SavedSession = {
    id: 'ses_t', name: 'Upper T', notes: 'Warm up first', order: 0, createdAt: 0,
    items: [{ exerciseId: 'ex_bench', sets: [{ reps: 8, weight: 115 }] }, { exerciseId: 'ex_pullup', sets: [{}, {}] }, { exerciseId: 'ex_ohp' }, { exerciseId: 'ex_run' }, { exerciseId: 'ex_gone' }],
  };

  it('takes targets from the last run of the session, then history, then the plan, with blank sets otherwise', () => {
    const d = library([
      put('sessions', upper),
      put('entries', entry('ex_bench', '2026-10-02', { sets: [set(5, 185), set(5, 185), set(5, 185)] }, { sessionId: 'ses_t' })),
      put('entries', entry('ex_run', '2026-10-05', { values: { duration: 1600, distance: 3, avgHr: 150 } })),
    ]);
    const p = planFromSession(d, d.sessions.get('ses_t')!, '2026-10-11', 7);
    expect(p).toMatchObject({ date: '2026-10-11', name: 'Upper T', sessionId: 'ses_t', notes: 'Warm up first', order: 1, finishedAt: null, createdAt: 7 });
    expect(p.items.map((i) => i.exerciseId)).toEqual(['ex_bench', 'ex_pullup', 'ex_ohp', 'ex_run']);
    expect(p.items[0].sets).toEqual([{ target: set(5, 185) }, { target: set(5, 185) }, { target: set(5, 185) }]);
    // No history and a plan with no values: as many blank sets as the session plans.
    expect(p.items[1].sets).toEqual([{ target: {} }, { target: {} }]);
    expect(p.items[2].sets).toEqual([{ target: {} }, { target: {} }, { target: {} }]);
    expect(p.items[3]).toMatchObject({ target: { duration: 1600, distance: 3, avgHr: 150 }, notes: '' });
    expect(p.items[3].sets).toBeUndefined();
    expect(new Set(p.items.map((i) => i.key)).size).toBe(4);
  });

  it('adds a second plan on the same day after the first', () => {
    const d = library([put('plans', plan('p1', '2026-10-11', [], { order: 1 }))]);
    expect(blankPlan(d, '2026-10-11').order).toBe(2);
    expect(blankPlan(d, '2026-10-12')).toMatchObject({ order: 1, name: 'Workout', items: [], sessionId: null });
  });

  it('copies a day as targets, without snacks', () => {
    const d = library(
      [
        entry('ex_squat', '2026-10-06', { sets: [set(5, 165), set(5, 165)] }),
        entry('ex_plank', '2026-10-06', { sets: [{ duration: 60 }] }, { source: 'snack', snackId: 'sn_plank' }),
        entry('ex_run', '2026-10-06', { values: { duration: 1800, distance: 3 } }),
      ].map((e) => put('entries', e)),
    );
    const p = planFromDay(d, '2026-10-06', '2026-10-13');
    expect(p).toMatchObject({ date: '2026-10-13', name: 'Workout', sessionId: null });
    expect(p.items.map((i) => [i.exerciseId, i.sets ?? i.target])).toEqual([
      ['ex_squat', [{ target: set(5, 165) }, { target: set(5, 165) }]],
      ['ex_run', { duration: 1800, distance: 3 }],
    ]);
    expect(daysToCopy(d, TODAY)).toEqual(['2026-10-06']);
    expect(daysToCopy(d, '2026-10-06')).toEqual([]);
  });

  it('warns about a second plan with the same name on a day', () => {
    const d = library([put('plans', plan('p1', '2026-10-11', [], { name: 'Upper A' }))]);
    expect(sameNamePlan(d, '2026-10-11', ' upper a ')?.id).toBe('p1');
    expect(sameNamePlan(d, '2026-10-11', 'Upper A', 'p1')).toBeUndefined();
    expect(sameNamePlan(d, '2026-10-12', 'Upper A')).toBeUndefined();
  });
});

describe('targets', () => {
  it('bumps weights by the unit step', () => {
    expect(bumpStep(lift)).toBe(5);
    expect(bumpStep({ ...lift, fields: [lift.fields[0], { ...lift.fields[1], unit: 'kg' }] })).toBe(2.5);
    expect(bumpStep(bw)).toBeNull();
    expect(bumpStep(run)).toBeNull();
    expect(bumpTargets(lift, [set(5, 190), { reps: 5 }, set(3, 102.5)], 5)).toEqual([set(5, 195), { reps: 5 }, set(3, 107.5)]);
    expect(bumpTargets(lift, [set(5, 0.1)], 0.2)).toEqual([set(5, 0.3)]);
    expect(bumpTargets(bw, [{ reps: 5 }], 5)).toEqual([{ reps: 5 }]);
  });
  it('finds the fields that differ from the target', () => {
    expect(diffFromTarget({ target: set(5, 115), done: set(4, 115) })).toEqual(['reps']);
    expect(diffFromTarget({ target: set(5, 115), done: set(5, 115) })).toEqual([]);
    expect(diffFromTarget({ target: set(5, 115) })).toEqual([]);
    expect(diffFromTarget({ target: {}, done: set(5, 115) })).toEqual(['reps', 'weight']);
    expect(changedFields(set(5, 115), set(5, 105))).toEqual({ weight: 105 });
  });
  it('labels sets for rows', () => {
    expect(setLabel(lift, set(5, 190))).toBe('5 × 190 lb');
    expect(setLabel(bw, { reps: 8 })).toBe('8 reps');
    expect(setLabel(bw, { reps: 1 })).toBe('1 rep');
    expect(setLabel(hold, { duration: 60 })).toBe('60 s');
    expect(setLabel(lift, { weight: 95 })).toBe('95 lb');
    expect(setLabel(lift, {})).toBe('');
    expect(setsText([2, 3])).toBe('Sets 3–4');
    expect(setsText([2])).toBe('Set 3');
    expect(setsText([2, 4, 5])).toBe('Sets 3, 5 and 6');
  });
  it('labels days relative to today', () => {
    expect(dayLabel(TODAY, TODAY)).toBe('Today');
    expect(dayLabel('2026-10-10', TODAY)).toBe('Tomorrow');
    expect(dayLabel('2026-10-08', TODAY)).toBe('Yesterday');
    expect(dayLabel('2026-10-10', '2026-10-08')).toBe('Sat');
    expect(dayLabel('2026-10-20', TODAY)).toBe('Tue, Oct 20');
  });
});

describe('ticking', () => {
  const p0 = plan('pl_1', TODAY, [bench(), runItem], { sessionId: 'ses_upper_a' });
  const d0 = library([put('plans', p0)]);

  it('logs the target on the first tick, creating the entry in the same call', () => {
    const ops = opsTick(d0, p0, 'pi_bench', 0, undefined, 50);
    expect(ops.map((o) => `${o.type} ${o.table}`)).toEqual(['put plans', 'put entries']);
    const p = planOf(ops);
    const e = entryOf(ops);
    expect(p.items[0].sets![0]).toEqual({ target: set(5, 190), done: set(5, 190) });
    expect(p.items[0].entryId).toBe(e.id);
    expect(e).toEqual({ id: e.id, exerciseId: 'ex_bench', date: TODAY, notes: '', source: 'log', sessionId: 'ses_upper_a', planId: 'pl_1', createdAt: 50, sets: [set(5, 190)] });
    expect(e.id).toMatch(/^en_/);
    // The done values are a copy, not the target itself.
    expect(p.items[0].sets![0].done).not.toBe(p0.items[0].sets![0].target);
  });

  it('rewrites the same entry from the ticked sets in plan order, without skipped or unticked ones', () => {
    let d = applyTo(d0, opsTick(d0, p0, 'pi_bench', 2, set(4, 185), 50));
    const first = d.plans.get('pl_1')!.items[0].entryId!;
    d = applyTo(d, opsSkipSet(d, d.plans.get('pl_1')!, 'pi_bench', 1, 60));
    const ops = opsTick(d, d.plans.get('pl_1')!, 'pi_bench', 0, undefined, 70);
    const e = entryOf(ops);
    expect(e.id).toBe(first);
    expect(e.createdAt).toBe(50);
    expect(e.sets).toEqual([set(5, 190), set(4, 185)]);
  });

  it("doesn't log a blank target without values", () => {
    const p = plan('pl_2', TODAY, [liftItem('pi_x', 'ex_bench', [{ target: {} }])]);
    expect(opsTick(library(), p, 'pi_x', 0)).toEqual([]);
    expect(entryOf(opsTick(library(), p, 'pi_x', 0, { reps: 5 })).sets).toEqual([{ reps: 5 }]);
    expect(opsTick(library(), p, 'nope', 0)).toEqual([]);
  });

  it('logs a single effort as values', () => {
    const ops = opsTick(d0, p0, 'pi_run', 0, { duration: 1490, distance: 3.1 });
    expect(planOf(ops).items[1]).toMatchObject({ target: { duration: 1500, distance: 3.1 }, done: { duration: 1490, distance: 3.1 } });
    expect(entryOf(ops)).toMatchObject({ exerciseId: 'ex_run', values: { duration: 1490, distance: 3.1 } });
    expect(entryOf(ops).sets).toBeUndefined();
  });

  it('a tick clears a skip', () => {
    const p = plan('pl_3', TODAY, [bench([{ target: set(5, 190), skipped: true }])]);
    expect(planOf(opsTick(library(), p, 'pi_bench', 0)).items[0].sets![0]).toEqual({ target: set(5, 190), done: set(5, 190) });
  });

  it('unticks, and deletes the entry once nothing is ticked', () => {
    let d = applyTo(d0, opsTick(d0, p0, 'pi_bench', 0));
    d = applyTo(d, opsTick(d, d.plans.get('pl_1')!, 'pi_bench', 1));
    const id = d.plans.get('pl_1')!.items[0].entryId!;
    const once = opsUntick(d, d.plans.get('pl_1')!, 'pi_bench', 0);
    expect(entryOf(once).sets).toEqual([set(5, 190)]);
    d = applyTo(d, once);
    const twice = opsUntick(d, d.plans.get('pl_1')!, 'pi_bench', 1);
    expect(twice.map((o) => `${o.type} ${o.table}`)).toEqual(['put plans', 'delete entries']);
    expect(twice[1]).toEqual({ table: 'entries', type: 'delete', key: id });
    expect(planOf(twice).items[0]).toMatchObject({ entryId: null });
    expect(planOf(twice).items[0].sets!.every((s) => !('done' in s))).toBe(true);
    expect(opsUntick(d, p0, 'pi_bench', 2)).toEqual([]);
  });

  it('copies the exercise note into the entry', () => {
    const d = applyTo(d0, opsTick(d0, p0, 'pi_bench', 0));
    const ops = opsSetNotes(d, d.plans.get('pl_1')!, 'pi_bench', 'Felt quick');
    expect(planOf(ops).items[0].notes).toBe('Felt quick');
    expect(entryOf(ops).notes).toBe('Felt quick');
    // Before any tick there is no entry to update.
    expect(opsSetNotes(d0, p0, 'pi_run', 'Easy').map((o) => o.table)).toEqual(['plans']);
  });
});

describe('changing the plan during a workout', () => {
  it('uses a changed value for later unticked sets that shared the old target', () => {
    const item = bench([{ target: set(5, 115), done: set(5, 115) }, { target: set(5, 115), done: set(5, 105) }, { target: set(5, 115) }, { target: set(5, 115) }, { target: set(5, 95) }]);
    const p = plan('pl', TODAY, [item]);
    expect(setsSharingTarget(item, 1, { weight: 105 })).toEqual([2, 3]);
    const sets = planOf(opsSetTargets(p, 'pi_bench', 1, { weight: 105 })).items[0].sets!;
    expect(sets.map((s) => s.target.weight)).toEqual([115, 115, 105, 105, 95]);
    expect(sets[1].done).toEqual(set(5, 105));
    expect(opsSetTargets(p, 'pi_bench', 4, { weight: 105 })).toEqual([]);
  });

  it('fills blank later targets from a logged set', () => {
    const item = liftItem('pi_x', 'ex_bench', [{ target: {}, done: set(5, 100) }, { target: {} }, { target: {} }]);
    expect(setsSharingTarget(item, 0, set(5, 100))).toEqual([1, 2]);
    expect(planOf(opsSetTargets(plan('pl', TODAY, [item]), 'pi_x', 0, set(5, 100))).items[0].sets!.map((s) => s.target)).toEqual([{}, set(5, 100), set(5, 100)]);
  });

  it('adds a set copying the last target, and removes only added sets', () => {
    const p = plan('pl', TODAY, [bench([{ target: set(5, 190) }, { target: set(3, 200) }])]);
    const added = planOf(opsAddSet(p, 'pi_bench'));
    expect(added.items[0].sets![2]).toEqual({ target: set(3, 200), added: true });
    expect(opsAddSet(plan('pl', TODAY, [runItem]), 'pi_run')).toEqual([]);
    const d = library([put('plans', added)]);
    expect(opsRemoveSet(d, added, 'pi_bench', 0)).toEqual([]);
    expect(planOf(opsRemoveSet(d, added, 'pi_bench', 2)).items[0].sets).toHaveLength(2);
  });

  it('removing a ticked added set rewrites the entry', () => {
    const p = plan('pl', TODAY, [bench([{ target: set(5, 190), done: set(5, 190) }, { target: set(5, 190), done: set(5, 190), added: true }])]);
    const d = applyTo(library(), opsTick(library(), p, 'pi_bench', 0));
    const ops = opsRemoveSet(d, d.plans.get('pl')!, 'pi_bench', 1);
    expect(entryOf(ops).sets).toEqual([set(5, 190)]);
  });

  it('skips a set, and skips the rest of an exercise without touching ticked sets or the entry', () => {
    const p = plan('pl', TODAY, [bench([{ target: set(5, 190), done: set(5, 190) }, { target: set(5, 190) }, { target: set(5, 190) }]), runItem]);
    const skipped = opsSkipExercise(library(), p, 'pi_bench');
    expect(skipped.map((o) => o.table)).toEqual(['plans']);
    expect(planOf(skipped).items[0].sets!.map((s) => [!!s.done, !!s.skipped])).toEqual([[true, false], [false, true], [false, true]]);
    expect(planOf(opsSkipExercise(library(), p, 'pi_run')).items[1]).toMatchObject({ skipped: true });
    expect(planOf(opsSkipSet(library(), p, 'pi_bench', 2)).items[0].sets![2]).toEqual({ target: set(5, 190), skipped: true });
  });

  it('adds an exercise with targets from the last time', () => {
    const d = library([put('entries', entry('ex_row', '2026-10-01', { sets: [set(8, 95), set(8, 95)] }))]);
    const p = plan('pl', TODAY, []);
    expect(planOf(opsAddExercise(d, p, 'ex_row')).items[0]).toMatchObject({ exerciseId: 'ex_row', sets: [{ target: set(8, 95) }, { target: set(8, 95) }], notes: '' });
    expect(planOf(opsAddExercise(d, p, 'ex_ohp')).items[0].sets).toHaveLength(3);
    expect(opsAddExercise(d, p, 'ex_gone')).toEqual([]);
  });
});

describe('finishing, moving, duplicating and deleting', () => {
  const ticked = plan('pl', '2026-10-07', [bench([{ target: set(5, 190), done: set(5, 190) }, { target: set(5, 190) }]), runItem], { sessionId: 'ses_upper_a', notes: 'Go', order: 1 });
  const base = library([put('plans', plan('pl_today', TODAY, [], { order: 3 }))]);
  const withEntry = applyTo(base, opsTick(base, ticked, 'pi_bench', 0));
  const p = withEntry.plans.get('pl')!;

  it('finishes and reopens', () => {
    expect(planOf(opsFinish(p, 99)).finishedAt).toBe(99);
    expect(planOf(opsReopen({ ...p, finishedAt: 99 })).finishedAt).toBeNull();
  });

  it('moves a plan after the day’s plans, with its entries', () => {
    const ops = opsMovePlan(withEntry, p, TODAY);
    expect(planOf(ops)).toMatchObject({ id: 'pl', date: TODAY, order: 4 });
    expect(entryOf(ops)).toMatchObject({ id: p.items[0].entryId, date: TODAY, sets: [set(5, 190)] });
    expect(opsMovePlan(withEntry, p, p.date)).toEqual([]);
  });

  it('duplicates targets only', () => {
    const copy = planOf(opsDuplicatePlan(withEntry, { ...p, finishedAt: 5, items: [...p.items, liftItem('pi_gone', 'ex_gone', [])] }, '2026-10-16', 9));
    expect(copy).toMatchObject({ date: '2026-10-16', name: 'Upper A', sessionId: 'ses_upper_a', notes: 'Go', order: 1, finishedAt: null, createdAt: 9 });
    expect(copy.id).not.toBe('pl');
    expect(copy.items.map((i) => i.sets ?? i.target)).toEqual([[{ target: set(5, 190) }, { target: set(5, 190) }], { duration: 1500, distance: 3.1 }]);
    expect(copy.items.every((i) => !i.entryId && !i.done && !i.skipped)).toBe(true);
  });

  it('deletes a plan and keeps its entries', () => {
    expect(opsDeletePlan(p)).toEqual([{ table: 'plans', type: 'delete', key: 'pl' }]);
  });

  it('deleting a plan’s entry clears that exercise’s ticks and entryId', () => {
    const e = withEntry.raw.entries.find((x) => x.planId === 'pl')!;
    const ops = opsDeleteEntry(withEntry, e);
    expect(ops[0]).toEqual({ table: 'entries', type: 'delete', key: e.id });
    const item = planOf(ops).items[0];
    expect(item).toMatchObject({ entryId: null });
    expect(item.sets!.some((s) => s.done)).toBe(false);
    expect(planOf(ops).items[1]).toBe(p.items[1]);
    const other = entry('ex_rdl', TODAY, { sets: [set(6, 95)] });
    expect(opsDeleteEntry(withEntry, other)).toEqual([{ table: 'entries', type: 'delete', key: other.id }]);
  });

  it('lists missed and upcoming plans', () => {
    const d = library([
      put('plans', plan('old', '2026-09-20', [bench()])),
      put('plans', plan('missed', '2026-10-07', [bench()])),
      put('plans', plan('started', '2026-10-08', [bench([{ target: set(5, 190), done: set(5, 190) }])])),
      put('plans', plan('later', '2026-10-30', [bench()])),
      put('plans', plan('soon', '2026-10-10', [bench()])),
    ]);
    expect(missedPlans(d, TODAY).map((x) => x.id)).toEqual(['missed']);
    expect(upcomingPlans(d, TODAY).map((x) => x.id)).toEqual(['soon', 'later']);
    expect(upcomingPlans(d, TODAY, '2026-10-16').map((x) => x.id)).toEqual(['soon']);
  });
});

describe('saving from the editor', () => {
  it('keeps what was done by position when targets change, never losing a tick', () => {
    const item = bench([{ target: set(5, 190), done: set(5, 185) }, { target: set(5, 190), skipped: true }, { target: set(5, 190), done: set(5, 190) }]);
    expect(withTargets(item, { sets: [set(5, 200), set(5, 200)] }).sets).toEqual([{ target: set(5, 200), done: set(5, 185) }, { target: set(5, 200), skipped: true }, { target: set(5, 190), done: set(5, 190) }]);
    expect(withTargets(runItem, { values: { duration: 1400, distance: '' as unknown as number } })).toEqual({ ...runItem, target: { duration: 1400 } });
  });

  it('rewrites entries only for exercises whose log changed, and moves them with the date', () => {
    const p0 = plan('pl', TODAY, [bench(), runItem]);
    let d = library([put('plans', p0)]);
    d = applyTo(d, opsTick(d, p0, 'pi_bench', 0));
    const p = d.plans.get('pl')!;
    expect(opsSavePlan(d, { ...p, name: 'Renamed' }, p).map((o) => o.table)).toEqual(['plans']);
    const moved = opsSavePlan(d, { ...p, date: '2026-10-10' }, p);
    expect(entryOf(moved)).toMatchObject({ id: p.items[0].entryId, date: '2026-10-10' });
    const fresh = blankPlan(d, TODAY);
    expect(opsSavePlan(d, fresh).map((o) => o.table)).toEqual(['plans']);
  });
});

describe('the finish summary', () => {
  it('names exercises that missed their target', () => {
    expect(shortfall(lift, bench([{ target: set(5, 65), done: set(5, 65) }, { target: set(5, 65), done: set(5, 65) }, { target: set(5, 65), done: set(4, 65) }]))).toBe('14 of 15 reps');
    expect(shortfall(lift, bench([{ target: set(5, 65), done: set(5, 65) }]))).toBeNull();
    expect(shortfall(lift, bench([{ target: { weight: 65 }, done: { weight: 65 } }, { target: { weight: 65 } }]))).toBe('1 of 2 sets');
    expect(shortfall(hold, liftItem('k', 'ex_plank', [{ target: { duration: 60 }, done: { duration: 45 } }, { target: { duration: 60 }, skipped: true }]))).toBe('45 s of 2:00');
    expect(shortfall(run, runItem)).toBe('not done');
    expect(shortfall(run, { ...runItem, done: { duration: 1400, distance: 2.5 } })).toBe('2.5 of 3.1 mi');
    expect(shortfall(run, { ...runItem, done: { duration: 1600, distance: 3.1 } })).toBeNull();
    const d = library();
    expect(planShortfalls(d, plan('p', TODAY, [bench([{ target: set(5, 65) }]), runItem])).map((x) => `${x.ex.name}: ${x.text}`)).toEqual(['Bench Press: 0 of 5 reps', 'Run: not done']);
  });

  it('finds the last time, skipping snacks and this plan', () => {
    const own = entry('ex_bench', TODAY, { sets: [set(5, 190)] }, { planId: 'pl' });
    const before = entry('ex_bench', '2026-10-02', { sets: [set(5, 185)] });
    const snack = entry('ex_bench', '2026-10-05', { sets: [set(10, 45)] }, { source: 'snack', snackId: 's' });
    const d = library([own, before, snack].map((e) => put('entries', e)));
    expect(lastDone(d, 'ex_bench', TODAY, 'pl')?.id).toBe(before.id);
    expect(lastDone(d, 'ex_bench', TODAY)?.id).toBe(own.id);
    expect(lastDone(d, 'ex_bench', '2026-10-01')).toBeNull();
  });
});

describe('in IndexedDB', () => {
  const names: string[] = [];
  afterAll(async () => {
    for (const n of names) await Dexie.delete(n);
  });

  async function setup(): Promise<{ db: GroundworkDB; d: () => Promise<Data> }> {
    const db = new GroundworkDB(`plans-${names.length}`);
    names.push(db.name);
    await applyOps(libraryOps(), { db, mode: 'verbatim' });
    await applyOps([put('plans', plan('pl', TODAY, [bench()]))], { db });
    return { db, d: async () => buildData(await readAll(db)) };
  }

  it('saves a tick and its entry together, and survives a reload', async () => {
    const { db, d } = await setup();
    let data = await d();
    await applyOps(opsTick(data, data.plans.get('pl')!, 'pi_bench', 0), { db });
    data = await d();
    await applyOps(opsTick(data, data.plans.get('pl')!, 'pi_bench', 1, set(4, 190)), { db });
    data = await d();
    const p = data.plans.get('pl')!;
    expect(planProgress(p)).toEqual({ done: 2, skipped: 0, total: 3 });
    expect(data.raw.entries).toHaveLength(1);
    expect(data.raw.entries[0]).toMatchObject({ id: p.items[0].entryId, planId: 'pl', sets: [set(5, 190), set(4, 190)] });
  });

  it("undoing a deleted plan entry restores the entry and the plan's ticks", async () => {
    const { db, d } = await setup();
    let data = await d();
    await applyOps(opsTick(data, data.plans.get('pl')!, 'pi_bench', 0), { db });
    data = await d();
    const before = data.plans.get('pl')!;
    const inverse = await applyOps(opsDeleteEntry(data, data.raw.entries[0]), { db });
    data = await d();
    expect(data.raw.entries).toHaveLength(0);
    expect(planProgress(data.plans.get('pl')!).done).toBe(0);
    await applyOps(inverse, { db });
    data = await d();
    expect(data.raw.entries).toHaveLength(1);
    expect(data.plans.get('pl')!.items).toEqual(before.items);
  });
});
