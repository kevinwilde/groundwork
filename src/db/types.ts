/** Record types stored in IndexedDB. Dates are local `yyyy-MM-dd` strings; times are `HH:mm`. */

/**
 * Sync stamps on every record, set by `applyOps()` (schema v3). `hlc` orders edits across devices
 * (src/sync/hlc.ts); `updatedAt` is the wall-clock time of the last change, for information only.
 */
export interface Stamped {
  hlc?: string;
  updatedAt?: number;
}

export type FieldKind = 'int' | 'number' | 'duration' | 'text';

export interface TypeField {
  /** Stable key used in stored values. `reps`, `weight`, `duration` and `distance` feed calendar measures. */
  key: string;
  label: string;
  kind: FieldKind;
  unit?: string;
  /** For durations: how a bare number is read ("60" = 60 s, or 60 min). */
  plain?: 's' | 'min';
}

export interface ExerciseType extends Stamped {
  id: string;
  name: string;
  /** `sets`: the fields repeat per set (lifts). `single`: one set of values (runs). */
  mode: 'sets' | 'single';
  fields: TypeField[];
  color: string;
  order: number;
  builtin?: boolean;
  createdAt: number;
}

export interface Tag extends Stamped {
  id: string;
  name: string;
  color: string;
  createdAt: number;
}

export interface Exercise extends Stamped {
  id: string;
  name: string;
  typeId: string;
  tagIds: string[];
  color: string;
  notes: string;
  archived: boolean;
  createdAt: number;
}

export type FieldValue = number | string;
export type SetValues = Record<string, FieldValue>;

/** What was done: a list of sets (set-based types) or a single set of values. */
export interface Performance {
  sets?: SetValues[];
  values?: SetValues;
}

export interface Entry extends Performance, Stamped {
  id: string;
  exerciseId: string;
  date: string;
  notes: string;
  source: 'log' | 'snack';
  snackId?: string | null;
  /** Saved session this entry was logged as part of. */
  sessionId?: string | null;
  sample?: boolean;
  createdAt: number;
}

/** One exercise in a saved session, with an optional planned amount used when there's no history. */
export interface SessionItem extends Performance {
  exerciseId: string;
}

/** A group of exercises done together, e.g. "Upper A": bench, pull-ups, overhead press. */
export interface SavedSession extends Stamped {
  id: string;
  name: string;
  items: SessionItem[];
  notes: string;
  order: number;
  createdAt: number;
}

export interface Snack extends Performance, Stamped {
  id: string;
  exerciseId: string;
  instruction: string;
  /** Target times per day; 0 = no target. */
  perDay: number;
  active: boolean;
  order: number;
  createdAt: number;
}

export interface BodyPart extends Stamped {
  id: string;
  name: string;
  active: boolean;
  notes: string;
  order: number;
  createdAt: number;
}

export interface PainScore {
  bodyPartId: string;
  score: number;
}

export interface Checkin extends Stamped {
  id: string;
  date: string;
  time: string;
  moment: string;
  overall: number | null;
  notes: string;
  pains: PainScore[];
  sample?: boolean;
  createdAt: number;
}

export type CalendarShow = 'all' | 'tags' | 'exercises' | 'types' | 'sessions';
export type CalendarColorBy = 'tag' | 'exercise' | 'type' | 'heat';
export type MetricId = 'entries' | 'sets' | 'reps' | 'volume' | 'duration' | 'distance';

export interface CalendarConfig {
  show: CalendarShow;
  tagIds: string[];
  tagMatch: 'any' | 'all';
  exerciseIds: string[];
  typeIds: string[];
  sessionIds: string[];
  colorBy: CalendarColorBy;
  metric: MetricId;
  snacks: boolean;
  checkins: boolean;
  painPartId: string;
}

export interface SavedView extends Stamped {
  id: string;
  name: string;
  config: CalendarConfig;
  createdAt: number;
}

export interface Setting extends Stamped {
  key: string;
  value: unknown;
}

/**
 * Left behind by a deleted record (v3) so the deletion reaches other devices instead of the record
 * coming back. `id` is `${table}:${key}`; a key is always either live or tombstoned, never both.
 */
export interface Tombstone {
  id: string;
  table: DataTable;
  key: string;
  hlc: string;
  deletedAt: number;
}

/** Device-local state (v3): device id, clock, sync config and token. Never exported, backed up or synced. */
export interface MetaRow {
  key: string;
  value: unknown;
}

export interface Tables {
  types: ExerciseType;
  tags: Tag;
  exercises: Exercise;
  entries: Entry;
  snacks: Snack;
  sessions: SavedSession;
  bodyParts: BodyPart;
  checkins: Checkin;
  views: SavedView;
  settings: Setting;
  tombstones: Tombstone;
}

export type TableName = keyof Tables;
/** The user's data: every table except tombstones. */
export type DataTable = Exclude<TableName, 'tombstones'>;

export const TABLES: DataTable[] = ['types', 'tags', 'exercises', 'entries', 'snacks', 'sessions', 'bodyParts', 'checkins', 'views', 'settings'];
