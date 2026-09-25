import type { Data } from '../data/snapshot';
import { del, put, type Op } from '../data/ops';
import type { Entry, Exercise, ExerciseType, FieldValue, MetricId, Performance, SetValues, Snack, Tag, TypeField } from '../db/types';
import { dateTimeKey, type DateStr } from './dates';
import { fmtDuration, fmtDurationLong, fmtNum, fmtPace } from './format';

export const FALLBACK_TYPE: ExerciseType = { id: '_missing', name: 'Unknown type', mode: 'single', fields: [], color: '#687686', order: 999, createdAt: 0 };

export const MOMENTS = ['Morning', 'Pre-workout', 'Post-workout', 'Evening', 'Other'] as const;
export const FEELINGS = [
  { v: 1, label: 'Rough' },
  { v: 2, label: 'Low' },
  { v: 3, label: 'OK' },
  { v: 4, label: 'Good' },
  { v: 5, label: 'Great' },
] as const;

// ---------- lookups ----------
export const typeOf = (d: Data, ex: Exercise | undefined): ExerciseType => (ex && d.types.get(ex.typeId)) || FALLBACK_TYPE;

export const tagsOf = (d: Data, ex: Exercise | undefined): Tag[] =>
  ex ? ex.tagIds.map((id) => d.tags.get(id)).filter((t): t is Tag => !!t).sort((a, b) => a.name.localeCompare(b.name)) : [];

export const exerciseColor = (d: Data, ex: Exercise | undefined): string => ex?.color || typeOf(d, ex).color;

export const entriesOn = (d: Data, date: DateStr) => d.entriesByDate.get(date) ?? [];
export const checkinsOn = (d: Data, date: DateStr) => d.checkinsByDate.get(date) ?? [];
export const entriesFor = (d: Data, exerciseId: string) => d.entriesByExercise.get(exerciseId) ?? [];

/** Most recent entry for an exercise on or before `date`, skipping `excludeId`. */
export function lastEntry(d: Data, exerciseId: string, date?: DateStr, excludeId?: string): Entry | null {
  for (const e of entriesFor(d, exerciseId)) {
    if (e.id === excludeId) continue;
    if (!date || e.date <= date) return e;
  }
  return null;
}

// ---------- formatting ----------
export const hasValue = (v: unknown): v is FieldValue => v != null && v !== '' && !(typeof v === 'number' && Number.isNaN(v));

export function fieldText(field: TypeField, v: unknown, withLabel = false): string {
  if (!hasValue(v)) return '';
  let txt: string;
  if (field.kind === 'duration') txt = fmtDuration(Number(v));
  else if (field.kind === 'text') txt = String(v);
  else txt = fmtNum(Number(v)) + (field.unit ? ` ${field.unit}` : '');
  return withLabel ? `${field.label} ${txt}` : txt;
}

/** One set: "6 @ 100 lb", "60 s", "40 m @ 50 lb · RPE 8" */
export function setText(type: ExerciseType, set: SetValues): string {
  const parts = type.fields.filter((f) => hasValue(set[f.key]));
  return parts
    .map((f, i) => {
      if (i === 0) return fieldText(f, set[f.key]);
      const withLabel = i > 1 && !f.unit && f.kind !== 'duration';
      return (i === 1 ? '@ ' : '· ') + fieldText(f, set[f.key], withLabel);
    })
    .join(' ');
}

export const isEmptySet = (type: ExerciseType, set: SetValues) => !type.fields.some((f) => hasValue(set[f.key]));

/** "8:57 /mi" for types with both duration and distance fields. */
export function pace(type: ExerciseType, values: SetValues | undefined): string | null {
  const dist = type.fields.find((f) => f.key === 'distance');
  if (!values || !dist || !type.fields.some((f) => f.key === 'duration')) return null;
  const d = Number(values.distance);
  const t = Number(values.duration);
  if (!hasValue(values.distance) || !hasValue(values.duration) || !(d > 0) || !(t > 0)) return null;
  return `${fmtPace(t / d)} /${dist.unit || 'unit'}`;
}

/** "3 × 6 @ 100 lb", "6 @ 100 lb, 5 @ 110 lb", "27:45 · 3.1 mi · 8:57 /mi · Avg HR 152 bpm" */
export function summarize(type: ExerciseType, perf: Performance | undefined): string {
  if (!perf) return '';
  if (Array.isArray(perf.sets)) {
    const groups: { txt: string; n: number }[] = [];
    for (const st of perf.sets) {
      if (isEmptySet(type, st)) continue;
      const txt = setText(type, st);
      const last = groups[groups.length - 1];
      if (last && last.txt === txt) last.n++;
      else groups.push({ txt, n: 1 });
    }
    return groups.map((g) => (g.n > 1 ? `${g.n} × ${g.txt}` : g.txt)).join(', ');
  }
  const v = perf.values ?? {};
  const parts: string[] = [];
  type.fields.forEach((f, i) => {
    if (!hasValue(v[f.key])) return;
    const important = f.key === 'duration' || f.key === 'distance' || i < 2;
    parts.push(fieldText(f, v[f.key], !important));
    if (f.key === 'distance') {
      const p = pace(type, v);
      if (p) parts.push(p);
    }
  });
  return parts.join(' · ');
}

export const summarizeEntry = (d: Data, e: Entry) => summarize(typeOf(d, d.exercises.get(e.exerciseId)), e);

// ---------- metrics ----------
export interface MetricDef {
  id: MetricId;
  label: string;
  short: string;
  fmt: (n: number) => string;
}

export const METRICS: MetricDef[] = [
  { id: 'entries', label: 'Entries', short: 'Entries', fmt: (n) => fmtNum(n) },
  { id: 'sets', label: 'Sets', short: 'Sets', fmt: (n) => fmtNum(n) },
  { id: 'reps', label: 'Reps', short: 'Reps', fmt: (n) => fmtNum(n) },
  { id: 'volume', label: 'Volume (reps × weight)', short: 'Volume', fmt: (n) => fmtNum(Math.round(n)) },
  { id: 'duration', label: 'Time', short: 'Time', fmt: (n) => fmtDurationLong(n) },
  { id: 'distance', label: 'Distance', short: 'Distance', fmt: (n) => fmtNum(n, 1) },
];

export const metricDef = (id: MetricId) => METRICS.find((m) => m.id === id) ?? METRICS[0];

export type Metrics = Record<MetricId, number>;

export function metrics(e: Performance): Metrics {
  const out: Metrics = { entries: 1, sets: 0, reps: 0, volume: 0, duration: 0, distance: 0 };
  const num = (v: unknown) => (typeof v === 'number' && !Number.isNaN(v) ? v : 0);
  const add = (s: SetValues) => {
    out.reps += num(s.reps);
    out.volume += num(s.reps) * num(s.weight);
    out.duration += num(s.duration);
    out.distance += num(s.distance);
  };
  if (Array.isArray(e.sets)) {
    for (const s of e.sets) {
      if (!Object.values(s).some(hasValue)) continue;
      out.sets++;
      add(s);
    }
  } else if (e.values) add(e.values);
  return out;
}

// ---------- snacks ----------
export interface SnackStats {
  doneToday: number;
  last: number;
  need: boolean;
  total: number;
}

export function snackStats(d: Data, snack: Snack, todayStr: DateStr): SnackStats {
  const done = d.entriesBySnack.get(snack.id) ?? [];
  let doneToday = 0;
  let last = 0;
  for (const e of done) {
    if (e.date === todayStr) doneToday++;
    if (e.createdAt > last) last = e.createdAt;
  }
  const need = snack.perDay ? doneToday < snack.perDay : doneToday === 0;
  return { doneToday, last, need, total: done.length };
}

export interface QueuedSnack {
  snack: Snack;
  ex: Exercise;
  stats: SnackStats;
}

/** Active snacks, those still needed today first, then least recently done. */
export function snackQueue(d: Data, todayStr: DateStr): QueuedSnack[] {
  const out: QueuedSnack[] = [];
  for (const snack of d.snacksSorted) {
    if (!snack.active) continue;
    const ex = d.exercises.get(snack.exerciseId);
    if (!ex || ex.archived) continue;
    out.push({ snack, ex, stats: snackStats(d, snack, todayStr) });
  }
  return out.sort((a, b) => Number(b.stats.need) - Number(a.stats.need) || a.stats.last - b.stats.last || a.snack.order - b.snack.order);
}

/** Seconds for a countdown, when the snack is a timed hold. */
export function snackDuration(snack: Snack): number | null {
  const v = Array.isArray(snack.sets) ? snack.sets[0]?.duration : snack.values?.duration;
  return typeof v === 'number' && v > 0 ? v : null;
}

// ---------- body parts ----------
export function latestPain(d: Data, bodyPartId: string, before?: { date: DateStr; time?: string; excludeId?: string }) {
  let best: { key: string; score: number; date: DateStr } | null = null;
  const limit = before ? dateTimeKey(before.date, before.time || '99:99') : null;
  for (const c of d.raw.checkins) {
    if (before?.excludeId === c.id) continue;
    const key = dateTimeKey(c.date, c.time);
    if (limit && key >= limit) continue;
    const p = c.pains.find((x) => x.bodyPartId === bodyPartId);
    if (!p) continue;
    if (!best || key > best.key) best = { key, score: p.score, date: c.date };
  }
  return best;
}

export function ratingsCount(d: Data, bodyPartId: string): number {
  let n = 0;
  for (const c of d.raw.checkins) for (const p of c.pains) if (p.bodyPartId === bodyPartId) n++;
  return n;
}

export const hasSample = (d: Data) => d.raw.entries.some((e) => e.sample) || d.raw.checkins.some((c) => c.sample);

// ---------- cascading deletes ----------
export function opsDeleteExercise(d: Data, id: string): Op[] {
  return [
    ...d.raw.entries.filter((e) => e.exerciseId === id).map((e) => del('entries', e.id)),
    ...d.raw.snacks.filter((s) => s.exerciseId === id).map((s) => del('snacks', s.id)),
    del('exercises', id),
  ];
}

export function opsDeleteTag(d: Data, id: string): Op[] {
  return [
    ...d.raw.exercises.filter((ex) => ex.tagIds.includes(id)).map((ex) => put('exercises', { ...ex, tagIds: ex.tagIds.filter((t) => t !== id) })),
    del('tags', id),
  ];
}

export function opsDeleteBodyPart(d: Data, id: string): Op[] {
  return [
    ...d.raw.checkins.filter((c) => c.pains.some((p) => p.bodyPartId === id)).map((c) => put('checkins', { ...c, pains: c.pains.filter((p) => p.bodyPartId !== id) })),
    del('bodyParts', id),
  ];
}

export function opsRemoveSample(d: Data): Op[] {
  return [...d.raw.entries.filter((e) => e.sample).map((e) => del('entries', e.id)), ...d.raw.checkins.filter((c) => c.sample).map((c) => del('checkins', c.id))];
}
