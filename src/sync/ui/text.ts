import { byCount, items, joinAnd } from '../../db/labels';
import type { DataTable } from '../../db/types';
import type { Progress, Warning } from '../engine';
import { totalCount, type Counts } from '../merge';
import type { Finished } from '../status';

/** Wording and links for the Sync card and its dialogs. */

export const NEW_REPO_URL = 'https://github.com/new?name=groundwork-data&visibility=private&description=Groundwork%20data%2C%20synced%20by%20the%20app';
export const TOKENS_URL = 'https://github.com/settings/personal-access-tokens';
/** GitHub limits token names to 40 characters. */
const TOKEN_NAME_MAX = 40;

/** GitHub's new-token form, filled in with what it can be: name, description, owner, expiry and Contents permission. */
export function tokenUrl(deviceName: string, repo: { owner: string; repo: string } | null): string {
  const device = deviceName.trim() || 'this device';
  const room = TOKEN_NAME_MAX - 'Groundwork ()'.length;
  const name = `Groundwork (${device.length > room ? `${device.slice(0, room - 1)}…` : device})`;
  const params = [
    `name=${encodeURIComponent(name)}`,
    `description=${encodeURIComponent(repo ? `Groundwork sync for ${repo.owner}/${repo.repo}` : 'Groundwork sync')}`,
    ...(repo ? [`target_name=${encodeURIComponent(repo.owner)}`] : []),
    'expires_in=366',
    'contents=write',
  ];
  return `${TOKENS_URL}/new?${params.join('&')}`;
}

export function progressText(p: Progress, device: string): string {
  switch (p.step) {
    case 'checking':
      return 'Checking GitHub…';
    case 'downloading':
      return p.total === 1 ? 'Downloading 1 file…' : `Downloading ${Math.min(p.done + 1, p.total)} of ${p.total} files…`;
    case 'saving':
      return `Saving on this ${device}…`;
    case 'uploading':
      return p.files === 1 ? 'Uploading 1 file…' : `Uploading ${p.files} files…`;
    case 'retrying':
      return 'Another device synced at the same time. Trying again…';
  }
}

/** "about 3 hours", for the clock warning. */
function apart(minutes: number): string {
  if (minutes < 90) return `about ${minutes} minutes`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `about ${hours} hours` : `about ${Math.round(hours / 24)} days`;
}

export function warningText(w: Warning): string {
  if (w.kind === 'clock') return `Your devices' clocks seem ${apart(w.minutes)} apart. Turn on Set Automatically in Date & Time on each device.`;
  return "This device hadn't synced for over a year. Items deleted on other devices since then may have come back.";
}

/** "removes 3 logged entries and restores 1 check-in": what undoing a sync does here. */
export function undoText(local: Counts): string {
  const per = (verbs: ('added' | 'updated' | 'deleted' | 'restored')[]) => {
    const n = new Map<DataTable, number>();
    for (const v of verbs) for (const [t, c] of byCount(local, v)) n.set(t, (n.get(t) ?? 0) + c);
    return [...n].sort((a, b) => b[1] - a[1]).map(([t, c]) => items(t, c));
  };
  const removes = per(['added', 'restored']);
  const restores = per(['updated', 'deleted']);
  return [removes.length ? `removes ${joinAnd(removes)}` : '', restores.length ? `restores ${joinAnd(restores)}` : ''].filter(Boolean).join(' and ');
}

/** Undo is offered only for a sync that changed this device. */
export const canUndo = (o: Finished) => o.kind !== 'up-to-date' && o.undo.length > 0 && totalCount(o.totals.local) > 0;
