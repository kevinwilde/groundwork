import Dexie, { type Table } from 'dexie';
import type { BodyPart, Checkin, Entry, Exercise, ExerciseType, MetaRow, Plan, SavedSession, SavedView, Setting, Snack, Tag, Tombstone } from './types';

export class GroundworkDB extends Dexie {
  types!: Table<ExerciseType, string>;
  tags!: Table<Tag, string>;
  exercises!: Table<Exercise, string>;
  entries!: Table<Entry, string>;
  snacks!: Table<Snack, string>;
  sessions!: Table<SavedSession, string>;
  plans!: Table<Plan, string>;
  bodyParts!: Table<BodyPart, string>;
  checkins!: Table<Checkin, string>;
  views!: Table<SavedView, string>;
  settings!: Table<Setting, string>;
  tombstones!: Table<Tombstone, string>;
  meta!: Table<MetaRow, string>;

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
    // v3: device sync. Deleted records leave tombstones so deletions reach other devices;
    // meta holds device-local state (device id, clock, sync config, token) and is never exported or synced.
    this.version(3).stores({ tombstones: 'id, deletedAt', meta: 'key' });
    // v4: workout plans, dated workouts planned ahead and ticked off set by set. Entries gain an unindexed planId.
    this.version(4).stores({ plans: 'id, date' });
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
