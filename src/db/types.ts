/** Record types stored in IndexedDB. Dates are local `yyyy-MM-dd` strings; times are `HH:mm`. */

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

export interface ExerciseType {
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

export interface Tag {
  id: string;
  name: string;
  color: string;
  createdAt: number;
}

export interface Exercise {
  id: string;
  name: string;
  typeId: string;
  tagIds: string[];
  color: string;
  notes: string;
  archived: boolean;
  createdAt: number;
  updatedAt?: number;
}

export type FieldValue = number | string;
export type SetValues = Record<string, FieldValue>;

/** What was done: a list of sets (set-based types) or a single set of values. */
export interface Performance {
  sets?: SetValues[];
  values?: SetValues;
}

export interface Entry extends Performance {
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
  updatedAt?: number;
}

/** One exercise in a saved session, with an optional planned amount used when there's no history. */
export interface SessionItem extends Performance {
  exerciseId: string;
}

/** A group of exercises done together, e.g. "Upper A": bench, pull-ups, overhead press. */
export interface SavedSession {
  id: string;
  name: string;
  items: SessionItem[];
  notes: string;
  order: number;
  createdAt: number;
  updatedAt?: number;
}

export interface Snack extends Performance {
  id: string;
  exerciseId: string;
  instruction: string;
  /** Target times per day; 0 = no target. */
  perDay: number;
  active: boolean;
  order: number;
  createdAt: number;
}

export interface BodyPart {
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

export interface Checkin {
  id: string;
  date: string;
  time: string;
  moment: string;
  overall: number | null;
  notes: string;
  pains: PainScore[];
  sample?: boolean;
  createdAt: number;
  updatedAt?: number;
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

export interface SavedView {
  id: string;
  name: string;
  config: CalendarConfig;
  createdAt: number;
}

export interface Setting {
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
}

export type TableName = keyof Tables;

export const TABLES: TableName[] = ['types', 'tags', 'exercises', 'entries', 'snacks', 'sessions', 'bodyParts', 'checkins', 'views', 'settings'];
