import { db, requestPersistence } from '../db/db';
import { libraryOps, sampleOps, typeOps } from '../db/seed';
import { today } from '../lib/dates';
import { applyOps, put } from './ops';

let boot: Promise<void> | null = null;

/** Open the database and seed the starter library on first run. Safe to call more than once. */
export function bootstrap(): Promise<void> {
  boot ??= run();
  return boot;
}

async function run() {
  await db.open();
  void requestPersistence();
  const seeded = await db.settings.get('seeded');
  if (!seeded) {
    const fresh = (await db.types.count()) === 0 && (await db.exercises.count()) === 0 && (await db.entries.count()) === 0;
    if (fresh) {
      await applyOps(libraryOps());
      const [exercises, snacks, sessions, bodyParts] = await Promise.all([
        db.exercises.toCollection().primaryKeys(),
        db.snacks.toCollection().primaryKeys(),
        db.sessions.toCollection().primaryKeys(),
        db.bodyParts.toCollection().primaryKeys(),
      ]);
      await applyOps(sampleOps({ today: today(), exerciseIds: new Set(exercises), snackIds: new Set(snacks), sessionIds: new Set(sessions), bodyPartIds: new Set(bodyParts) }));
    }
    await applyOps([put('settings', { key: 'seeded', value: true })]);
  }
  // Types are required to record anything; restore the built-ins if all were removed.
  if ((await db.types.count()) === 0) await applyOps(typeOps());
}
