import { applyOps, del, put, readAll, type Op } from '../data/ops';
import { buildData, type Data } from '../data/snapshot';
import { GroundworkDB } from '../db/db';
import { libraryOps, sampleOps } from '../db/seed';
import type { Checkin, Entry, Exercise } from '../db/types';
import { addDays } from '../lib/dates';
import { opsDeleteBodyPart, opsDeleteExercise, opsDeleteTag } from '../lib/model';
import { canonical } from '../sync/canonical';
import { SEED_HLC } from '../sync/hlc';
import type { SyncSet } from '../sync/merge';

/** Seeded PRNG (mulberry32), so a failing property test can be replayed. */
export type Rng = () => number;
export function rng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const pick = <T>(r: Rng, arr: readonly T[]): T | undefined => arr[Math.floor(r() * arr.length)];
export const int = (r: Rng, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
const id = (r: Rng, prefix: string) => `${prefix}_${Math.floor(r() * 36 ** 8).toString(36)}`;

/** A device database with the starter library (and optionally sample data), as bootstrap leaves it. */
export async function seededDevice(name: string, { samples = false, today = '2026-10-07' } = {}): Promise<GroundworkDB> {
  const db = new GroundworkDB(name);
  await db.open();
  const ops = [...libraryOps(), put('settings', { key: 'seeded', value: true, hlc: SEED_HLC })];
  await applyOps(ops, { db, mode: 'verbatim' });
  if (samples) {
    const d = buildData(await readAll(db));
    await applyOps(sampleOps({ today, exerciseIds: new Set(d.exercises.keys()), snackIds: new Set(d.snacks.keys()), sessionIds: new Set(d.sessions.keys()), bodyPartIds: new Set(d.bodyParts.keys()) }), { db, mode: 'verbatim' });
  }
  return db;
}

/**
 * One random user edit, built with the app's own op builders (cascading deletes included),
 * or null when there's nothing to do it to.
 */
export function randomEdit(r: Rng, d: Data, now: number, today = '2026-10-07'): Op[] | null {
  const mine = d.raw.entries.filter((e) => !e.sample);
  const exercises = d.raw.exercises;
  const roll = r();
  let acc = 0;
  const is = (p: number) => roll < (acc += p);

  if (is(0.26)) {
    const ex = pick(r, exercises);
    if (!ex) return null;
    const e: Entry = { id: id(r, 'en'), exerciseId: ex.id, date: addDays(today, -int(r, 0, 45)), notes: '', source: 'log', sets: [{ reps: int(r, 1, 12), weight: int(r, 0, 60) * 5 }], createdAt: now };
    return [put('entries', e)];
  }
  if (is(0.12)) {
    const e = pick(r, mine);
    return e ? [put('entries', { ...e, notes: `note ${int(r, 0, 99)}`, sets: [{ reps: int(r, 1, 12) }] })] : null;
  }
  if (is(0.08)) {
    const e = pick(r, mine);
    return e ? [del('entries', e.id)] : null;
  }
  if (is(0.08)) {
    const parts = d.raw.bodyParts.filter(() => r() < 0.7);
    const c: Checkin = { id: id(r, 'ci'), date: addDays(today, -int(r, 0, 30)), time: '07:30', moment: 'Morning', overall: int(r, 1, 5), notes: '', pains: parts.map((b) => ({ bodyPartId: b.id, score: int(r, 0, 10) })), createdAt: now };
    return [put('checkins', c)];
  }
  if (is(0.08)) {
    const ex = pick(r, exercises);
    if (!ex) return null;
    const tags = d.raw.tags.filter(() => r() < 0.25).map((t) => t.id);
    return [put('exercises', r() < 0.5 ? { ...ex, name: `${ex.name.split(' #')[0]} #${int(r, 0, 99)}` } : { ...ex, tagIds: tags })];
  }
  if (is(0.05)) {
    const type = pick(r, d.raw.types);
    if (!type) return null;
    const ex: Exercise = { id: id(r, 'ex'), name: `Exercise ${int(r, 0, 999)}`, typeId: type.id, tagIds: d.raw.tags.filter(() => r() < 0.2).map((t) => t.id), color: '#2459D1', notes: '', archived: false, createdAt: now };
    return [put('exercises', ex)];
  }
  if (is(0.05)) {
    const ex = pick(r, exercises);
    return ex ? opsDeleteExercise(d, ex.id) : null;
  }
  if (is(0.04)) return [put('tags', { id: id(r, 'tag'), name: `tag ${int(r, 0, 99)}`, color: '#2E9A55', createdAt: now })];
  if (is(0.04)) {
    const t = pick(r, d.raw.tags);
    return t ? opsDeleteTag(d, t.id) : null;
  }
  if (is(0.03)) return [put('bodyParts', { id: id(r, 'bp'), name: `part ${int(r, 0, 99)}`, active: true, notes: '', order: int(r, 0, 9), createdAt: now })];
  if (is(0.03)) {
    const b = pick(r, d.raw.bodyParts);
    return b ? opsDeleteBodyPart(d, b.id) : null;
  }
  if (is(0.03)) return [put('settings', { key: 'weekStart', value: int(r, 0, 1) })];
  if (is(0.02)) {
    const t = pick(r, d.raw.types);
    return t ? [del('types', t.id)] : null;
  }
  if (is(0.03)) {
    const s = pick(r, d.raw.snacks);
    return s ? [put('snacks', { ...s, active: !s.active })] : null;
  }
  if (is(0.03)) {
    // A dialog saved without changes.
    const ex = pick(r, exercises);
    return ex ? [put('exercises', { ...ex, updatedAt: now })] : null;
  }
  const s = pick(r, d.raw.sessions);
  return s ? [put('sessions', { ...s, notes: `notes ${int(r, 0, 99)}` })] : null;
}

/** Order-independent text of a sync set, for comparing devices. */
export function setText(set: SyncSet): string {
  return canonical([...set.values()].sort((a, b) => (a.key < b.key ? -1 : 1)).map((v) => [v.key, v.live, v.hlc, v.live ? v.rec : v.tomb]));
}
