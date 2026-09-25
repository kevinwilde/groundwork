import type { Data } from '../data/snapshot';
import type { CalendarConfig, Entry } from '../db/types';
import { UNTAGGED_COLOR } from './colors';
import { addDays, weekStartOf, type DateStr } from './dates';
import { checkinsOn, metricDef, metrics, typeOf } from './model';

export const DEFAULT_CONFIG: CalendarConfig = {
  show: 'all', tagIds: [], tagMatch: 'any', exerciseIds: [], typeIds: [], sessionIds: [],
  colorBy: 'tag', metric: 'entries', snacks: true, checkins: false, painPartId: '',
};

const CONFIG_KEYS = Object.keys(DEFAULT_CONFIG) as (keyof CalendarConfig)[];

export function normalizeConfig(c: Partial<CalendarConfig> | undefined): CalendarConfig {
  const out = { ...DEFAULT_CONFIG };
  if (!c) return out;
  for (const k of CONFIG_KEYS) if (c[k] !== undefined) (out as Record<string, unknown>)[k] = c[k];
  return out;
}

export function sameConfig(a: CalendarConfig, b: CalendarConfig): boolean {
  return CONFIG_KEYS.every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k]));
}

export type GroupKind = 'tag' | 'exercise' | 'type';
export interface Group {
  id: string;
  name: string;
  color: string;
  kind: GroupKind;
}
export interface LegendItem extends Group {
  days: number;
}
export const UNTAGGED: Group = { id: '_untagged', name: 'untagged', color: UNTAGGED_COLOR, kind: 'tag' };

export function makeMatcher(d: Data, cfg: CalendarConfig): (e: Entry) => boolean {
  const tagSet = new Set(cfg.tagIds);
  const exSet = new Set(cfg.exerciseIds);
  const typeSet = new Set(cfg.typeIds);
  const sessionSet = new Set(cfg.sessionIds);
  return (e) => {
    if (!cfg.snacks && e.source === 'snack') return false;
    const ex = d.exercises.get(e.exerciseId);
    if (!ex) return false;
    if (cfg.show === 'tags' && tagSet.size) {
      return cfg.tagMatch === 'all' ? [...tagSet].every((id) => ex.tagIds.includes(id)) : ex.tagIds.some((id) => tagSet.has(id));
    }
    if (cfg.show === 'exercises' && exSet.size) return exSet.has(ex.id);
    if (cfg.show === 'types' && typeSet.size) return typeSet.has(ex.typeId);
    if (cfg.show === 'sessions' && sessionSet.size) return !!e.sessionId && sessionSet.has(e.sessionId);
    return true;
  };
}

/** The colour groups an entry belongs to under the current "colour by" setting. */
export function groupsOf(d: Data, cfg: CalendarConfig, e: Entry): Group[] {
  const ex = d.exercises.get(e.exerciseId);
  if (!ex) return [];
  const type = typeOf(d, ex);
  switch (cfg.colorBy) {
    case 'exercise':
      return [{ id: ex.id, name: ex.name, color: ex.color || type.color, kind: 'exercise' }];
    case 'type':
      return [{ id: type.id, name: type.name, color: type.color, kind: 'type' }];
    case 'tag': {
      let ids = ex.tagIds;
      // When filtering by tags, colour only by the tags being looked at.
      if (cfg.show === 'tags' && cfg.tagIds.length) ids = ids.filter((id) => cfg.tagIds.includes(id));
      const tags = ids.map((id) => d.tags.get(id)).filter((t) => !!t);
      if (!tags.length) return [UNTAGGED];
      return tags.map((t) => ({ id: t.id, name: t.name, color: t.color, kind: 'tag' }));
    }
    default:
      return [];
  }
}

export interface DayData {
  entries: Entry[];
  /** Ordered by legend rank, so bands line up day to day. */
  groups: Group[];
  metric: number;
}

export interface Collected {
  days: Map<DateStr, DayData>;
  legend: LegendItem[];
  max: number;
  match: (e: Entry) => boolean;
  /** One colour per entry: its highest-ranked group. */
  colorOf: (e: Entry) => string;
}

export function collect(d: Data, cfg: CalendarConfig, from: DateStr, to: DateStr): Collected {
  const match = makeMatcher(d, cfg);
  const days = new Map<DateStr, DayData>();
  const legend = new Map<string, LegendItem>();
  const groupSets = new Map<DateStr, Map<string, Group>>();
  for (const [date, list] of d.entriesByDate) {
    if (date < from || date > to) continue;
    const matched = list.filter(match);
    if (!matched.length) continue;
    const gs = new Map<string, Group>();
    let metric = 0;
    for (const e of matched) {
      metric += metrics(e)[cfg.metric];
      for (const g of groupsOf(d, cfg, e)) gs.set(g.id, g);
    }
    for (const g of gs.values()) {
      const item = legend.get(g.id);
      if (item) item.days++;
      else legend.set(g.id, { ...g, days: 1 });
    }
    groupSets.set(date, gs);
    days.set(date, { entries: matched, groups: [], metric });
  }
  const order = [...legend.values()].sort((a, b) => b.days - a.days || a.name.localeCompare(b.name));
  const rank = new Map(order.map((g, i) => [g.id, i]));
  for (const [date, day] of days) day.groups = [...groupSets.get(date)!.values()].sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  let max = 0;
  for (const day of days.values()) max = Math.max(max, day.metric);
  const colorOf = (e: Entry) => {
    const gs = groupsOf(d, cfg, e);
    if (cfg.colorBy === 'heat' || !gs.length) return 'var(--accent)';
    gs.sort((a, b) => (rank.get(a.id) ?? 99) - (rank.get(b.id) ?? 99));
    return gs[0].color;
  };
  return { days, legend: order, max, match, colorOf };
}

/** 0 (nothing) to 4 (the busiest day in range). */
export function heatLevel(v: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (!v || !max) return 0;
  return Math.max(1, Math.min(4, Math.ceil((v / max) * 4))) as 1 | 2 | 3 | 4;
}

export function painOn(d: Data, date: DateStr, bodyPartId: string): number | null {
  if (!bodyPartId) return null;
  let max: number | null = null;
  for (const c of checkinsOn(d, date)) for (const p of c.pains) if (p.bodyPartId === bodyPartId) max = max == null ? p.score : Math.max(max, p.score);
  return max;
}

export function feelingOn(d: Data, date: DateStr): { n: number; avg: number | null } | null {
  const list = checkinsOn(d, date);
  if (!list.length) return null;
  const vals = list.map((c) => c.overall).filter((v): v is number => v != null);
  return { n: list.length, avg: vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null };
}

/** Active days per week for the last `n` weeks, oldest first. */
export function weeklyActive(d: Data, cfg: CalendarConfig, todayStr: DateStr, weekStart: 0 | 1, n = 16) {
  const thisWeek = weekStartOf(todayStr, weekStart);
  const from = addDays(thisWeek, -7 * (n - 1));
  const { days } = collect(d, cfg, from, addDays(thisWeek, 6));
  return Array.from({ length: n }, (_, i) => {
    const start = addDays(from, i * 7);
    let active = 0;
    for (let k = 0; k < 7; k++) if (days.has(addDays(start, k))) active++;
    return { start, active };
  });
}

/** Latest date on or before `todayStr` with a matching entry. */
export function lastMatch(d: Data, match: (e: Entry) => boolean, todayStr: DateStr): DateStr | null {
  let last: DateStr | null = null;
  for (const [date, list] of d.entriesByDate) if (date <= todayStr && (!last || date > last) && list.some(match)) last = date;
  return last;
}

export function describeConfig(d: Data, cfg: CalendarConfig): { what: string; how: string } {
  const names = (ids: string[], map: Map<string, { name: string }>) => ids.map((id) => map.get(id)?.name).filter(Boolean) as string[];
  let what = 'Everything';
  if (cfg.show === 'tags' && cfg.tagIds.length) what = names(cfg.tagIds, d.tags).join(cfg.tagMatch === 'all' ? ' + ' : ' or ');
  else if (cfg.show === 'exercises' && cfg.exerciseIds.length) what = names(cfg.exerciseIds, d.exercises).join(', ');
  else if (cfg.show === 'types' && cfg.typeIds.length) what = names(cfg.typeIds, d.types).join(', ');
  else if (cfg.show === 'sessions' && cfg.sessionIds.length) what = names(cfg.sessionIds, d.sessions).join(', ');
  const how = cfg.colorBy === 'heat' ? `shaded by ${metricDef(cfg.metric).short.toLowerCase()}` : `coloured by ${cfg.colorBy}`;
  return { what: what || 'Everything', how };
}
