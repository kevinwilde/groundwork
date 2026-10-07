import { GitHubError } from './github';
import type { Counts } from './merge';

export type SyncErrorCode =
  | 'offline'
  | 'auth'
  | 'no-access'
  | 'read-only'
  | 'rate-limited'
  | 'public'
  | 'archived'
  | 'not-groundwork'
  | 'newer-format'
  | 'bad-data'
  | 'no-branch'
  | 'busy'
  | 'storage'
  | 'github-down'
  | 'invalid'
  | 'too-many-files'
  | 'unknown'
  | 'classic-token'
  | 'bad-repo'
  | 'undo-stale';

export interface SyncErrorDetail {
  /** `bad-data`: the file, line and problem. */
  path?: string;
  line?: number;
  issue?: string;
  /** HTTP status, for `github-down`. */
  status?: number;
  /** `rate-limited`: when GitHub accepts requests again (ms). */
  retryAt?: number;
  /** `not-groundwork`: a file that shouldn't be there, e.g. package.json. */
  example?: string;
  /** Technical detail (GitHub's message, a storage error). Never contains the token. */
  message?: string;
}

export class SyncError extends Error {
  readonly code: SyncErrorCode;
  readonly detail: SyncErrorDetail;
  /** Changes that reached this device before the sync failed. */
  partial?: Counts;

  constructor(code: SyncErrorCode, detail: SyncErrorDetail = {}) {
    super(detail.path ? `${detail.path}, line ${detail.line}: ${detail.issue}` : (detail.message ?? code));
    this.name = 'SyncError';
    this.code = code;
    this.detail = detail;
  }
}

export const syncError = (code: SyncErrorCode, detail?: SyncErrorDetail) => new SyncError(code, detail);

export type ErrorAction = 'retry' | 'replace-token' | 'open-tokens' | 'open-repo-settings' | 'open-file';

export interface DescribeContext {
  /** This device's name, as in "Everything is still saved on this iPhone." */
  device: string;
  /** owner/name */
  repo: string;
  branch?: string;
  detail?: SyncErrorDetail;
  now?: number;
}

const noStop = (s: string) => s.trim().replace(/\.+$/, '');

function minutes(ms: number): string {
  const m = Math.max(1, Math.ceil(ms / 60_000));
  return m === 1 ? 'a minute' : `${m} minutes`;
}

/** The message and buttons for an error, worded for this device and repository. */
export function describeError(code: SyncErrorCode, { device, repo, branch = 'main', detail = {}, now = Date.now() }: DescribeContext): { message: string; actions: ErrorAction[] } {
  const name = repo.split('/')[1] || repo;
  switch (code) {
    case 'offline':
      return { message: `Couldn't reach GitHub. Check your connection and try again. Everything is still saved on this ${device}.`, actions: ['retry'] };
    case 'auth':
      return { message: `GitHub didn't accept this ${device}'s token. It may have expired or been deleted. Create a new token on GitHub, then choose Replace token.`, actions: ['replace-token', 'open-tokens', 'retry'] };
    case 'no-access':
      return { message: `Couldn't find ${repo}, or this token can't see it. Check the name, and that the token's Repository access includes it.`, actions: ['open-tokens', 'retry'] };
    case 'read-only':
      return { message: `This token can read ${repo} but can't change it. On GitHub, edit the token and set Contents to Read and write.`, actions: ['open-tokens', 'retry'] };
    case 'rate-limited': {
      const wait = (detail.retryAt ?? now) - now;
      return { message: `GitHub is limiting requests from your account. Sync will work again in about ${minutes(wait)}.`, actions: wait > 0 ? [] : ['retry'] };
    }
    case 'public':
      return {
        message: `${repo} is public, so anyone can read it. Nothing was uploaded. Make it private on GitHub (Settings → General → Danger Zone → Change visibility), then sync again.`,
        actions: ['open-repo-settings', 'retry'],
      };
    case 'archived':
      return { message: `${repo} is archived, so it can't be changed. Unarchive it on GitHub, or connect a different repository.`, actions: ['open-repo-settings', 'retry'] };
    case 'not-groundwork':
      return { message: `${repo} already has other files in it (such as ${detail.example ?? 'package.json'}). Create a new, empty private repository just for Groundwork data.`, actions: [] };
    case 'newer-format':
      return {
        message: `The data on GitHub was saved by a newer version of Groundwork. Update this ${device}: close Groundwork and open it again, and tap Reload if it offers a new version. Then sync again.`,
        actions: [],
      };
    case 'bad-data':
      return {
        message: `A file on GitHub isn't valid Groundwork data: ${detail.path}, line ${detail.line} (${detail.issue}). Nothing was changed. If it was edited by hand, undo that edit on GitHub.`,
        actions: ['open-file', 'retry'],
      };
    case 'no-branch':
      return { message: `Couldn't find the branch ${branch} in ${repo}. If you renamed or deleted it, disconnect and set up sync again.`, actions: [] };
    case 'busy':
      return { message: 'Another device kept syncing at the same time. Nothing was lost. Try again in a moment.', actions: ['retry'] };
    case 'storage':
      return { message: `Couldn't save on this ${device}: ${noStop(detail.message ?? 'the browser refused')}. Nothing was changed here or on GitHub.`, actions: ['retry'] };
    case 'github-down':
      return { message: `GitHub isn't responding properly right now (${detail.status ?? 'error'}). Try again in a few minutes.`, actions: ['retry'] };
    case 'classic-token':
      return { message: `That's a classic token (ghp_…), which can reach every repository you have. Create a fine-grained token limited to ${name} instead.`, actions: [] };
    case 'bad-repo':
      return { message: 'Enter the repository as owner/name, for example kevinwilde/groundwork-data.', actions: [] };
    case 'undo-stale':
      return { message: `Something changed on this ${device} after the sync, so it can't be undone.`, actions: [] };
    default:
      return { message: `Sync failed: ${noStop(detail.message ?? code)}. Try again. If it keeps happening, export a backup.`, actions: ['retry'] };
  }
}

/** Any failure as a SyncError. GitHub errors keep their status and retry time; nothing carries the token. */
export function asSyncError(e: unknown): SyncError {
  if (e instanceof SyncError) return e;
  if (e instanceof GitHubError) {
    const detail = { message: e.message, status: e.status, retryAt: e.retryAt };
    switch (e.code) {
      case 'offline':
      case 'auth':
      case 'rate-limited':
      case 'read-only':
      case 'no-access':
      case 'github-down':
      case 'invalid':
        return syncError(e.code, detail);
      case 'empty':
      case 'conflict':
        return syncError('busy', detail);
      case 'missing':
        return syncError('no-branch', detail);
      default:
        return syncError('unknown', detail);
    }
  }
  return syncError('unknown', { message: e instanceof Error ? e.message : String(e) });
}
