import { fmtNum } from '../lib/format';
import { VERBS, type Counts, type Verb } from '../sync/merge';
import { TABLES, type DataTable } from './types';

export const LABELS: Record<DataTable, string> = {
  types: 'Exercise types',
  tags: 'Tags',
  exercises: 'Exercises',
  entries: 'Logged entries',
  snacks: 'Mini-exercises',
  sessions: 'Saved sessions',
  bodyParts: 'Body parts',
  checkins: 'Check-ins',
  views: 'Saved calendar views',
  settings: 'Settings',
};

/** Singular and plural nouns, for commit subjects: "added 3 entries and 1 check-in". */
export const NOUNS: Record<DataTable, [string, string]> = {
  types: ['exercise type', 'exercise types'],
  tags: ['tag', 'tags'],
  exercises: ['exercise', 'exercises'],
  entries: ['entry', 'entries'],
  snacks: ['mini-exercise', 'mini-exercises'],
  sessions: ['saved session', 'saved sessions'],
  bodyParts: ['body part', 'body parts'],
  checkins: ['check-in', 'check-ins'],
  views: ['saved view', 'saved views'],
  settings: ['setting', 'settings'],
};

/** The nouns as the app shows them, where entries are "logged entries". */
export const ITEM_NOUNS: Record<DataTable, [string, string]> = { ...NOUNS, entries: ['logged entry', 'logged entries'] };

/** "3 logged entries", using the app's number formatting. */
export const items = (table: DataTable, n: number, nouns = ITEM_NOUNS) => `${fmtNum(n)} ${nouns[table][n === 1 ? 0 : 1]}`;

/** Tables changed by a verb, most changes first. */
export function byCount(counts: Counts, verb: Verb): [DataTable, number][] {
  return TABLES.map((t): [DataTable, number] => [t, counts[verb][t] ?? 0])
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
}

/** "a", "a and b", "a, b and c". */
export const joinAnd = (parts: string[]) => (parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`);

/** "3 logged entries added · 1 check-in updated", or '' when nothing changed. */
export function changesText(counts: Counts): string {
  return VERBS.flatMap((verb) => byCount(counts, verb).map(([t, n]) => `${items(t, n)} ${verb}`)).join(' · ');
}
