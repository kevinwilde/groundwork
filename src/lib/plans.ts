import { del, put, type Op } from '../data/ops';
import type { Data } from '../data/snapshot';
import type { Entry, Exercise, ExerciseType, Performance, Plan, PlanItem, PlannedSet, SavedSession, SetValues } from '../db/types';
import { canonical } from '../sync/canonical';
import { addDays, daysBetween, fmtDate, fmtWeekday, type DateStr } from './dates';
import { fmtDuration, fmtNum } from './format';
import { uid } from './ids';
import { entriesFor, entriesOn, fieldText, hasValue, nextOrder, typeOf } from './model';
import { itemsFromDay, prefill, sessionExercises } from './sessions';

/**
 * Workout plans: dated workouts planned ahead, then followed set by set. Ticking a set logs it at once:
 * every write below returns the plan and that exercise's entry together, for one applyOps() call.
 * Status is derived from the plan, never stored. Pure, apart from new ids and the time.
 */

export type PlanStatus = 'planned' | 'missed' | 'in-progress' | 'done';

export const STATUS_LABEL: Record<PlanStatus, string> = { planned: 'Planned', missed: 'Missed', 'in-progress': 'In progress', done: 'Done' };

/** Where a set is: the item's key and the set's index (0 for a single effort). */
export interface SetRef {
  itemKey: string;
  index: number;
}

// ---------- reading a plan ----------
/** Set-based items have `sets`; single-effort items (runs) have one `target`. */
export const isSetItem = (item: PlanItem): item is PlanItem & { sets: PlannedSet[] } => Array.isArray(item.sets);

/** The item's planned sets, or its single effort as one set. */
export function slotsOf(item: PlanItem): PlannedSet[] {
  if (isSetItem(item)) return item.sets;
  const slot: PlannedSet = { target: item.target ?? {} };
  if (item.done) slot.done = item.done;
  if (item.skipped) slot.skipped = true;
  return [slot];
}

export const isTicked = (s: PlannedSet) => !!s.done;
export const isOpen = (s: PlannedSet) => !s.done && !s.skipped;
/** Every set ticked or skipped. */
export const itemComplete = (item: PlanItem) => slotsOf(item).every((s) => !isOpen(s));

/** The plan's items whose exercise still exists, with the exercise. Items for deleted exercises are hidden. */
export function planExercises(d: Data, plan: Plan): { item: PlanItem; ex: Exercise }[] {
  return plan.items.map((item) => ({ item, ex: d.exercises.get(item.exerciseId) })).filter((x): x is { item: PlanItem; ex: Exercise } => !!x.ex);
}

/** The plan without items for deleted exercises, for status and progress. */
export const visiblePlan = (d: Data, plan: Plan): Plan => (plan.items.every((i) => d.exercises.has(i.exerciseId)) ? plan : { ...plan, items: plan.items.filter((i) => d.exercises.has(i.exerciseId)) });

/** Sets ticked, skipped and planned in all. A single effort counts as one set. */
export function planProgress(plan: Plan): { done: number; skipped: number; total: number } {
  let done = 0;
  let skipped = 0;
  let total = 0;
  for (const item of plan.items) {
    for (const s of slotsOf(item)) {
      total++;
      if (s.done) done++;
      else if (s.skipped) skipped++;
    }
  }
  return { done, skipped, total };
}

/**
 * Done: finished, or every set ticked or skipped. In progress: some sets ticked. Missed: nothing
 * ticked and the date has passed. Planned: nothing ticked yet, today or later.
 */
export function planStatus(plan: Plan, today: DateStr): PlanStatus {
  const p = planProgress(plan);
  if (plan.finishedAt || (p.total > 0 && p.done + p.skipped === p.total)) return 'done';
  if (p.done > 0) return 'in-progress';
  return plan.date < today ? 'missed' : 'planned';
}

/** The first set that is neither ticked nor skipped. */
export function currentSet(plan: Plan): SetRef | null {
  for (const item of plan.items) {
    const index = slotsOf(item).findIndex(isOpen);
    if (index >= 0) return { itemKey: item.key, index };
  }
  return null;
}

/** The fields whose done value differs from the target: the UI strikes the target through. */
export function diffFromTarget(set: PlannedSet): string[] {
  if (!set.done) return [];
  const keys = [...new Set([...Object.keys(set.target), ...Object.keys(set.done)])];
  return keys.filter((k) => !sameValue(set.target[k], set.done![k]));
}

const sameValue = (a: unknown, b: unknown) => (!hasValue(a) && !hasValue(b)) || a === b;

/** Only the fields that have a value, copied. */
function clean(v: SetValues): SetValues {
  const out: SetValues = {};
  for (const [k, x] of Object.entries(v)) if (hasValue(x)) out[k] = x;
  return out;
}

/** A plan's sets as text for a row: "5 × 190 lb", "8 reps", "60 s". */
export function setLabel(type: ExerciseType, v: SetValues): string {
  const fields = type.fields.filter((f) => f.kind !== 'text' && hasValue(v[f.key]));
  if (!fields.length) return '';
  const [first, ...rest] = fields;
  if (first.key === 'reps') {
    const reps = fieldText(first, v.reps);
    return rest.length ? `${reps} × ${rest.map((f) => fieldText(f, v[f.key])).join(' · ')}` : `${reps} ${Number(v.reps) === 1 ? 'rep' : 'reps'}`;
  }
  return fields.map((f) => fieldText(f, v[f.key])).join(' · ');
}

/** "Tomorrow", "Sat" within a week, otherwise "Sat, Oct 17". */
export function dayLabel(date: DateStr, today: DateStr): string {
  const n = daysBetween(today, date);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  if (Math.abs(n) < 7) return fmtWeekday(date);
  return fmtDate(date);
}

/** The latest time an exercise was done, on or before `date`: no snacks, nothing from `excludePlanId`. */
export function lastDone(d: Data, exerciseId: string, date: DateStr, excludePlanId?: string): Entry | null {
  return entriesFor(d, exerciseId).find((e) => e.date <= date && e.source !== 'snack' && (!excludePlanId || e.planId !== excludePlanId)) ?? null;
}

/** Another plan with the same name on the same day, for the editor's warning. */
export function sameNamePlan(d: Data, date: DateStr, name: string, excludeId?: string): Plan | undefined {
  const n = name.trim().toLowerCase();
  return (d.plansByDate.get(date) ?? []).find((p) => p.id !== excludeId && p.name.trim().toLowerCase() === n);
}

// ---------- targets ----------
/** The +5 lb chip's step, from the weight field's unit: 2.5 for kg, else 5. Null without a weight field. */
export function bumpStep(type: ExerciseType): number | null {
  if (type.mode !== 'sets') return null;
  const w = type.fields.find((f) => f.key === 'weight');
  if (!w) return null;
  return /^kgs?$/i.test(w.unit ?? '') ? 2.5 : 5;
}

/** Every set's weight up by `step`. Sets without a weight are left alone. */
export function bumpTargets(type: ExerciseType, sets: SetValues[], step: number): SetValues[] {
  if (!type.fields.some((f) => f.key === 'weight')) return sets.map((s) => ({ ...s }));
  return sets.map((s) => (typeof s.weight === 'number' && hasValue(s.weight) ? { ...s, weight: Math.round((s.weight + step) * 100) / 100 } : { ...s }));
}

/**
 * Later sets that aren't ticked or skipped and share set `fromIndex`'s target for at least one field
 * in `patch`: "Set 2 changed to 105 lb. Use it for sets 3–4 too?"
 */
export function setsSharingTarget(item: PlanItem, fromIndex: number, patch: SetValues): number[] {
  if (!isSetItem(item) || !item.sets[fromIndex]) return [];
  const from = item.sets[fromIndex].target;
  const keys = Object.keys(patch);
  const out: number[] = [];
  item.sets.forEach((s, i) => {
    if (i > fromIndex && isOpen(s) && keys.some((k) => sameValue(s.target[k], from[k]) && !sameValue(s.target[k], patch[k]))) out.push(i);
  });
  return out;
}

/** The fields of what was done that differ from the target, as a patch for later sets. */
export function changedFields(target: SetValues, done: SetValues): SetValues {
  const out: SetValues = {};
  for (const [k, v] of Object.entries(done)) if (hasValue(v) && !sameValue(target[k], v)) out[k] = v;
  return out;
}

/** "Sets 3–4", "Set 3", "Sets 3, 5 and 6" (1-based). */
export function setsText(indices: number[]): string {
  const n = indices.map((i) => i + 1);
  if (n.length === 1) return `Set ${n[0]}`;
  const contiguous = n.every((x, i) => i === 0 || x === n[i - 1] + 1);
  if (contiguous) return `Sets ${n[0]}–${n[n.length - 1]}`;
  return `Sets ${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
}

/**
 * The item with targets from the plan editor, keeping what was done by position: set i keeps its
 * done, skipped and added flags. Ticked sets beyond the new count are kept, so editing never loses a tick.
 */
export function withTargets(item: PlanItem, perf: Performance): PlanItem {
  const { sets: _s, target: _t, done: _d, skipped: _k, ...rest } = item;
  if (Array.isArray(perf.sets)) {
    const old = item.sets ?? [];
    const sets: PlannedSet[] = perf.sets.map((target, i) => ({ ...(old[i] ?? {}), target: clean(target) }));
    for (let i = perf.sets.length; i < old.length; i++) if (old[i].done) sets.push(old[i]);
    return { ...rest, sets };
  }
  const out: PlanItem = { ...rest, target: clean(perf.values ?? {}) };
  if (item.done) out.done = item.done;
  if (item.skipped) out.skipped = true;
  return out;
}

// ---------- building plans ----------
/**
 * A plan item for an exercise. Targets come from `perf`; without them, a set-based exercise gets blank
 * sets: `count`, else as many as last time, else 3.
 */
export function itemFor(d: Data, exerciseId: string, date: DateStr, perf?: Performance, count?: number): PlanItem {
  const type = typeOf(d, d.exercises.get(exerciseId));
  const key = uid('pi');
  if (type.mode !== 'sets') return { key, exerciseId, target: clean(perf?.values ?? {}), notes: '' };
  if (perf?.sets?.length) return { key, exerciseId, sets: perf.sets.map((s) => ({ target: clean(s) })), notes: '' };
  const n = count || lastDone(d, exerciseId, date)?.sets?.length || 3;
  return { key, exerciseId, sets: Array.from({ length: n }, () => ({ target: {} })), notes: '' };
}

function newPlan(d: Data, date: DateStr, fields: Pick<Plan, 'name' | 'items'> & Partial<Pick<Plan, 'sessionId' | 'notes'>>, now: number): Plan {
  return {
    id: uid('pl'),
    date,
    name: fields.name,
    sessionId: fields.sessionId ?? null,
    items: fields.items,
    notes: fields.notes ?? '',
    order: nextOrder(d.plansByDate.get(date) ?? []),
    finishedAt: null,
    createdAt: now,
  };
}

/** A plan from a saved session, with the same prefill as Log all: the last run, then history, then the session's plan. */
export function planFromSession(d: Data, session: SavedSession, date: DateStr, now = Date.now()): Plan {
  const items = sessionExercises(d, session).map(({ item, ex }) => itemFor(d, ex.id, date, prefill(d, session, item, date).perf, item.sets?.length));
  return newPlan(d, date, { name: session.name, sessionId: session.id, notes: session.notes, items }, now);
}

/** A plan that repeats what was logged on `date` (snacks left out), for `targetDate`. */
export function planFromDay(d: Data, date: DateStr, targetDate: DateStr, now = Date.now()): Plan {
  const day = entriesOn(d, date).filter((e) => e.source !== 'snack');
  const items = itemsFromDay(d, date).map((it) => itemFor(d, it.exerciseId, targetDate, it.sets ? it : { values: day.find((e) => e.exerciseId === it.exerciseId)?.values }));
  return newPlan(d, targetDate, { name: 'Workout', items }, now);
}

export const blankPlan = (d: Data, date: DateStr, now = Date.now()): Plan => newPlan(d, date, { name: 'Workout', items: [] }, now);

/** Past days with something other than snacks logged, newest first: the "Copy a day" choices. */
export function daysToCopy(d: Data, today: DateStr, limit = 120): DateStr[] {
  return [...d.entriesByDate]
    .filter(([date, list]) => date < today && list.some((e) => e.source !== 'snack' && d.exercises.has(e.exerciseId)))
    .map(([date]) => date)
    .sort()
    .reverse()
    .slice(0, limit);
}

// ---------- writes ----------
const entryOf = (d: Data, item: PlanItem): Entry | undefined => (item.entryId ? entriesFor(d, item.exerciseId).find((e) => e.id === item.entryId) : undefined);
const tickedDone = (item: PlanItem) => slotsOf(item).flatMap((s) => (s.done ? [s.done] : []));

/**
 * Bring an item's entry in line with its ticked sets, in plan order: rewrite it, create it on the first
 * tick, or delete it once nothing is ticked. Returns the item with its `entryId`.
 */
function syncEntry(d: Data, plan: Plan, item: PlanItem, now: number): { item: PlanItem; ops: Op[] } {
  const done = tickedDone(item);
  if (!done.length) return item.entryId ? { item: { ...item, entryId: null }, ops: [del('entries', item.entryId)] } : { item, ops: [] };
  const id = item.entryId ?? uid('en');
  const existing = entryOf(d, item);
  const entry: Entry = {
    ...(existing ?? { createdAt: now }),
    id,
    exerciseId: item.exerciseId,
    date: plan.date,
    notes: item.notes,
    source: 'log',
    sessionId: plan.sessionId ?? null,
    planId: plan.id,
  };
  delete entry.sets;
  delete entry.values;
  if (isSetItem(item)) entry.sets = done.map((v) => ({ ...v }));
  else entry.values = { ...done[0] };
  return { item: { ...item, entryId: id }, ops: [put('entries', entry)] };
}

/** Change one item; `entry` rewrites its entry from the ticked sets too. No ops when nothing changed. */
function change(d: Data, plan: Plan, itemKey: string, fn: (item: PlanItem) => PlanItem, entry: boolean, now: number): Op[] {
  const i = plan.items.findIndex((x) => x.key === itemKey);
  if (i < 0) return [];
  const changed = fn(plan.items[i]);
  if (changed === plan.items[i]) return [];
  const synced = entry ? syncEntry(d, plan, changed, now) : { item: changed, ops: [] };
  return [put('plans', { ...plan, items: plan.items.map((x, j) => (j === i ? synced.item : x)) }), ...synced.ops];
}

/** The slot at `index` replaced by `fn(slot)`, for sets and single efforts alike. */
function withSlot(item: PlanItem, index: number, fn: (s: PlannedSet) => PlannedSet): PlanItem {
  const slot = slotsOf(item)[index];
  if (!slot) return item;
  const next = fn(slot);
  if (isSetItem(item)) return { ...item, sets: item.sets.map((s, i) => (i === index ? next : s)) };
  const { done: _d, skipped: _k, ...rest } = item;
  const out: PlanItem = { ...rest, target: next.target };
  if (next.done) out.done = next.done;
  if (next.skipped) out.skipped = true;
  return out;
}

const without = <T extends object, K extends keyof T>(o: T, ...keys: K[]): T => {
  const out = { ...o };
  for (const k of keys) delete out[k];
  return out;
};

/**
 * Tick a set: what was done is `values`, or a copy of the target. Rewrites that exercise's entry from
 * the item's ticked sets (creating it on the first tick) in the same call. No ops when there's nothing to log.
 */
export function opsTick(d: Data, plan: Plan, itemKey: string, index: number, values?: SetValues, now = Date.now()): Op[] {
  return change(
    d,
    plan,
    itemKey,
    (item) => {
      const slot = slotsOf(item)[index];
      const done = slot ? clean(values ?? slot.target) : {};
      return Object.keys(done).length ? withSlot(item, index, (s) => ({ ...without(s, 'skipped'), done })) : item;
    },
    true,
    now,
  );
}

/** Untick a set. When nothing is ticked any more, the entry is deleted and `entryId` cleared. */
export function opsUntick(d: Data, plan: Plan, itemKey: string, index: number, now = Date.now()): Op[] {
  return change(d, plan, itemKey, (item) => (slotsOf(item)[index]?.done ? withSlot(item, index, (s) => without(s, 'done')) : item), true, now);
}

/** "Use 105 for sets 3–4 too?": the targets of later sets that aren't ticked yet and shared the old target. */
export function opsSetTargets(plan: Plan, itemKey: string, fromIndex: number, patch: SetValues): Op[] {
  const item = plan.items.find((x) => x.key === itemKey);
  if (!item || !isSetItem(item)) return [];
  const targets = new Set(setsSharingTarget(item, fromIndex, patch));
  if (!targets.size) return [];
  const from = item.sets[fromIndex].target;
  const sets = item.sets.map((s, i) => {
    if (!targets.has(i)) return s;
    const target = { ...s.target };
    for (const [k, v] of Object.entries(patch)) if (sameValue(s.target[k], from[k])) target[k] = v;
    return { ...s, target };
  });
  return [put('plans', { ...plan, items: plan.items.map((x) => (x === item ? { ...item, sets } : x)) })];
}

/** Another set, copying the last set's target. It can be removed again. */
export function opsAddSet(plan: Plan, itemKey: string): Op[] {
  const item = plan.items.find((x) => x.key === itemKey);
  if (!item || !isSetItem(item)) return [];
  const last = item.sets[item.sets.length - 1];
  const sets = [...item.sets, { target: { ...(last?.target ?? {}) }, added: true }];
  return [put('plans', { ...plan, items: plan.items.map((x) => (x === item ? { ...item, sets } : x)) })];
}

/** Remove a set added during the workout. */
export function opsRemoveSet(d: Data, plan: Plan, itemKey: string, index: number, now = Date.now()): Op[] {
  return change(d, plan, itemKey, (item) => (isSetItem(item) && item.sets[index]?.added ? { ...item, sets: item.sets.filter((_, i) => i !== index) } : item), true, now);
}

/** Skip a set. A ticked set loses what was logged for it. */
export function opsSkipSet(d: Data, plan: Plan, itemKey: string, index: number, now = Date.now()): Op[] {
  return change(d, plan, itemKey, (item) => (slotsOf(item)[index] && !slotsOf(item)[index].skipped ? withSlot(item, index, (s) => ({ ...without(s, 'done'), skipped: true })) : item), true, now);
}

/** Skip the exercise's remaining unticked sets. */
export function opsSkipExercise(d: Data, plan: Plan, itemKey: string, now = Date.now()): Op[] {
  return change(
    d,
    plan,
    itemKey,
    (item) => {
      const open = slotsOf(item).map((s, i) => (isOpen(s) ? i : -1)).filter((i) => i >= 0);
      return open.reduce((it, i) => withSlot(it, i, (s) => ({ ...s, skipped: true })), item);
    },
    false,
    now,
  );
}

/** Add an exercise to the plan, with targets from the last time it was done. */
export function opsAddExercise(d: Data, plan: Plan, exerciseId: string): Op[] {
  if (!d.exercises.has(exerciseId)) return [];
  const last = lastDone(d, exerciseId, plan.date, plan.id);
  return [put('plans', { ...plan, items: [...plan.items, itemFor(d, exerciseId, plan.date, last ?? undefined)] })];
}

/** The exercise's note for today, copied into its entry. */
export function opsSetNotes(d: Data, plan: Plan, itemKey: string, notes: string, now = Date.now()): Op[] {
  return change(d, plan, itemKey, (item) => (item.notes === notes ? item : { ...item, notes }), true, now);
}

export const opsFinish = (plan: Plan, now = Date.now()): Op[] => [put('plans', { ...plan, finishedAt: now })];
export const opsReopen = (plan: Plan): Op[] => [put('plans', { ...plan, finishedAt: null })];

/**
 * Move a plan to another day, after that day's plans. Its logged entries move with it: they're
 * rewritten from the plan, so this works even before the snapshot has caught up with the last tick.
 */
export function opsMovePlan(d: Data, plan: Plan, date: DateStr, now = Date.now()): Op[] {
  if (date === plan.date) return [];
  const moved: Plan = { ...plan, date, order: nextOrder((d.plansByDate.get(date) ?? []).filter((p) => p.id !== plan.id)) };
  const ops: Op[] = [];
  const items = moved.items.map((item) => {
    if (!item.entryId && !tickedDone(item).length) return item;
    const synced = syncEntry(d, moved, item, now);
    ops.push(...synced.ops);
    return synced.item;
  });
  return [put('plans', { ...moved, items }), ...ops];
}

/** A copy of the plan on another day: targets only. No ticks, skips, notes per exercise, entries or finish. */
export function opsDuplicatePlan(d: Data, plan: Plan, date: DateStr, now = Date.now()): Op[] {
  const items = plan.items
    .filter((item) => d.exercises.has(item.exerciseId))
    .map((item): PlanItem => {
      const base = { key: uid('pi'), exerciseId: item.exerciseId, notes: '' };
      return isSetItem(item) ? { ...base, sets: item.sets.map((s) => ({ target: { ...s.target } })) } : { ...base, target: { ...(item.target ?? {}) } };
    });
  return [put('plans', { ...newPlan(d, date, { name: plan.name, sessionId: plan.sessionId, notes: plan.notes, items }, now) })];
}

/** Delete a plan. Its logged entries stay: they're history. */
export const opsDeletePlan = (plan: Plan): Op[] => [del('plans', plan.id)];

/**
 * Save a plan from the editor. Entries are rewritten for exercises whose ticked sets, notes, date or
 * session changed, so editing an in-progress plan keeps its log in step.
 */
export function opsSavePlan(d: Data, plan: Plan, before?: Plan, now = Date.now()): Op[] {
  const ops: Op[] = [];
  const moved = !before || before.date !== plan.date || (before.sessionId ?? null) !== (plan.sessionId ?? null);
  const items = plan.items.map((item) => {
    if (!item.entryId && !tickedDone(item).length) return item;
    const prev = before?.items.find((i) => i.key === item.key);
    if (!moved && prev && prev.notes === item.notes && prev.entryId === item.entryId && canonical(tickedDone(prev)) === canonical(tickedDone(item))) return item;
    const synced = syncEntry(d, plan, item, now);
    ops.push(...synced.ops);
    return synced.item;
  });
  return [put('plans', { ...plan, items }), ...ops];
}

/**
 * Delete an entry. One logged by a plan also clears that exercise's ticks and `entryId`, in the
 * same call, so Undo restores both.
 */
export function opsDeleteEntry(d: Data, entry: Entry): Op[] {
  const ops: Op[] = [del('entries', entry.id)];
  const plan = entry.planId ? d.plans.get(entry.planId) : undefined;
  const item = plan?.items.find((i) => i.entryId === entry.id);
  if (!plan || !item) return ops;
  const cleared: PlanItem = isSetItem(item) ? { ...item, sets: item.sets.map((s) => without(s, 'done')), entryId: null } : { ...without(item, 'done'), entryId: null };
  return [...ops, put('plans', { ...plan, items: plan.items.map((i) => (i === item ? cleared : i)) })];
}

// ---------- finishing ----------
const sum = (sets: SetValues[], key: string) => sets.reduce((n, s) => n + (typeof s[key] === 'number' ? (s[key] as number) : 0), 0);

/**
 * How an exercise fell short of its target, or null when it didn't: "14 of 15 reps", "2:15 of 3:00",
 * "2 of 3 sets", "4.2 of 5 mi", "not done".
 */
export function shortfall(type: ExerciseType, item: PlanItem): string | null {
  const slots = slotsOf(item);
  const done = slots.flatMap((s) => (s.done ? [s.done] : []));
  if (!isSetItem(item)) {
    if (!done.length) return 'not done';
    const t = slots[0].target;
    const dist = type.fields.find((f) => f.key === 'distance');
    if (dist && typeof t.distance === 'number' && sum(done, 'distance') < t.distance) return `${fmtNum(sum(done, 'distance'))} of ${fieldText(dist, t.distance)}`;
    return null;
  }
  const targets = slots.map((s) => s.target);
  for (const key of ['reps', 'duration']) {
    const target = sum(targets, key);
    if (!target) continue;
    const got = sum(done, key);
    if (got >= target) return null;
    return key === 'reps' ? `${fmtNum(got)} of ${fmtNum(target)} reps` : `${fmtDuration(got) || '0 s'} of ${fmtDuration(target)}`;
  }
  return done.length < slots.length ? `${done.length} of ${slots.length} sets` : null;
}

/** Each exercise that missed its target, for the Finish summary. */
export function planShortfalls(d: Data, plan: Plan): { ex: Exercise; text: string }[] {
  return planExercises(d, plan).flatMap(({ item, ex }) => {
    const text = shortfall(typeOf(d, ex), item);
    return text ? [{ ex, text }] : [];
  });
}

/** Plans before today with nothing ticked, from the last `days` days, newest first. */
export function missedPlans(d: Data, today: DateStr, days = 14): Plan[] {
  const from = addDays(today, -days);
  const out: Plan[] = [];
  for (const [date, list] of d.plansByDate) if (date >= from && date < today) for (const p of list) if (planStatus(visiblePlan(d, p), today) === 'missed') out.push(p);
  return out.sort((a, b) => (a.date === b.date ? b.order - a.order : a.date < b.date ? 1 : -1));
}

/** Plans after today (up to `to`, inclusive), by date and then order. */
export function upcomingPlans(d: Data, today: DateStr, to?: DateStr): Plan[] {
  const out: Plan[] = [];
  for (const [date, list] of d.plansByDate) if (date > today && (!to || date <= to)) out.push(...list);
  return out.sort((a, b) => (a.date === b.date ? a.order - b.order || a.createdAt - b.createdAt : a.date < b.date ? -1 : 1));
}
