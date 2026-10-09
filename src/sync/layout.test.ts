import { describe, expect, it } from 'vitest';
import { libraryOps } from '../db/seed';
import type { DataTable, Tombstone } from '../db/types';
import { SyncError } from './errors';
import { blobSha } from './gitsha';
import { encode, SEED_HLC } from './hlc';
import { checkManifest, isManagedPath, MANIFEST_PATH, parseFile, renderFiles, renderLine, renderManifest } from './layout';
import { index, liveVersion, tombVersion, type AnyRecord, type Version } from './merge';

const h = (n: number, node = 'k3j9x0a1b2') => encode(1_791_380_000_000 + n, 0, node);
const live = (table: DataTable, rec: AnyRecord) => liveVersion(table, rec);
const entry = (id: string, date: string, createdAt: number, extra: AnyRecord = {}) =>
  live('entries', { id, exerciseId: 'ex_bench', date, notes: '', source: 'log', createdAt, hlc: h(createdAt), sets: [{ weight: 120, reps: 8 }], ...extra });
const tomb = (table: DataTable, key: string, deletedAt: number): Version => tombVersion({ id: `${table}:${key}`, table, key, hlc: h(deletedAt), deletedAt } satisfies Tombstone);

const library = () => libraryOps().flatMap((o) => (o.type === 'put' && o.table !== 'tombstones' ? [live(o.table, o.value as unknown as AnyRecord)] : []));
const sample = (): Version[] => [
  ...library(),
  entry('en_b', '2026-10-07', 20),
  entry('en_a', '2026-10-07', 10),
  entry('en_c', '2026-09-30', 30),
  live('checkins', { id: 'ci_2', date: '2026-10-01', time: '18:40', moment: 'Evening', overall: 4, notes: '', pains: [], createdAt: 2, hlc: h(2) }),
  live('checkins', { id: 'ci_1', date: '2026-10-01', time: '07:10', moment: 'Morning', overall: null, notes: 'stiff', pains: [{ bodyPartId: 'bp_rknee', score: 3 }], createdAt: 1, hlc: h(1) }),
  live('settings', { key: 'weekStart', value: 1, hlc: h(5) }),
  tomb('tags', 'tag_b', 200),
  tomb('exercises', 'ex_a', 100),
];

describe('repository layout', () => {
  it('renders identical bytes whatever order the records were added in', () => {
    const a = renderFiles(index(sample()));
    const b = renderFiles(index([...sample()].reverse()));
    expect([...b]).toEqual([...a]);
  });

  it('puts id first and hlc last, with other keys (and nested keys) alphabetical', () => {
    const line = renderLine(entry('en_4k2j9x0a1b2c', '2026-10-07', 0, { sessionId: 'ses_upper_a', updatedAt: 7, undefinedKey: undefined, nothing: null }));
    expect(line).toBe(
      `{"id":"en_4k2j9x0a1b2c","createdAt":0,"date":"2026-10-07","exerciseId":"ex_bench","notes":"","nothing":null,"sessionId":"ses_upper_a","sets":[{"reps":8,"weight":120}],"source":"log","updatedAt":7,"hlc":"${h(0)}"}`,
    );
    expect(renderLine(live('settings', { value: 1, key: 'weekStart', hlc: h(5) }))).toBe(`{"key":"weekStart","value":1,"hlc":"${h(5)}"}`);
    expect(renderLine(tomb('tags', 'tag_b', 200))).toBe(`{"id":"tags:tag_b","deletedAt":200,"key":"tag_b","table":"tags","hlc":"${h(200)}"}`);
  });

  it('splits entries and check-ins by month and orders lines per table', () => {
    const files = renderFiles(index(sample()));
    expect([...files.keys()]).toEqual([
      MANIFEST_PATH, 'bodyParts.jsonl', 'checkins/2026-10.jsonl', 'deleted.jsonl', 'entries/2026-09.jsonl', 'entries/2026-10.jsonl',
      'exercises.jsonl', 'sessions.jsonl', 'settings.jsonl', 'snacks.jsonl', 'tags.jsonl', 'types.jsonl',
    ]);
    const ids = (path: string) => files.get(path)!.trimEnd().split('\n').map((l) => JSON.parse(l).id);
    expect(ids('entries/2026-10.jsonl')).toEqual(['en_a', 'en_b']);
    expect(ids('checkins/2026-10.jsonl')).toEqual(['ci_1', 'ci_2']);
    expect(ids('deleted.jsonl')).toEqual(['exercises:ex_a', 'tags:tag_b']);
    expect(ids('types.jsonl')).toEqual(['type_bw', 'type_hold', 'type_lift', 'type_run']);
    for (const text of files.values()) expect(text.endsWith('\n') && !text.endsWith('\n\n')).toBe(true);
    // Empty tables (views) have no file.
    expect(files.has('views.jsonl')).toBe(false);
    expect([...renderFiles(index([])).keys()]).toEqual([MANIFEST_PATH]);
  });

  it('round-trips through parseFile', () => {
    const set = index(sample());
    const files = renderFiles(set);
    const back = index([...files].flatMap(([p, text]) => parseFile(p, text)));
    expect([...renderFiles(back)]).toEqual([...files]);
    expect(back.size).toBe(set.size);
  });

  it('applies no defaults when parsing', () => {
    const [v] = parseFile('exercises.jsonl', `{"id":"ex_x","name":"X","typeId":"type_lift","hlc":"${SEED_HLC}"}\n`);
    expect(v).toMatchObject({ live: true, rec: { id: 'ex_x', name: 'X', typeId: 'type_lift', hlc: SEED_HLC } });
    expect((v as { rec: AnyRecord }).rec).not.toHaveProperty('tagIds');
  });

  it('reports the file and line of a bad record', () => {
    const text = `${renderLine(entry('en_a', '2026-10-01', 1))}\n\n${renderLine(entry('en_b', 'yesterday', 2))}\n`;
    try {
      parseFile('entries/2026-10.jsonl', text);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(SyncError);
      expect((e as SyncError).code).toBe('bad-data');
      expect((e as SyncError).detail).toEqual({ path: 'entries/2026-10.jsonl', line: 3, issue: 'date: dates must look like 2026-09-25' });
    }
    expect(() => parseFile('tags.jsonl', '{"id":"t","name":"x","color":"#000"}\n')).toThrow(/line 1: hlc/);
    expect(() => parseFile('tags.jsonl', '{not json\n')).toThrow(/line 1: not valid JSON/);
  });

  it('ignores sample records and device-local settings added by hand', () => {
    expect(parseFile('entries/2026-10.jsonl', `${renderLine(entry('en_s', '2026-10-01', 1, { sample: true }))}\n`)).toEqual([]);
    expect(parseFile('settings.jsonl', `{"key":"seeded","value":true,"hlc":"${SEED_HLC}"}\n`)).toEqual([]);
  });

  it('knows which paths it manages', () => {
    for (const p of [MANIFEST_PATH, 'entries/2026-10.jsonl', 'checkins/2026-01.jsonl', 'deleted.jsonl', 'bodyParts.jsonl', 'settings.jsonl']) expect(isManagedPath(p)).toBe(true);
    for (const p of ['README.md', 'package.json', 'entries/2026-1.jsonl', 'entries/2026-10.json', 'notes.jsonl', '.github/workflows/x.yml']) expect(isManagedPath(p)).toBe(false);
  });

  it('has a stable manifest', async () => {
    expect(JSON.parse(renderManifest())).toEqual({ app: 'groundwork', format: 1, schema: 4, about: expect.stringContaining('One record per line') });
    expect(await blobSha(renderManifest())).toBe(await blobSha(renderManifest()));
    expect(await blobSha(renderManifest())).toMatchInlineSnapshot(`"7d9cb96dd9ce4af44046456d82f909b69c0601c1"`);
    expect(() => checkManifest(renderManifest())).not.toThrow();
    expect(() => checkManifest(JSON.stringify({ app: 'groundwork', format: 2, schema: 4 }))).toThrow(expect.objectContaining({ code: 'newer-format' }));
    expect(() => checkManifest(JSON.stringify({ app: 'groundwork', format: 1, schema: 5 }))).toThrow(expect.objectContaining({ code: 'newer-format' }));
    // Data from older versions is read, and rewritten in the current format by the next sync that changes anything.
    expect(() => checkManifest(JSON.stringify({ app: 'groundwork', format: 1, schema: 3 }))).not.toThrow();
    expect(() => checkManifest('{')).toThrow(expect.objectContaining({ code: 'bad-data' }));
  });
});
