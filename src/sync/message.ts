import { byCount, joinAnd, LABELS, NOUNS } from '../db/labels';
import { TABLES, type DataTable } from '../db/types';
import type { DeviceInfo } from './device';
import { totalCount, VERBS, type Counts } from './merge';

export type CommitKind = 'first' | 'sync' | 'undo';

const MAX_SUBJECT = 72;

const noun = (t: DataTable, n: number) => `${n} ${NOUNS[t][n === 1 ? 0 : 1]}`;
const clean = (name: string) => name.replace(/\s+/g, ' ').trim() || 'Groundwork';

/** "added 3 entries and 1 check-in, updated 1 exercise" */
function clauses(counts: Counts): string {
  return VERBS.flatMap((verb) => {
    const tables = byCount(counts, verb);
    return tables.length ? [`${verb} ${joinAnd(tables.map(([t, n]) => noun(t, n)))}`] : [];
  }).join(', ');
}

/** The subject line, at most 72 characters for a normal device name. */
export function commitSubject(device: string, counts: Counts, kind: CommitKind): string {
  const name = clean(device);
  const total = totalCount(counts);
  if (kind === 'first') return `${name}: first sync, ${total} ${total === 1 ? 'record' : 'records'}`;
  if (!total) return `${name}: tidied the deleted-records list`;
  const text = clauses(counts);
  const subject = kind === 'undo' ? `${name}: undid a sync (${text})` : `${name}: ${text}`;
  if (subject.length <= MAX_SUBJECT) return subject;

  // "Mac: 412 changes (entries, check-ins, exercises, …)"
  const head = `${name}: ${kind === 'undo' ? 'undid a sync, ' : ''}${total} changes`;
  const perTable = (t: DataTable) => VERBS.reduce((n, v) => n + (counts[v][t] ?? 0), 0);
  const tables = TABLES.filter((t) => perTable(t) > 0).sort((a, b) => perTable(b) - perTable(a));
  const shown: string[] = [];
  for (const t of tables) {
    if (shown.length && `${head} (${[...shown, NOUNS[t][1]].join(', ')}, …)`.length > MAX_SUBJECT) break;
    shown.push(NOUNS[t][1]);
  }
  return `${head} (${shown.join(', ')}${shown.length < tables.length ? ', …' : ''})`;
}

/** One line per table: "Logged entries: 3 added, 1 updated". */
function body(counts: Counts): string[] {
  const lines = TABLES.flatMap((t) => {
    const parts = VERBS.filter((v) => counts[v][t]).map((v) => `${counts[v][t]} ${v}`);
    return parts.length ? [`${LABELS[t]}: ${parts.join(', ')}`] : [];
  });
  if (counts.purged) lines.push(`Deleted-records list: ${counts.purged} older than a year removed`);
  return lines;
}

/** Subject, a line per table, and trailers that parseTrailers() reads back. */
export function commitMessage({ device, counts, kind, app }: { device: DeviceInfo; counts: Counts; kind: CommitKind; app: string }): string {
  const lines = body(counts);
  const trailers = [`Groundwork-Device: ${clean(device.name)}`, `Groundwork-Device-Id: ${device.id}`, `Groundwork-Version: ${app}`];
  return [commitSubject(device.name, counts, kind), ...(lines.length ? [lines.join('\n')] : []), trailers.join('\n')].join('\n\n');
}

export interface Trailers {
  device?: string;
  deviceId?: string;
  version?: string;
}

export function parseTrailers(message: string): Trailers {
  const out: Trailers = {};
  for (const line of message.split('\n')) {
    const m = /^Groundwork-(Device|Device-Id|Version): (.+)$/.exec(line.trim());
    if (!m) continue;
    if (m[1] === 'Device') out.device = m[2];
    else if (m[1] === 'Device-Id') out.deviceId = m[2];
    else out.version = m[2];
  }
  return out;
}
