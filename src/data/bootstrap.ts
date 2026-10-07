import { db, requestPersistence } from '../db/db';
import { libraryOps, sampleOps, typeOps } from '../db/seed';
import { today } from '../lib/dates';
import { SEED_HLC } from '../sync/hlc';
import { stampLegacy } from '../sync/legacy';
import { ensureDevice, purgeTombstones } from '../sync/local';
import { applyOps, put } from './ops';

let boot: Promise<void> | null = null;

/** Open the database, stamp data from before v3, and seed the starter library on first run. Safe to call more than once. */
export function bootstrap(): Promise<void> {
  boot ??= run();
  return boot;
}

async function run() {
  await db.open();
  void requestPersistence();
  await ensureDevice(db);
  await stampLegacy(db);
  await purgeTombstones(db);
  const seeded = await db.settings.get('seeded');
  if (!seeded) {
    // Seeded verbatim: the starter library keeps SEED_HLC, so it is identical on every device and any edit beats it.
    const verbatim = { mode: 'verbatim', origin: 'bootstrap' } as const;
    const fresh = (await db.types.count()) === 0 && (await db.exercises.count()) === 0 && (await db.entries.count()) === 0;
    if (fresh) {
      await applyOps(libraryOps(), verbatim);
      const [exercises, snacks, sessions, bodyParts] = await Promise.all([
        db.exercises.toCollection().primaryKeys(),
        db.snacks.toCollection().primaryKeys(),
        db.sessions.toCollection().primaryKeys(),
        db.bodyParts.toCollection().primaryKeys(),
      ]);
      await applyOps(sampleOps({ today: today(), exerciseIds: new Set(exercises), snackIds: new Set(snacks), sessionIds: new Set(sessions), bodyPartIds: new Set(bodyParts) }), verbatim);
    }
    await applyOps([put('settings', { key: 'seeded', value: true, hlc: SEED_HLC })], verbatim);
  }
  // Types are required to record anything; restore the built-ins if all were removed.
  // A deliberate repair, so it gets fresh stamps (local mode) and beats the deletions on other devices.
  if ((await db.types.count()) === 0) await applyOps(typeOps(Date.now()), { origin: 'bootstrap' });
}
