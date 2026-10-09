import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { beforeEach, describe, expect, it } from 'vitest';
import { applyOps, del, put, readAll } from '../data/ops';
import { EMPTY_RAW } from '../data/snapshot';
import { encode, SEED_HLC } from '../sync/hlc';
import { readSyncSet } from '../sync/local';
import { rawFromOps } from '../test/fixtures';
import { BACKUP_SCHEMA, buildBackup, mergeImport, parseBackup, replaceImportOps, type BackupContents } from './backup';
import { db, GroundworkDB } from './db';
import { libraryOps, sampleOps } from './seed';

/** Import a parsed backup the way the Restore card does. */
async function importBackup(backup: BackupContents, mode: 'merge' | 'replace', now = Date.now()) {
  if (mode === 'replace') return applyOps(replaceImportOps(backup), { mode: 'verbatim' });
  const snap = await readSyncSet();
  const { ops, counts } = mergeImport(snap, backup, now);
  await applyOps(ops, { mode: 'verbatim', expectSeq: snap.seq });
  return counts;
}
const parsed = (text: string): BackupContents => {
  const res = parseBackup(text);
  if (!res.ok) throw new Error(res.error);
  return res.backup;
};

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
    await applyOps(libraryOps(0), { mode: 'verbatim' });
    const backup = { data: rawFromOps([put('tags', { id: 'tag_only', name: 'only', color: '#2459D1', createdAt: 0 })], EMPTY_RAW), tombstones: [] };

    const counts = await importBackup(backup, 'merge');
    let now = await readAll();
    expect(now.tags.length).toBeGreaterThan(1);
    expect(now.tags.some((t) => t.id === 'tag_only')).toBe(true);
    expect(counts).toMatchObject({ added: { tags: 1 } });

    await importBackup(backup, 'replace');
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

describe('backup format 3', () => {
  it('round-trips stamps and tombstones', async () => {
    await applyOps(libraryOps(), { mode: 'verbatim' });
    await applyOps([put('tags', { id: 'tag_new', name: 'grip', color: '#687686', createdAt: 5 }), del('exercises', 'ex_plank')]);
    const raw = await readAll();
    const tombstones = await db.tombstones.toArray();
    expect(tombstones.map((t) => t.id)).toEqual(['exercises:ex_plank']);
    const text = JSON.stringify(buildBackup(raw, tombstones));
    const back = parsed(text);
    expect(JSON.parse(text).schema).toBe(BACKUP_SCHEMA);
    expect(back.tombstones).toEqual(tombstones);
    expect(back.data.tags.find((t) => t.id === 'tag_new')!.hlc).toBe(raw.tags.find((t) => t.id === 'tag_new')!.hlc);
    expect(back.data.tags.find((t) => t.id === 'tag_core')!.hlc).toBe(SEED_HLC);
    expect(back.data.settings).toEqual(raw.settings);
  });

  it('never contains device-local state', async () => {
    await applyOps(libraryOps(), { mode: 'verbatim' });
    await db.meta.put({ key: 'githubToken', value: { token: 'github_pat_SECRET' } });
    const text = JSON.stringify(buildBackup(await readAll(), await db.tombstones.toArray()));
    expect(text).not.toContain('github_pat_');
    expect(Object.keys(JSON.parse(text))).toEqual(['app', 'schema', 'exportedAt', 'counts', 'data', 'tombstones']);
  });

  it('rejects malformed stamps and tombstones', () => {
    const badStamp = parseBackup(JSON.stringify({ app: 'groundwork', schema: 3, data: { tags: [{ id: 't', name: 'x', color: '#000', hlc: 'yesterday' }] } }));
    expect(badStamp.ok).toBe(false);
    const badTomb = parseBackup(JSON.stringify({ app: 'groundwork', schema: 3, tombstones: [{ id: 'tags:a', table: 'tags', key: 'b', hlc: SEED_HLC, deletedAt: 1 }] }));
    expect(badTomb.ok).toBe(false);
  });

  it('merges a version 2 backup using legacy stamps', async () => {
    await applyOps(libraryOps(), { mode: 'verbatim' });
    const v2 = JSON.stringify({
      app: 'groundwork',
      schema: 2,
      data: {
        // Unchanged starter records from a v2 install: recognised, so nothing changes.
        exercises: [{ id: 'ex_plank', name: 'Plank', typeId: 'type_hold', tagIds: ['tag_core'], color: '#2E9A55', notes: '', archived: false, createdAt: 1_700_000_000_000 }],
        entries: [{ id: 'en_old', exerciseId: 'ex_plank', date: '2026-09-01', notes: '', source: 'log', createdAt: 1_700_000_000_000, sets: [{ duration: 60 }] }],
        tags: [{ id: 'tag_core', name: 'abs', color: '#2E9A55', createdAt: 1_700_000_000_000, updatedAt: 1_700_000_500_000 }],
      },
    });
    const counts = await importBackup(parsed(v2), 'merge');
    expect(counts).toMatchObject({ added: { entries: 1 }, updated: { tags: 1 } });
    expect((await db.entries.get('en_old'))!.hlc).toBe(encode(1_700_000_000_000, 0, 'legacy'));
    expect(await db.exercises.get('ex_plank')).toMatchObject({ createdAt: 0, hlc: SEED_HLC });
    expect((await db.tags.get('tag_core'))!.name).toBe('abs');
  });

  it("doesn't let a merge overwrite a newer local edit, and applies the backup's deletions", async () => {
    await applyOps(libraryOps(), { mode: 'verbatim' });
    await applyOps([put('tags', { id: 'tag_a', name: 'old', color: '#000', createdAt: 1 }), put('tags', { id: 'tag_b', name: 'b', color: '#000', createdAt: 1 })]);
    const backup = parsed(JSON.stringify(buildBackup(await readAll(), [])));
    await applyOps([del('tags', 'tag_b')]);
    const deletion = await db.tombstones.toArray();
    await applyOps([put('tags', { ...(await db.tags.get('tag_a'))!, name: 'newer' })]);
    await applyOps([put('tags', { id: 'tag_b', name: 'b', color: '#000', createdAt: 1 })]);
    // The backup holds the old tag_a, plus a deletion of tag_b older than its re-creation, and a deletion of a starter tag.
    backup.tombstones = [...deletion, { id: 'tags:tag_core', table: 'tags', key: 'tag_core', hlc: encode(Date.now(), 0, 'other'), deletedAt: Date.now() }];
    const counts = await importBackup(backup, 'merge');
    expect((await db.tags.get('tag_a'))!.name).toBe('newer');
    expect(await db.tags.get('tag_b')).toBeDefined();
    expect(await db.tags.get('tag_core')).toBeUndefined();
    expect(counts).toMatchObject({ deleted: { tags: 1 }, updated: {}, added: {} });
  });

  it('skips sample records and device-local settings when merging, but replace restores everything', async () => {
    await applyOps(libraryOps(), { mode: 'verbatim' });
    const backup = parsed(
      JSON.stringify({
        app: 'groundwork',
        schema: 3,
        data: {
          entries: [{ id: 'en_s', exerciseId: 'ex_plank', date: '2026-09-01', notes: '', source: 'log', sample: true, createdAt: 1, hlc: SEED_HLC }],
          settings: [{ key: 'lastExportAt', value: 99, hlc: encode(9, 0, 'x') }],
        },
      }),
    );
    await importBackup(backup, 'merge');
    expect(await db.entries.count()).toBe(0);
    expect(await db.settings.get('lastExportAt')).toBeUndefined();
    await importBackup(backup, 'replace');
    expect(await db.entries.count()).toBe(1);
    expect((await db.settings.get('lastExportAt'))!.value).toBe(99);
  });

  it('clears tombstones on replace, keeping only those in the backup', async () => {
    await applyOps(libraryOps(), { mode: 'verbatim' });
    await applyOps([del('tags', 'tag_core')]);
    expect(await db.tombstones.count()).toBe(1);
    await importBackup({ data: EMPTY_RAW, tombstones: [] }, 'replace');
    expect(await db.tombstones.count()).toBe(0);
    const tomb = { id: 'tags:x', table: 'tags' as const, key: 'x', hlc: SEED_HLC, deletedAt: 1 };
    await importBackup({ data: EMPTY_RAW, tombstones: [tomb] }, 'replace');
    expect(await db.tombstones.toArray()).toEqual([tomb]);
  });
});

describe('schema upgrade', () => {
  it('opens a version 3 database as version 4 with an empty plans table, and finds plans by date', async () => {
    const name = 'gw-upgrade-v3';
    const v3 = new Dexie(name);
    v3.version(1).stores({
      types: 'id', tags: 'id, name', exercises: 'id, typeId, *tagIds', entries: 'id, date, exerciseId, snackId',
      snacks: 'id', bodyParts: 'id', checkins: 'id, date', views: 'id', settings: 'key',
    });
    v3.version(2).stores({ entries: 'id, date, exerciseId, snackId, sessionId', sessions: 'id' });
    v3.version(3).stores({ tombstones: 'id, deletedAt', meta: 'key' });
    await v3.open();
    await v3.table('entries').put({ id: 'en_old', exerciseId: 'ex_rdl', date: '2026-09-01', notes: '', source: 'log', createdAt: 1, hlc: SEED_HLC });
    v3.close();

    const v4 = new GroundworkDB(name);
    await v4.open();
    expect(v4.verno).toBe(4);
    expect(await v4.entries.get('en_old')).toMatchObject({ exerciseId: 'ex_rdl' });
    expect(await v4.plans.count()).toBe(0);
    await v4.plans.put({ id: 'pl_1', date: '2026-10-11', name: 'Upper A', items: [], notes: '', order: 1, createdAt: 2 });
    expect(await v4.plans.where('date').equals('2026-10-11').primaryKeys()).toEqual(['pl_1']);
    v4.close();
    await Dexie.delete(name);
  });

  it('opens a version 1 database as the current version without losing data', async () => {
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
    expect(v2.verno).toBe(4);
    expect(await v2.entries.get('en_old')).toMatchObject({ exerciseId: 'ex_rdl', sets: [{ reps: 6, weight: 95 }] });
    expect(await v2.settings.get('seeded')).toEqual({ key: 'seeded', value: true });
    expect(await v2.sessions.count()).toBe(0);
    expect(await v2.tombstones.count()).toBe(0);
    expect(await v2.plans.count()).toBe(0);
    await v2.entries.put({ id: 'en_new', exerciseId: 'ex_bench', date: '2026-09-02', notes: '', source: 'log', sessionId: 'ses_x', createdAt: 2 });
    expect(await v2.entries.where('sessionId').equals('ses_x').count()).toBe(1);
    v2.close();
    await Dexie.delete(name);
  });
});
