import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyOps, clear, del, put, readAll } from '../data/ops';
import { buildData } from '../data/snapshot';
import { buildBackup } from '../db/backup';
import type { GroundworkDB } from '../db/db';
import { libraryOps } from '../db/seed';
import { TABLES } from '../db/types';
import { opsDeleteExercise } from '../lib/model';
import { FakeGitHub } from '../test/fakeGitHub';
import { seededDevice, setText } from '../test/randomEdits';
import { AUTHOR_EMAIL, disconnect, openContext, parseRepo, runSync, testConnection, undoSync, type SyncContext, type SyncOutcome } from './engine';
import { SyncError } from './errors';
import { SEED_HLC } from './hlc';
import { isManagedPath, MANIFEST_PATH, parseFile, renderFiles, renderManifest } from './layout';
import { getMeta, purgeTombstones, readSyncSet, setMeta } from './local';
import { index } from './merge';
import { TOMBSTONE_TTL } from './scope';

const REPO = 'kevinwilde/groundwork-data';
const TOKEN = 'github_pat_11AAAAAAA0secretsecretsecretsecret';
const DAY = 86_400_000;
const MIN = 60_000;
let fake: FakeGitHub;
let wall: number;
const now = () => wall;
const names: string[] = [];
let n = 0;

interface Dev {
  db: GroundworkDB;
  ctx: SyncContext;
}

beforeEach(() => {
  wall = Date.UTC(2026, 9, 7, 9, 12);
  fake = new FakeGitHub();
  fake.now = now;
});
afterEach(async () => {
  for (const name of names.splice(0)) await Dexie.delete(name);
});

async function device(name: string, { samples = false, token = `${TOKEN}${name}` } = {}): Promise<Dev> {
  const dbName = `engine-${name}-${++n}`;
  names.push(dbName);
  const db = await seededDevice(dbName, { samples });
  const res = await testConnection({ repo: REPO, token, deviceName: name }, { db, fetch: fake.fetch, now });
  if (!res.ok) throw res.error;
  return { db, ctx: (await context(db))! };
}

const context = (db: GroundworkDB) => openContext(db, { fetch: fake.fetch, now, lock: (fn) => fn(), sleep: async () => {}, random: () => 0, online: () => true });

async function sync(dev: Dev, opts: Parameters<typeof runSync>[1] = {}): Promise<SyncOutcome> {
  dev.ctx = (await context(dev.db))!;
  return runSync(dev.ctx, opts);
}

async function failure(p: Promise<unknown>): Promise<SyncError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(SyncError);
    return e as SyncError;
  }
  throw new Error('expected the sync to fail');
}

/** The records GitHub holds, parsed from its files. */
const remoteSet = () => index([...fake.files()].flatMap(([p, text]) => (isManagedPath(p) ? parseFile(p, text) : [])));
const localSet = async (dev: Dev) => (await readSyncSet(dev.db)).set;
async function dump(dev: Dev) {
  return { ...(await readAll(dev.db)), tombstones: await dev.db.tombstones.toArray() };
}
async function logEntry(dev: Dev, id: string, date = '2026-10-07', exerciseId = 'ex_bench') {
  wall += 1000;
  await applyOps([put('entries', { id, exerciseId, date, notes: '', source: 'log', sets: [{ reps: 8, weight: 120 }], createdAt: wall })], { db: dev.db, now });
}
const subjects = () => fake.history().map((c) => c.message.split('\n')[0]);
async function expectConverged(...devs: Dev[]) {
  const remote = setText(remoteSet());
  for (const d of devs) expect(setText(await localSet(d))).toBe(remote);
  const files = renderFiles(await localSet(devs[0]));
  expect(new Map([...fake.files()].filter(([p]) => isManagedPath(p)))).toEqual(files);
}

describe('the first sync', () => {
  it('sets up an empty repository, then uploads everything in one commit', async () => {
    const mac = await device('Mac');
    await logEntry(mac, 'en_1');
    const out = await sync(mac);
    expect(out.kind).toBe('synced');
    const n = [...(await localSet(mac)).values()].filter((v) => v.live).length;
    expect(subjects()).toEqual([`Mac: first sync, ${n} records`, 'Set up Groundwork sync']);
    expect(fake.files().get('README.md')).toContain('# Groundwork data');
    await expectConverged(mac);
    const [data] = fake.history();
    expect(data.author).toEqual({ name: 'Groundwork (Mac)', email: AUTHOR_EMAIL });
    expect(data.message).toMatch(/\nGroundwork-Device: Mac\nGroundwork-Device-Id: [0-9a-z]{10}\nGroundwork-Version: \d+\.\d+\.\d+$/);
    expect(await getMeta(mac.db, 'syncState')).toMatchObject({ commit: fake.head(), remote: { device: 'Mac' } });
    // Sample data and device-local settings stay on the device.
    expect([...fake.files().keys()].some((p) => p.startsWith('checkins/'))).toBe(false);
    expect(fake.files().get('settings.jsonl')).toBeUndefined();
  });

  it('previews, then merges, a second device that has data of its own', async () => {
    const mac = await device('Mac');
    await logEntry(mac, 'en_mac');
    await sync(mac);
    const phone = await device('iPhone', { samples: true });
    await logEntry(phone, 'en_phone', '2026-10-06');
    const preview = await sync(phone, { preview: true });
    expect(preview).toMatchObject({ kind: 'preview', firstSync: true, remoteHasData: true, ownRecords: 1, counts: { local: { added: { entries: 1 } }, remote: { added: { entries: 1 } } } });
    expect(fake.history()).toHaveLength(2);
    expect((await readAll(phone.db)).entries.some((e) => e.id === 'en_mac')).toBe(false);

    const out = await sync(phone);
    expect(out).toMatchObject({ kind: 'synced', totals: { local: { added: { entries: 1 } }, remote: { added: { entries: 1 } } } });
    expect(subjects()[0]).toBe('iPhone: added 1 entry');
    await sync(mac);
    await expectConverged(mac, phone);
    // The phone's sample history stays on the phone.
    expect((await readAll(mac.db)).entries.map((e) => e.id).sort()).toEqual(['en_mac', 'en_phone']);
  });

  it('previews an empty repository as uploading everything', async () => {
    const mac = await device('Mac');
    const preview = await sync(mac, { preview: true });
    expect(preview).toMatchObject({ kind: 'preview', remoteHasData: false, ownRecords: 0 });
    expect(fake.empty).toBe(true);
  });
});

describe('everyday syncs', () => {
  it('costs exactly one request when nothing changed', async () => {
    const mac = await device('Mac');
    await sync(mac);
    fake.log = [];
    expect(await sync(mac)).toMatchObject({ kind: 'up-to-date' });
    expect(fake.log.map((r) => r.route)).toEqual(['getRef']);
  });

  it('turns one new entry into one commit touching one month file', async () => {
    const mac = await device('Mac');
    await logEntry(mac, 'en_sept', '2026-09-30');
    await sync(mac);
    const before = fake.files();
    await logEntry(mac, 'en_1');
    const out = await sync(mac);
    expect(out).toMatchObject({ kind: 'synced', totals: { remote: { added: { entries: 1 } } } });
    const after = fake.files();
    expect([...after.keys()].filter((p) => before.get(p) !== after.get(p))).toEqual(['entries/2026-10.jsonl']);
    expect(after.get('entries/2026-10.jsonl')!.trimEnd().split('\n')).toHaveLength(1);
    expect(fake.history()[0].message.split('\n\n')[0]).toBe('Mac: added 1 entry');
    expect(fake.history()[0].message).toContain('Logged entries: 1 added');
  });

  it('downloads only the files that differ', async () => {
    const mac = await device('Mac');
    await logEntry(mac, 'en_sept', '2026-09-30');
    await sync(mac);
    const phone = await device('iPhone');
    await sync(phone);
    await logEntry(phone, 'en_oct', '2026-10-07');
    await sync(phone);
    fake.log = [];
    const out = await sync(mac);
    expect(out).toMatchObject({ kind: 'pulled', totals: { local: { added: { entries: 1 } } } });
    expect(fake.requests('getBlob')).toHaveLength(1);
    expect(fake.log.map((r) => r.route)).toEqual(['getRef', 'getCommit', 'getTree', 'getBlob']);
    await expectConverged(mac, phone);
  });

  it('propagates deletions, including cascades', async () => {
    const mac = await device('Mac');
    await logEntry(mac, 'en_rdl', '2026-10-01', 'ex_rdl');
    await sync(mac);
    const phone = await device('iPhone');
    await sync(phone);
    await applyOps(opsDeleteExercise(buildData(await readAll(mac.db)), 'ex_rdl'), { db: mac.db, now });
    expect((await sync(mac)).kind).toBe('synced');
    expect(subjects()[0]).toBe('Mac: deleted 1 exercise and 1 entry');
    const out = await sync(phone);
    expect(out).toMatchObject({ kind: 'pulled', totals: { local: { deleted: { entries: 1, exercises: 1 } } } });
    expect(await phone.db.exercises.get('ex_rdl')).toBeUndefined();
    expect(await phone.db.tombstones.get('exercises:ex_rdl')).toBeDefined();
    await expectConverged(mac, phone);
  });

  it('brings back a record deleted on one device and edited later on the other', async () => {
    const mac = await device('Mac');
    await sync(mac);
    const phone = await device('iPhone');
    await sync(phone);
    await applyOps([del('tags', 'tag_core')], { db: mac.db, now });
    await sync(mac);
    wall += 60_000;
    const tag = (await phone.db.tags.get('tag_core'))!;
    await applyOps([put('tags', { ...tag, name: 'abs' })], { db: phone.db, now });
    await sync(phone);
    await sync(mac);
    expect((await mac.db.tags.get('tag_core'))!.name).toBe('abs');
    expect(await mac.db.tombstones.get('tags:tag_core')).toBeUndefined();
    await expectConverged(mac, phone);
  });

  it('restores an exercise deleted on one device while the other logged it', async () => {
    const mac = await device('Mac');
    await sync(mac);
    const phone = await device('iPhone');
    await sync(phone);
    await applyOps(opsDeleteExercise(buildData(await readAll(mac.db)), 'ex_squat'), { db: mac.db, now });
    await sync(mac);
    await logEntry(phone, 'en_squat', '2026-10-07', 'ex_squat');
    const out = await sync(phone);
    // The phone still had the exercise, so for it the repair is an update; GitHub had it deleted, so it's restored there.
    expect(out).toMatchObject({ kind: 'synced', totals: { local: { updated: { exercises: 1 } }, remote: { added: { entries: 1 }, restored: { exercises: 1 } } } });
    expect(subjects()[0]).toBe('iPhone: added 1 entry, restored 1 exercise');
    await sync(mac);
    expect(await mac.db.exercises.get('ex_squat')).toMatchObject({ name: 'Back Squat' });
    expect(await mac.db.entries.get('en_squat')).toBeDefined();
    await expectConverged(mac, phone);
  });

  it('cascades deletions from other devices to sample data', async () => {
    const mac = await device('Mac');
    await sync(mac);
    const phone = await device('iPhone', { samples: true });
    await sync(phone);
    const runs = (await readAll(phone.db)).entries.filter((e) => e.exerciseId === 'ex_run');
    expect(runs.length).toBeGreaterThan(5);
    await applyOps(opsDeleteExercise(buildData(await readAll(mac.db)), 'ex_run'), { db: mac.db, now });
    await sync(mac);
    await sync(phone);
    expect((await readAll(phone.db)).entries.filter((e) => e.exerciseId === 'ex_run')).toEqual([]);
    expect((await readAll(phone.db)).entries.length).toBeGreaterThan(5);
    await expectConverged(mac, phone);
  });

  it('drops an expired tombstone from deleted.jsonl', async () => {
    const mac = await device('Mac');
    await applyOps([del('tags', 'tag_core')], { db: mac.db, now });
    await sync(mac);
    expect(fake.files().get('deleted.jsonl')).toContain('tags:tag_core');
    wall += TOMBSTONE_TTL + DAY;
    await logEntry(mac, 'en_later');
    await sync(mac);
    expect(fake.files().has('deleted.jsonl')).toBe(false);
    expect(await mac.db.tombstones.count()).toBe(0);
  });

  it('tidies the deleted-records list in a commit of its own', async () => {
    const mac = await device('Mac');
    await applyOps([del('tags', 'tag_core')], { db: mac.db, now });
    await sync(mac);
    wall += TOMBSTONE_TTL + DAY;
    // Bootstrap purges expired tombstones when the app opens; the next sync removes them from GitHub.
    await purgeTombstones(mac.db, wall);
    const out = await sync(mac);
    expect(out).toMatchObject({ kind: 'synced', totals: { local: { purged: 0 }, remote: { purged: 1 } } });
    expect(subjects()[0]).toBe('Mac: tidied the deleted-records list');
    expect(fake.files().has('deleted.jsonl')).toBe(false);
  });

  it('warns when the other device clock is far ahead, and after a year without syncing', async () => {
    const mac = await device('Mac');
    await sync(mac);
    const phone = await device('iPhone');
    wall += 3 * 60 * MIN;
    await logEntry(phone, 'en_future');
    await sync(phone);
    wall -= 3 * 60 * MIN;
    const out = await sync(mac);
    expect(out.kind !== 'preview' && out.warnings).toEqual([{ kind: 'clock', minutes: 180 }]);
    // Only once: the next sync brings nothing new.
    await logEntry(mac, 'en_mac');
    const again = await sync(mac);
    expect(again.kind !== 'preview' && again.warnings).toEqual([]);
    wall += TOMBSTONE_TTL + DAY;
    await logEntry(mac, 'en_year');
    const late = await sync(mac);
    expect(late.kind !== 'preview' && late.warnings).toEqual([{ kind: 'stale' }]);
  });
});

describe('concurrency and failures', () => {
  it('retries when another device pushes in between, keeping history linear', async () => {
    const mac = await device('Mac');
    await sync(mac);
    const phone = await device('iPhone');
    await sync(phone);
    await logEntry(mac, 'en_mac');
    await logEntry(phone, 'en_phone');
    fake.log = [];
    fake.before('updateRef', async () => {
      expect((await sync(phone)).kind).toBe('synced');
    });
    const out = await sync(mac);
    expect(out.kind).toBe('synced');
    // Mac's attempt is refused after the phone's push, then Mac retries on top of it.
    expect(fake.requests('updateRef').map((r) => [r.headers.authorization.endsWith('Mac'), r.status])).toEqual([
      [true, 422],
      [false, 200],
      [true, 200],
    ]);
    await sync(phone);
    await expectConverged(mac, phone);
    const history = fake.history();
    expect(history.every((c) => c.parents.length <= 1)).toBe(true);
    expect(subjects().slice(0, 2)).toEqual(['Mac: added 1 entry', 'iPhone: added 1 entry']);
    expect(fake.forcedUpdates).toBe(0);
  });

  it('starts over when something is saved between the snapshot and the apply', async () => {
    const mac = await device('Mac');
    await sync(mac);
    const phone = await device('iPhone');
    await sync(phone);
    await logEntry(phone, 'en_phone');
    await sync(phone);
    fake.before('getBlob', () => logEntry(mac, 'en_meanwhile'));
    const out = await sync(mac);
    expect(out).toMatchObject({ kind: 'synced', totals: { local: { added: { entries: 1 } }, remote: { added: { entries: 1 } } } });
    expect(fake.files().get('entries/2026-10.jsonl')).toContain('en_meanwhile');
    await sync(phone);
    await expectConverged(mac, phone);
  });

  it('changes nothing when a download fails, and converges next time', async () => {
    const mac = await device('Mac');
    await sync(mac);
    const phone = await device('iPhone');
    await logEntry(phone, 'en_phone');
    await sync(phone);
    const before = await dump(mac);
    const head = fake.head();
    fake.failNext('getBlob', 'network');
    expect((await failure(sync(mac))).code).toBe('offline');
    expect(await dump(mac)).toEqual(before);
    expect(fake.head()).toBe(head);
    await sync(mac);
    await expectConverged(mac, phone);
  });

  it('rolls back a local apply that the browser refuses to store', async () => {
    const mac = await device('Mac');
    await sync(mac);
    const phone = await device('iPhone');
    await logEntry(phone, 'en_phone');
    await sync(phone);
    const before = await dump(mac);
    const table = mac.db.table.bind(mac.db);
    mac.db.table = ((name: string) => {
      const t = table(name);
      return name === 'entries' ? Object.assign(Object.create(t), { bulkPut: () => Promise.reject(new DOMException('The quota has been exceeded.', 'QuotaExceededError')) }) : t;
    }) as typeof mac.db.table;
    const e = await failure(sync(mac));
    expect(e.code).toBe('storage');
    expect(e.detail.message).toContain('The quota has been exceeded.');
    mac.db.table = table;
    expect(await dump(mac)).toEqual(before);
    await sync(mac);
    await expectConverged(mac, phone);
  });

  it('keeps downloaded changes when the upload fails, and pushes them next time', async () => {
    const mac = await device('Mac');
    await sync(mac);
    const phone = await device('iPhone');
    await logEntry(phone, 'en_phone');
    await sync(phone);
    await logEntry(mac, 'en_mac');
    const state = await getMeta(mac.db, 'syncState');
    const head = fake.head();
    fake.failNext('createTree', { status: 502, body: { message: 'Bad Gateway' } });
    const e = await failure(sync(mac));
    expect([e.code, e.detail.status, e.partial?.added]).toEqual(['github-down', 502, { entries: 1 }]);
    expect(await mac.db.entries.get('en_phone')).toBeDefined();
    expect(fake.head()).toBe(head);
    expect(await getMeta(mac.db, 'syncState')).toEqual(state);
    // The next sync finds nothing new for this device and uploads its state.
    expect(await sync(mac)).toMatchObject({ kind: 'synced', totals: { local: { added: {} }, remote: { added: { entries: 1 } } } });
    await sync(phone);
    await expectConverged(mac, phone);
  });

  it('retries a 409 from the ref update within the same sync', async () => {
    const mac = await device('Mac');
    await sync(mac);
    await logEntry(mac, 'en_1');
    fake.failNext('updateRef', { status: 409, body: { message: 'Reference cannot be updated' } });
    expect((await sync(mac)).kind).toBe('synced');
    await expectConverged(mac);
  });

  it('recovers when the ref update worked but its response was lost', async () => {
    const mac = await device('Mac');
    await sync(mac);
    await logEntry(mac, 'en_1');
    fake.failNext('updateRef', 'lost');
    expect((await failure(sync(mac))).code).toBe('offline');
    const head = fake.head();
    fake.log = [];
    expect((await sync(mac)).kind).toBe('up-to-date');
    expect(fake.log.map((r) => r.route)).toEqual(['getRef', 'getCommit', 'getTree']);
    expect(fake.head()).toBe(head);
    fake.log = [];
    expect((await sync(mac)).kind).toBe('up-to-date');
    expect(fake.log).toHaveLength(1);
  });

  it('gives up with busy after five conflicts in a row', async () => {
    const mac = await device('Mac');
    await sync(mac);
    await logEntry(mac, 'en_1');
    for (let i = 0; i < 5; i++) fake.failNext('updateRef', { status: 422, body: { message: 'Update is not a fast forward' } });
    expect((await failure(sync(mac))).code).toBe('busy');
  });

  it('refuses offline before making any request', async () => {
    const mac = await device('Mac');
    fake.log = [];
    const e = await failure(runSync({ ...mac.ctx, online: () => false }));
    expect(e.code).toBe('offline');
    expect(fake.log).toEqual([]);
  });
});

describe('repositories it must not change', () => {
  async function unchanged(setup: (mac: Dev) => Promise<void>, code: string) {
    const mac = await device('Mac');
    await logEntry(mac, 'en_1');
    await sync(mac);
    await logEntry(mac, 'en_2');
    await setup(mac);
    const before = await dump(mac);
    const head = fake.head();
    const files = fake.files();
    const e = await failure(sync(mac));
    expect(e.code).toBe(code);
    expect(await dump(mac)).toEqual(before);
    expect(fake.head()).toBe(head);
    expect(fake.files()).toEqual(files);
    return e;
  }

  it('public', () =>
    unchanged(async () => {
      fake.private = false;
    }, 'public'));
  it('archived', () =>
    unchanged(async () => {
      fake.archived = true;
    }, 'archived'));
  it('read-only', () =>
    unchanged(async () => {
      fake.tokens.set(`${TOKEN}Mac`, 'read-only');
    }, 'read-only'));
  it('auth', () =>
    unchanged(async () => {
      fake.tokens.set(`${TOKEN}Mac`, 'expired');
    }, 'auth'));
  it('newer-format', () =>
    unchanged(async () => {
      await fake.commitFiles({ [MANIFEST_PATH]: renderManifest().replace('"format": 1', '"format": 2') });
    }, 'newer-format'));
  it('bad-data', async () => {
    const e = await unchanged(async () => {
      const text = fake.files().get('entries/2026-10.jsonl')!;
      await fake.commitFiles({ 'entries/2026-10.jsonl': `${text}{"id":"en_hand","exerciseId":"ex_rdl","date":"7 Oct","hlc":"${SEED_HLC}"}\n` });
    }, 'bad-data');
    expect(e.detail).toEqual({ path: 'entries/2026-10.jsonl', line: 2, issue: 'date: dates must look like 2026-09-25' });
  });

  it('not-groundwork', async () => {
    const mac = await device('Mac');
    await fake.commitFiles({ 'package.json': '{}\n', 'README.md': '# app\n' });
    const before = await dump(mac);
    const head = fake.head();
    expect((await failure(sync(mac))).detail.example).toBe('package.json');
    expect(await dump(mac)).toEqual(before);
    expect(fake.head()).toBe(head);
    names.push(`engine-ng-${++n}`);
    const res = await testConnection({ repo: REPO, token: TOKEN }, { db: await seededDevice(`engine-ng-${n}`), fetch: fake.fetch, now });
    expect(res).toMatchObject({ ok: false, error: { code: 'not-groundwork', detail: { example: 'package.json' } } });
  });
});

describe('undo of a sync', () => {
  it('deletes what the sync added, everywhere, after the follow-up sync', async () => {
    const mac = await device('Mac');
    await sync(mac);
    const phone = await device('iPhone');
    await sync(phone);
    await logEntry(phone, 'en_a');
    await logEntry(phone, 'en_b');
    const tag = (await phone.db.tags.get('tag_core'))!;
    await applyOps([put('tags', { ...tag, name: 'abs' })], { db: phone.db, now });
    await sync(phone);
    const out = await sync(mac);
    if (out.kind !== 'pulled') throw new Error(out.kind);
    expect(out.totals.local).toMatchObject({ added: { entries: 2 }, updated: { tags: 1 } });
    wall += 1000;
    const after = await undoSync(out, mac.ctx);
    expect(after.kind).toBe('synced');
    expect(subjects()[0]).toBe('Mac: undid a sync (updated 1 tag, deleted 2 entries)');
    expect((await mac.db.tags.get('tag_core'))!.name).toBe('core');
    await sync(phone);
    expect(await phone.db.entries.count()).toBe(0);
    expect((await phone.db.tags.get('tag_core'))!.name).toBe('core');
    await expectConverged(mac, phone);
  });

  it('refuses once something else was saved', async () => {
    const mac = await device('Mac');
    await sync(mac);
    const phone = await device('iPhone');
    await logEntry(phone, 'en_a');
    await sync(phone);
    const out = await sync(mac);
    if (out.kind !== 'pulled') throw new Error(out.kind);
    await logEntry(mac, 'en_after');
    expect((await failure(undoSync(out, mac.ctx))).code).toBe('undo-stale');
    expect(await mac.db.entries.get('en_a')).toBeDefined();
  });
});

describe('device resets', () => {
  it('copies everything back after Erase all, without a commit', async () => {
    const mac = await device('Mac');
    await logEntry(mac, 'en_1');
    await applyOps([del('tags', 'tag_core')], { db: mac.db, now });
    const ex = (await mac.db.exercises.get('ex_rdl'))!;
    await applyOps([put('exercises', { ...ex, name: 'RDL' })], { db: mac.db, now });
    await sync(mac);
    const before = setText(await localSet(mac));
    const commits = fake.history().length;
    // What the Data page's Erase does.
    await applyOps([...TABLES.map((t) => clear(t)), clear('tombstones'), ...libraryOps(), put('settings', { key: 'seeded', value: true, hlc: SEED_HLC })], { db: mac.db, mode: 'verbatim', now });
    await mac.db.meta.delete('syncState');
    const out = await sync(mac);
    expect(out.kind).toBe('pulled');
    expect(setText(await localSet(mac))).toBe(before);
    expect(fake.history()).toHaveLength(commits);
  });

  it('forgets the repository and token on disconnect', async () => {
    const mac = await device('Mac');
    await sync(mac);
    await disconnect(mac.db);
    expect(await mac.db.meta.bulkGet(['github', 'githubToken', 'syncState'])).toEqual([undefined, undefined, undefined]);
    expect(await openContext(mac.db)).toBeNull();
    expect(await mac.db.entries.count()).toBe(0);
    expect((await mac.db.exercises.count()) > 0).toBe(true);
  });
});

describe('testConnection', () => {
  async function fresh() {
    const name = `engine-tc-${++n}`;
    names.push(name);
    return seededDevice(name);
  }
  const test = async (db: GroundworkDB, input: Partial<Parameters<typeof testConnection>[0]> = {}) => testConnection({ repo: REPO, token: TOKEN, deviceName: 'iPhone', ...input }, { db, fetch: fake.fetch, now });

  it('reads owner/name or a pasted address', () => {
    expect(parseRepo('kevinwilde/groundwork-data')).toEqual({ owner: 'kevinwilde', repo: 'groundwork-data' });
    expect(parseRepo(' https://github.com/kevinwilde/groundwork-data.git ')).toEqual({ owner: 'kevinwilde', repo: 'groundwork-data' });
    expect(parseRepo('github.com/kevinwilde/groundwork-data/')).toEqual({ owner: 'kevinwilde', repo: 'groundwork-data' });
    expect(parseRepo('groundwork-data')).toBeNull();
    expect(parseRepo('a/b/c')).toBeNull();
  });

  it('refuses bad input before asking GitHub', async () => {
    const db = await fresh();
    expect(await test(db, { repo: 'groundwork-data' })).toMatchObject({ ok: false, error: { code: 'bad-repo' } });
    expect(await test(db, { token: 'ghp_classic123' })).toMatchObject({ ok: false, error: { code: 'classic-token' } });
    expect(await test(db, { token: 'gho_oauth123' })).toMatchObject({ ok: false, error: { code: 'classic-token' } });
    expect(fake.log).toEqual([]);
    expect(await getMeta(db, 'github')).toBeUndefined();
  });

  it('reports each problem and saves nothing', async () => {
    const db = await fresh();
    const cases: [() => void, string][] = [
      [() => fake.tokens.set(TOKEN, 'expired'), 'auth'],
      [() => fake.tokens.set(TOKEN, 'no-access'), 'no-access'],
      [() => (fake.private = false), 'public'],
      [() => (fake.archived = true), 'archived'],
    ];
    for (const [setup, code] of cases) {
      setup();
      expect(await test(db)).toMatchObject({ ok: false, error: { code } });
      fake.tokens.clear();
      fake.private = true;
      fake.archived = false;
    }
    expect(await test(db, { repo: 'kevinwilde/other' })).toMatchObject({ ok: false, error: { code: 'no-access' } });
    await fake.commitFiles({ 'README.md': '# mine\n' });
    fake.tokens.set(TOKEN, 'read-only');
    expect(await test(db)).toMatchObject({ ok: false, error: { code: 'read-only' } });
    expect(await db.meta.bulkGet(['github', 'githubToken'])).toEqual([undefined, undefined]);
  });

  it('accepts an empty repository, or one with only a README, and saves the config', async () => {
    const db = await fresh();
    expect(await test(db, { expiresAt: Date.UTC(2027, 9, 8) })).toEqual({ ok: true, fullName: REPO, empty: true, remote: undefined });
    expect(await getMeta(db, 'github')).toEqual({ owner: 'kevinwilde', repo: 'groundwork-data', branch: 'main', htmlUrl: `https://github.com/${REPO}`, tokenHint: '…cret', tokenExpiresAt: Date.UTC(2027, 9, 8), connectedAt: wall });
    expect((await getMeta(db, 'device'))!.name).toBe('iPhone');
    await fake.commitFiles({ 'README.md': '# mine\n', LICENSE: 'MIT\n' });
    expect(await test(db)).toMatchObject({ ok: true, empty: true });
    expect(fake.requests('createBlob')).toHaveLength(1);
  });

  it('reports who last changed a repository with data, and forgets the sync state when the repository changes', async () => {
    const mac = await device('Mac');
    await sync(mac);
    const db = await fresh();
    expect(await test(db)).toEqual({ ok: true, fullName: REPO, empty: false, remote: { device: 'Mac', deviceId: expect.any(String), at: wall } });
    await setMeta(db, 'syncState', { commit: 'x', tree: 'y', seq: 1, at: 1, remote: { at: 1 } });
    await test(db, { token: `${TOKEN}2` });
    expect(await getMeta(db, 'syncState')).toBeDefined();
    fake.anyRepo = true;
    await test(db, { repo: 'kevinwilde/groundwork-data-2' });
    expect(await getMeta(db, 'syncState')).toBeUndefined();
  });
});

describe('the token', () => {
  it('never appears in a backup, readAll() or a thrown error', async () => {
    const mac = await device('Mac', { token: TOKEN });
    await sync(mac);
    expect(JSON.stringify(buildBackup(await readAll(mac.db), await mac.db.tombstones.toArray()))).not.toContain('github_pat_');
    expect(JSON.stringify(await readAll(mac.db))).not.toContain('github_pat_');
    expect(JSON.stringify(await getMeta(mac.db, 'github'))).not.toContain('github_pat_');
    const errors: SyncError[] = [];
    for (const setup of [() => fake.failNext('getRef', { status: 500, body: { message: `boom ${TOKEN}` } }), () => fake.failNext('getRef', 'network'), () => fake.tokens.set(TOKEN, 'expired')]) {
      setup();
      await logEntry(mac, `en_${errors.length}`);
      errors.push(await failure(sync(mac)));
    }
    fake.tokens.clear();
    const bad = await testConnection({ repo: REPO, token: `${TOKEN}expired` }, { db: mac.db, fetch: fake.fetch });
    if (!bad.ok) errors.push(bad.error);
    expect(errors).toHaveLength(4);
    for (const e of errors) {
      expect(String(e)).not.toContain('github_pat_');
      expect(JSON.stringify(e)).not.toContain('github_pat_');
      expect(JSON.stringify(e.detail)).not.toContain('github_pat_');
    }
  });
});
