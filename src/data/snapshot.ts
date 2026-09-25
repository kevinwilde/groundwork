import type { BodyPart, Checkin, Entry, Exercise, ExerciseType, SavedSession, SavedView, Setting, Snack, Tag } from '../db/types';
import type { DateStr } from '../lib/dates';

export interface RawData {
  types: ExerciseType[];
  tags: Tag[];
  exercises: Exercise[];
  entries: Entry[];
  snacks: Snack[];
  sessions: SavedSession[];
  bodyParts: BodyPart[];
  checkins: Checkin[];
  views: SavedView[];
  settings: Setting[];
}

/** Everything in the database, indexed for synchronous lookups while rendering. */
export interface Data {
  raw: RawData;
  types: Map<string, ExerciseType>;
  tags: Map<string, Tag>;
  exercises: Map<string, Exercise>;
  snacks: Map<string, Snack>;
  sessions: Map<string, SavedSession>;
  bodyParts: Map<string, BodyPart>;
  settings: Map<string, unknown>;
  typesSorted: ExerciseType[];
  tagsSorted: Tag[];
  /** Not archived, sorted by name. */
  exercisesSorted: Exercise[];
  bodyPartsSorted: BodyPart[];
  snacksSorted: Snack[];
  sessionsSorted: SavedSession[];
  viewsSorted: SavedView[];
  entriesByDate: Map<DateStr, Entry[]>;
  /** Newest first. */
  entriesByExercise: Map<string, Entry[]>;
  entriesBySnack: Map<string, Entry[]>;
  /** Newest first. */
  entriesBySession: Map<string, Entry[]>;
  checkinsByDate: Map<DateStr, Checkin[]>;
  weekStart: 0 | 1;
}

export const EMPTY_RAW: RawData = { types: [], tags: [], exercises: [], entries: [], snacks: [], sessions: [], bodyParts: [], checkins: [], views: [], settings: [] };

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

function group<T, K>(items: T[], key: (t: T) => K | null | undefined): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const it of items) {
    const k = key(it);
    if (k == null) continue;
    const list = m.get(k);
    if (list) list.push(it);
    else m.set(k, [it]);
  }
  return m;
}

const newestFirst = (a: Entry, b: Entry) => (a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? 1 : -1);

export function buildData(raw: RawData): Data {
  const settings = new Map(raw.settings.map((s) => [s.key, s.value]));
  const entriesByDate = group(raw.entries, (e) => e.date);
  for (const list of entriesByDate.values()) list.sort((a, b) => a.createdAt - b.createdAt);
  const entriesByExercise = group(raw.entries, (e) => e.exerciseId);
  for (const list of entriesByExercise.values()) list.sort(newestFirst);
  const entriesBySession = group(raw.entries, (e) => e.sessionId);
  for (const list of entriesBySession.values()) list.sort(newestFirst);
  const checkinsByDate = group(raw.checkins, (c) => c.date);
  for (const list of checkinsByDate.values()) list.sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  const ws = settings.get('weekStart');

  return {
    raw,
    types: new Map(raw.types.map((t) => [t.id, t])),
    tags: new Map(raw.tags.map((t) => [t.id, t])),
    exercises: new Map(raw.exercises.map((e) => [e.id, e])),
    snacks: new Map(raw.snacks.map((s) => [s.id, s])),
    sessions: new Map(raw.sessions.map((s) => [s.id, s])),
    bodyParts: new Map(raw.bodyParts.map((b) => [b.id, b])),
    settings,
    typesSorted: [...raw.types].sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || byName(a, b)),
    tagsSorted: [...raw.tags].sort(byName),
    exercisesSorted: raw.exercises.filter((e) => !e.archived).sort(byName),
    bodyPartsSorted: [...raw.bodyParts].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || byName(a, b)),
    snacksSorted: [...raw.snacks].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    sessionsSorted: [...raw.sessions].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || byName(a, b)),
    viewsSorted: [...raw.views].sort((a, b) => a.createdAt - b.createdAt),
    entriesByDate,
    entriesByExercise,
    entriesBySnack: group(raw.entries, (e) => e.snackId),
    entriesBySession,
    checkinsByDate,
    weekStart: ws === 1 ? 1 : 0,
  };
}
