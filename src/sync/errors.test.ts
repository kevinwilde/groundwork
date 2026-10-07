import { describe, expect, it } from 'vitest';
import { asSyncError, describeError, SyncError, type SyncErrorCode } from './errors';
import { GitHubError } from './github';

const ctx = { device: 'iPhone', repo: 'kevinwilde/groundwork-data', branch: 'main', now: 1_000_000 };

describe('error wording', () => {
  it('names the device, repository and branch', () => {
    expect(describeError('offline', ctx)).toEqual({ message: "Couldn't reach GitHub. Check your connection and try again. Everything is still saved on this iPhone.", actions: ['retry'] });
    expect(describeError('auth', ctx).message).toBe("GitHub didn't accept this iPhone's token. It may have expired or been deleted. Create a new token on GitHub, then choose Replace token.");
    expect(describeError('auth', ctx).actions).toEqual(['replace-token', 'open-tokens', 'retry']);
    expect(describeError('no-branch', ctx).message).toBe("Couldn't find the branch main in kevinwilde/groundwork-data. If you renamed or deleted it, disconnect and set up sync again.");
    expect(describeError('classic-token', ctx).message).toBe("That's a classic token (ghp_…), which can reach every repository you have. Create a fine-grained token limited to groundwork-data instead.");
    expect(describeError('not-groundwork', { ...ctx, detail: { example: 'src/main.ts' } }).message).toContain('(such as src/main.ts)');
  });

  it('says when a rate limit ends, and offers Try again only after it', () => {
    expect(describeError('rate-limited', { ...ctx, detail: { retryAt: 1_000_000 + 11.5 * 60_000 } })).toEqual({
      message: 'GitHub is limiting requests from your account. Sync will work again in about 12 minutes.',
      actions: [],
    });
    expect(describeError('rate-limited', { ...ctx, detail: { retryAt: 900_000 } }).actions).toEqual(['retry']);
  });

  it('fills in details', () => {
    expect(describeError('bad-data', { ...ctx, detail: { path: 'entries/2026-10.jsonl', line: 14, issue: 'date: dates must look like 2026-09-25' } }).message).toBe(
      "A file on GitHub isn't valid Groundwork data: entries/2026-10.jsonl, line 14 (date: dates must look like 2026-09-25). Nothing was changed. If it was edited by hand, undo that edit on GitHub.",
    );
    expect(describeError('storage', { ...ctx, detail: { message: 'The quota has been exceeded.' } }).message).toBe("Couldn't save on this iPhone: The quota has been exceeded. Nothing was changed here or on GitHub.");
    expect(describeError('github-down', { ...ctx, detail: { status: 502 } }).message).toBe("GitHub isn't responding properly right now (502). Try again in a few minutes.");
    expect(describeError('too-many-files', { ...ctx, detail: { message: 'too many' } }).message).toBe('Sync failed: too many. Try again. If it keeps happening, export a backup.');
  });

  it('has wording for every code', () => {
    const codes: SyncErrorCode[] = ['offline', 'auth', 'no-access', 'read-only', 'rate-limited', 'public', 'archived', 'not-groundwork', 'newer-format', 'bad-data', 'no-branch', 'busy', 'storage', 'github-down', 'invalid', 'too-many-files', 'unknown', 'classic-token', 'bad-repo', 'undo-stale'];
    for (const code of codes) expect(describeError(code, ctx).message.length).toBeGreaterThan(20);
  });

  it('converts GitHub errors', () => {
    expect(asSyncError(new GitHubError('rate-limited', 'x', { status: 403, retryAt: 5 }))).toMatchObject({ code: 'rate-limited', detail: { retryAt: 5, status: 403 } });
    expect(asSyncError(new GitHubError('conflict', 'x')).code).toBe('busy');
    expect(asSyncError(new Error('odd')).detail.message).toBe('odd');
    const e = new SyncError('public');
    expect(asSyncError(e)).toBe(e);
  });
});
