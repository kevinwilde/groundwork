import Dexie, { type Table } from 'dexie';
import type { BodyPart, Checkin, Entry, Exercise, ExerciseType, SavedSession, SavedView, Setting, Snack, Tag } from './types';

export class GroundworkDB extends Dexie {
  types!: Table<ExerciseType, string>;
  tags!: Table<Tag, string>;
  exercises!: Table<Exercise, string>;
  entries!: Table<Entry, string>;
  snacks!: Table<Snack, string>;
  sessions!: Table<SavedSession, string>;
  bodyParts!: Table<BodyPart, string>;
  checkins!: Table<Checkin, string>;
  views!: Table<SavedView, string>;
  settings!: Table<Setting, string>;

  constructor(name = 'groundwork') {
    super(name);
    // Only indexed properties are listed; everything else is stored as-is.
    // Add a new this.version(n) block (never edit this one) when the schema changes.
    this.version(1).stores({
      types: 'id',
      tags: 'id, name',
      exercises: 'id, typeId, *tagIds',
      entries: 'id, date, exerciseId, snackId',
      snacks: 'id',
      bodyParts: 'id',
      checkins: 'id, date',
      views: 'id',
      settings: 'key',
    });
    // v2: saved sessions, and entries remember which session they were logged in.
    this.version(2).stores({
      entries: 'id, date, exerciseId, snackId, sessionId',
      sessions: 'id',
    });
  }
}

export const db = new GroundworkDB();

/** Ask the browser not to evict our data under storage pressure. */
export async function requestPersistence(): Promise<boolean | null> {
  try {
    if (!navigator.storage?.persist) return null;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}
