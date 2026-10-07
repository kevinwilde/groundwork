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
