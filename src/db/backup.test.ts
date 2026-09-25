import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { beforeEach, describe, expect, it } from 'vitest';
import { applyOps, del, put, readAll } from '../data/ops';
import { EMPTY_RAW } from '../data/snapshot';
import { rawFromOps } from '../test/fixtures';
import { buildBackup, importOps, parseBackup } from './backup';
import { db, GroundworkDB } from './db';
import { libraryOps, sampleOps } from './seed';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('backup validation', () => {
  it('round-trips an export', () => {
    const raw = rawFromOps(libraryOps(0));
    const parsed = parseBackup(JSON.stringify(buildBackup(raw)));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.backup.data.exercises).toHaveLength(raw.exercises.length);
  });
  it('rejects other files with a clear message', () => {
    expect(parseBackup('not json')).toEqual({ ok: false, error: 'That is not valid JSON.' });
    const other = parseBackup(JSON.stringify({ app: 'something-else', data: {} }));
    expect(other.ok).toBe(false);
    if (!other.ok) expect(other.error).toMatch(/not a Groundwork backup/);
  });
  it('rejects malformed records and says where', () => {
    const bad = parseBackup(JSON.stringify({ app: 'groundwork', data: { entries: [{ id: 'x', exerciseId: 'e', date: 'yesterday' }] } }));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/data\.entries\.0\.date/);
  });
  it('fills defaults for missing optional fields', () => {
    const ok = parseBackup(JSON.stringify({ app: 'groundwork', data: { exercises: [{ id: 'ex1', name: 'Row', typeId: 'type_lift' }] } }));
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.backup.data.exercises[0]).toMatchObject({ tagIds: [], archived: false });
  });
  it('rejects backups from a newer schema', () => {
    const newer = parseBackup(JSON.stringify({ app: 'groundwork', schema: 99, data: {} }));
    expect(newer.ok).toBe(false);
  });
  it('keeps saved sessions and the session on each entry', () => {
    const raw = rawFromOps([
      ...libraryOps(0),
      put('entries', { id: 'en1', exerciseId: 'ex_bench', date: '2026-09-16', notes: '', source: 'log', sessionId: 'ses_upper_a', createdAt: 1, sets: [{ reps: 8, weight: 120 }] }),
    ]);
    const parsed = parseBackup(JSON.stringify(buildBackup(raw)));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.backup.data.sessions.map((s) => s.name)).toEqual(['Upper A', 'Lower A', 'Full body B']);
    expect(parsed.backup.data.sessions[0].items[0]).toEqual({ exerciseId: 'ex_bench', sets: [{ reps: 8, weight: 115 }, { reps: 8, weight: 115 }, { reps: 8, weight: 115 }] });
    expect(parsed.backup.data.entries[0].sessionId).toBe('ses_upper_a');
  });
  it('imports version 1 backups that have no sessions', () => {
    const v1 = parseBackup(JSON.stringify({ app: 'groundwork', schema: 1, data: { tags: [{ id: 't', name: 'core', color: '#2E9A55' }] } }));
    expect(v1.ok).toBe(true);
    if (v1.ok) expect(v1.backup.data.sessions).toEqual([]);
  });
});

describe('applyOps (IndexedDB)', () => {
  it('writes and undoes in one step', async () => {
    await applyOps(libraryOps(0));
    const before = await readAll();
    const inverse = await applyOps([
      put('tags', { id: 'tag_new', name: 'grip', color: '#687686', createdAt: 0 }),
      put('exercises', { ...before.exercises.find((e) => e.id === 'ex_rdl')!, name: 'RDL' }),
      del('bodyParts', 'bp_rknee'),
    ]);
    const mid = await readAll();
    expect(mid.tags.some((t) => t.id === 'tag_new')).toBe(true);
    expect(mid.exercises.find((e) => e.id === 'ex_rdl')!.name).toBe('RDL');
    expect(mid.bodyParts.some((b) => b.id === 'bp_rknee')).toBe(false);

    await applyOps(inverse);
    const after = await readAll();
    expect(after.tags.some((t) => t.id === 'tag_new')).toBe(false);
    expect(after.exercises.find((e) => e.id === 'ex_rdl')!.name).toBe('Romanian Deadlift');
    expect(after.bodyParts.some((b) => b.id === 'bp_rknee')).toBe(true);
  });

  it('imports with replace and merge', async () => {
    await applyOps(libraryOps(0));
    const backup = rawFromOps([put('tags', { id: 'tag_only', name: 'only', color: '#2459D1', createdAt: 0 })], EMPTY_RAW);

    await applyOps(importOps(backup, 'merge'));
    let now = await readAll();
    expect(now.tags.length).toBeGreaterThan(1);
    expect(now.tags.some((t) => t.id === 'tag_only')).toBe(true);

    await applyOps(importOps(backup, 'replace'));
    now = await readAll();
    expect(now.tags.map((t) => t.id)).toEqual(['tag_only']);
    expect(now.exercises).toHaveLength(0);
    expect(now.settings.find((s) => s.key === 'seeded')?.value).toBe(true);
  });

  it('generates flagged sample data only for exercises that exist', () => {
    const ops = sampleOps({ today: '2026-09-25', exerciseIds: new Set(['ex_run']), snackIds: new Set(), sessionIds: new Set(), bodyPartIds: new Set(['bp_rknee']) });
    const entries = ops.filter((o) => o.table === 'entries').map((o) => (o as { value: { exerciseId: string; sample: boolean } }).value);
    expect(entries.length).toBeGreaterThan(10);
    expect(entries.every((e) => e.exerciseId === 'ex_run' && e.sample)).toBe(true);
  });
});

describe('schema upgrade', () => {
  it('opens a version 1 database as version 2 without losing data', async () => {
    const name = 'gw-upgrade-test';
    const v1 = new Dexie(name);
    v1.version(1).stores({
      types: 'id', tags: 'id, name', exercises: 'id, typeId, *tagIds', entries: 'id, date, exerciseId, snackId',
      snacks: 'id', bodyParts: 'id', checkins: 'id, date', views: 'id', settings: 'key',
    });
    await v1.open();
    await v1.table('entries').put({ id: 'en_old', exerciseId: 'ex_rdl', date: '2026-09-01', notes: '', source: 'log', createdAt: 1, sets: [{ reps: 6, weight: 95 }] });
    await v1.table('settings').put({ key: 'seeded', value: true });
    v1.close();

    const v2 = new GroundworkDB(name);
    await v2.open();
    expect(v2.verno).toBe(2);
    expect(await v2.entries.get('en_old')).toMatchObject({ exerciseId: 'ex_rdl', sets: [{ reps: 6, weight: 95 }] });
    expect(await v2.settings.get('seeded')).toEqual({ key: 'seeded', value: true });
    expect(await v2.sessions.count()).toBe(0);
    await v2.entries.put({ id: 'en_new', exerciseId: 'ex_bench', date: '2026-09-02', notes: '', source: 'log', sessionId: 'ses_x', createdAt: 2 });
    expect(await v2.entries.where('sessionId').equals('ses_x').count()).toBe(1);
    v2.close();
    await Dexie.delete(name);
  });
});
