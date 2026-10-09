import type { z } from 'zod';
import { BACKUP_SCHEMA, recordSchemas, tombstoneSchema } from '../db/backup';
import type { DataTable, Tombstone } from '../db/types';
import { syncError } from './errors';
import { isHlc } from './hlc';
import { liveVersion, tombVersion, type AnyRecord, type SyncSet, type Version } from './merge';
import { isSynced } from './scope';

/**
 * How the data is laid out in the GitHub repository: JSON Lines, one record per line with a stable
 * key order, entries, check-ins and plans split by month. Rendering is pure and deterministic, so the same
 * records give the same bytes (and blob SHA) on every device.
 */

/**
 * Bumped when the layout changes incompatibly; older copies then stop with `newer-format`.
 * 2 added `plans/YYYY-MM.jsonl` (and tombstones for plans, which older copies would refuse).
 */
export const FORMAT = 2;
export const MANIFEST_PATH = 'groundwork.json';
export const DELETED_PATH = 'deleted.jsonl';
/** Foreign files a repository may hold before it has Groundwork data (GitHub's new-repository options). */
export const STARTER_FILES = new Set(['README.md', 'LICENSE', '.gitignore']);

const FLAT = ['types', 'tags', 'exercises', 'snacks', 'sessions', 'bodyParts', 'views', 'settings'] as const;
const MONTHLY = ['entries', 'checkins', 'plans'] as const;
const MANAGED = /^(?:groundwork\.json|(?:types|tags|exercises|snacks|sessions|bodyParts|views|settings|deleted)\.jsonl|(?:entries|checkins|plans)\/\d{4}-\d{2}\.jsonl)$/;

/** Files Groundwork reads and writes. Everything else is foreign: kept, and never read. */
export const isManagedPath = (path: string) => MANAGED.test(path);

const month = (rec: AnyRecord) => {
  const m = /^\d{4}-\d{2}/.exec(String(rec.date ?? ''));
  return m ? m[0] : '0000-00';
};

export function pathOf(v: Version): string {
  if (!v.live) return DELETED_PATH;
  if ((MONTHLY as readonly string[]).includes(v.table)) return `${v.table}/${month(v.rec)}.jsonl`;
  return `${v.table}.jsonl`;
}

/** The table a managed path holds, or null for the manifest and foreign files. */
export function tableOfPath(path: string): DataTable | 'tombstones' | null {
  if (!isManagedPath(path) || path === MANIFEST_PATH) return null;
  if (path === DELETED_PATH) return 'tombstones';
  const monthly = MONTHLY.find((t) => path.startsWith(`${t}/`));
  if (monthly) return monthly;
  return FLAT.find((t) => path === `${t}.jsonl`) ?? null;
}

export function groupByPath(set: SyncSet): Map<string, Version[]> {
  const groups = new Map<string, Version[]>();
  for (const v of set.values()) {
    const p = pathOf(v);
    const list = groups.get(p);
    if (list) list.push(v);
    else groups.set(p, [v]);
  }
  return groups;
}

function sortDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map((x) => (x === undefined ? null : sortDeep(x)));
  if (v === null || typeof v !== 'object') return v;
  const out: AnyRecord = {};
  for (const k of Object.keys(v).sort()) if ((v as AnyRecord)[k] !== undefined) out[k] = sortDeep((v as AnyRecord)[k]);
  return out;
}

/** One line: `id` (or `key` for settings) first, `hlc` last, everything else alphabetical; `undefined` dropped. */
export function renderLine(v: Version): string {
  const obj = (v.live ? v.rec : v.tomb) as AnyRecord;
  const first = v.live && v.table === 'settings' ? 'key' : 'id';
  const out: AnyRecord = { [first]: obj[first] };
  for (const k of Object.keys(obj).sort()) if (k !== first && k !== 'hlc' && obj[k] !== undefined) out[k] = sortDeep(obj[k]);
  out.hlc = obj.hlc;
  return JSON.stringify(out);
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const num = (v: unknown) => (typeof v === 'number' ? v : 0);
const cmp = (a: string | number, b: string | number) => (a < b ? -1 : a > b ? 1 : 0);

/** Line order: new records mostly append at the end of a file, so a diff shows one added line. */
function compareLines(a: Version, b: Version): number {
  if (!a.live || !b.live) {
    const ta = (a as { tomb: Tombstone }).tomb;
    const tb = (b as { tomb: Tombstone }).tomb;
    return cmp(ta.deletedAt, tb.deletedAt) || cmp(ta.id, tb.id);
  }
  const x = a.rec;
  const y = b.rec;
  if (a.table === 'entries' || a.table === 'plans') return cmp(str(x.date), str(y.date)) || cmp(num(x.createdAt), num(y.createdAt)) || cmp(str(x.id), str(y.id));
  if (a.table === 'checkins') return cmp(str(x.date), str(y.date)) || cmp(str(x.time), str(y.time)) || cmp(num(x.createdAt), num(y.createdAt)) || cmp(str(x.id), str(y.id));
  if (a.table === 'settings') return cmp(str(x.key), str(y.key));
  return cmp(str(x.id), str(y.id));
}

/** Every file for a set, path to text, plus the manifest. Empty files aren't written. */
export function renderFiles(set: SyncSet): Map<string, string> {
  const groups = groupByPath(set);
  const files = new Map([[MANIFEST_PATH, renderManifest()]]);
  for (const path of [...groups.keys()].sort()) files.set(path, `${groups.get(path)!.sort(compareLines).map(renderLine).join('\n')}\n`);
  return files;
}

const issueText = (error: z.ZodError) => {
  const issue = error.issues[0];
  return issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message;
};

/**
 * Read a managed file back. Each line is checked with the backup schemas plus a required stamp, but
 * the original object is kept: defaults are never applied, so they can't create phantom updates.
 * Sample records and device-local settings added by hand are ignored. A bad line throws `bad-data`.
 */
export function parseFile(path: string, text: string): Version[] {
  const table = tableOfPath(path);
  if (!table) return [];
  const out: Version[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const bad = (issue: string) => syncError('bad-data', { path, line: i + 1, issue });
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      throw bad('not valid JSON');
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw bad('not a record');
    const res = (table === 'tombstones' ? tombstoneSchema : recordSchemas[table]).safeParse(obj);
    if (!res.success) throw bad(issueText(res.error));
    const rec = obj as AnyRecord;
    if (!isHlc(rec.hlc)) throw bad('hlc: a sync stamp is missing');
    if (table === 'tombstones') out.push(tombVersion(rec as unknown as Tombstone));
    else if (isSynced(table, rec)) out.push(liveVersion(table, rec));
  }
  return out;
}

/** `groundwork.json`. Constant for a given format, so it never adds noise to the history. */
export function renderManifest(): string {
  const manifest = {
    app: 'groundwork',
    format: FORMAT,
    schema: BACKUP_SCHEMA,
    about: 'Synced by Groundwork. One record per line in each .jsonl file. Make changes in the app; edits made here can be overwritten.',
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/** Refuse data written by a newer version of Groundwork. */
export function checkManifest(text: string): void {
  let m: { app?: unknown; format?: unknown; schema?: unknown };
  try {
    m = JSON.parse(text);
  } catch {
    throw syncError('bad-data', { path: MANIFEST_PATH, line: 1, issue: 'not valid JSON' });
  }
  if (m?.app !== 'groundwork') throw syncError('not-groundwork', { example: MANIFEST_PATH });
  if (num(m.format) > FORMAT || num(m.schema) > BACKUP_SCHEMA) throw syncError('newer-format');
}

/** README.md, written once into an empty repository and never read or changed afterwards. */
export const DATA_README = `# Groundwork data

This private repository holds the data synced by Groundwork, a personal exercise tracker. Each sync that changes anything is one commit, named after the device that made it, so the history shows your data changing over time and earlier states can be recovered from it.

| File | What it holds |
| --- | --- |
| \`groundwork.json\` | Describes the format |
| \`settings.jsonl\` | Shared settings (the first day of the week) |
| \`types.jsonl\`, \`tags.jsonl\`, \`exercises.jsonl\` | Exercise types, tags and exercises |
| \`snacks.jsonl\` | Mini-exercises (movement snacks) |
| \`sessions.jsonl\` | Saved sessions |
| \`bodyParts.jsonl\` | Body parts you track in check-ins |
| \`views.jsonl\` | Saved calendar views |
| \`entries/YYYY-MM.jsonl\` | Logged entries, one file per month |
| \`plans/YYYY-MM.jsonl\` | Planned workouts, one file per month |
| \`checkins/YYYY-MM.jsonl\` | Check-ins, one file per month |
| \`deleted.jsonl\` | Records deleted in the app, so the deletion reaches every device |

One record per line. Make changes in the app: edits here may be overwritten. Keep this repository private, and don't add workflows or GitHub Pages to it.
`;
