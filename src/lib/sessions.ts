import type { Data } from '../data/snapshot';
import type { Entry, Exercise, ExerciseType, Performance, SavedSession, SessionItem, SetValues } from '../db/types';
import type { DateStr } from './dates';
import { parseQuick, quickPlaceholder, toInput } from './fields';
import { entriesFor, entriesOn, hasValue, isEmptySet } from './model';

export interface SessionRun {
  date: DateStr;
  entries: Entry[];
}

/** Days this session was logged, newest first. */
export function sessionRuns(d: Data, sessionId: string): SessionRun[] {
  const byDate = new Map<DateStr, Entry[]>();
  for (const e of d.entriesBySession.get(sessionId) ?? []) {
    const list = byDate.get(e.date);
    if (list) list.push(e);
    else byDate.set(e.date, [e]);
  }
  return [...byDate].map(([date, entries]) => ({ date, entries }));
}

export function sessionStats(d: Data, sessionId: string): { count: number; last: DateStr | null } {
  const runs = sessionRuns(d, sessionId);
  return { count: runs.length, last: runs[0]?.date ?? null };
}

/** The session's exercises that still exist in the library. */
export function sessionExercises(d: Data, session: SavedSession): { item: SessionItem; ex: Exercise }[] {
  return session.items.map((item) => ({ item, ex: d.exercises.get(item.exerciseId) })).filter((x): x is { item: SessionItem; ex: Exercise } => !!x.ex);
}

export type PrefillSource = { kind: 'session'; date: DateStr } | { kind: 'history'; date: DateStr } | { kind: 'plan' } | { kind: 'none' };

const copyPerf = (p: Performance): Performance =>
  Array.isArray(p.sets) ? { sets: p.sets.map((s) => ({ ...s })) } : p.values ? { values: { ...p.values } } : {};

const hasPlan = (item: SessionItem) => !!(item.sets?.some((s) => Object.values(s).some(hasValue)) || (item.values && Object.values(item.values).some(hasValue)));

/**
 * What to prefill for one exercise when logging a session on `date`, in order of preference:
 * the most recent time this session was logged, the exercise's latest regular entry, then the plan.
 */
export function prefill(d: Data, session: SavedSession, item: SessionItem, date: DateStr): { perf?: Performance; source: PrefillSource } {
  const lastRun = sessionRuns(d, session.id).find((r) => r.date <= date);
  const fromRun = lastRun?.entries.find((e) => e.exerciseId === item.exerciseId);
  if (lastRun && fromRun) return { perf: copyPerf(fromRun), source: { kind: 'session', date: lastRun.date } };

  const last = entriesFor(d, item.exerciseId).find((e) => e.date <= date && e.source !== 'snack');
  if (last) return { perf: copyPerf(last), source: { kind: 'history', date: last.date } };

  if (hasPlan(item)) return { perf: copyPerf(item), source: { kind: 'plan' } };
  return { source: { kind: 'none' } };
}

/** Sets as quick-entry text: "3x8@135", "2x6@100, 5@110", "2x60s". Empty for single-effort types. */
export function planText(type: ExerciseType, perf: Performance | undefined): string {
  if (type.mode !== 'sets' || !perf?.sets?.length) return '';
  const fields = type.fields.filter((f) => f.kind !== 'text');
  const one = (s: SetValues) => {
    const parts: string[] = [];
    for (const f of fields) {
      if (!hasValue(s[f.key])) break;
      parts.push(toInput(f, s[f.key]).replace(/\s+/g, ''));
    }
    return parts.join('@');
  };
  const groups: { txt: string; n: number }[] = [];
  for (const s of perf.sets) {
    if (isEmptySet(type, s)) continue;
    const txt = one(s);
    const last = groups[groups.length - 1];
    if (last && last.txt === txt) last.n++;
    else groups.push({ txt, n: 1 });
  }
  return groups.map((g) => (g.n > 1 ? `${g.n}x${g.txt}` : g.txt)).join(', ');
}

/** Parse plan text; comma-separated groups are concatenated. Empty text means no plan. */
export function parsePlan(type: ExerciseType, text: string): { sets?: SetValues[]; error?: string } {
  const trimmed = text.trim();
  if (!trimmed) return {};
  if (type.mode !== 'sets') return { error: `${type.name} exercises don't take a planned set count.` };
  const sets: SetValues[] = [];
  for (const part of trimmed.split(',')) {
    if (!part.trim()) continue;
    const parsed = parseQuick(type, part);
    if (!parsed) return { error: `Couldn't read "${part.trim()}". Try ${quickPlaceholder(type).replace('e.g. ', '')}.` };
    sets.push(...parsed);
  }
  return { sets };
}

/** Session items from what was logged on a day (snacks excluded), keeping order and the sets done. */
export function itemsFromDay(d: Data, date: DateStr): SessionItem[] {
  const seen = new Set<string>();
  const items: SessionItem[] = [];
  for (const e of entriesOn(d, date)) {
    if (e.source === 'snack' || seen.has(e.exerciseId) || !d.exercises.has(e.exerciseId)) continue;
    seen.add(e.exerciseId);
    items.push(Array.isArray(e.sets) ? { exerciseId: e.exerciseId, sets: e.sets.map((s) => ({ ...s })) } : { exerciseId: e.exerciseId });
  }
  return items;
}

export function describeSession(d: Data, session: SavedSession): string {
  return sessionExercises(d, session)
    .map((x) => x.ex.name)
    .join(' · ');
}
