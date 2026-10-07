import { beforeEach, describe, expect, it } from 'vitest';
import { FakeGitHub, type Route } from '../test/fakeGitHub';
import { blobSha } from './gitsha';
import { API_VERSION, createGitHub, GitHubError, type GitHubApi } from './github';

const TOKEN = 'github_pat_11ABCDEFG0123456789_secretsecretsecret';
let fake: FakeGitHub;
let gh: GitHubApi;

beforeEach(async () => {
  fake = new FakeGitHub();
  fake.now = () => 1_791_380_000_000;
  gh = createGitHub({ owner: 'kevinwilde', repo: 'groundwork-data', token: TOKEN, fetch: fake.fetch, now: () => 1_791_380_000_000 });
});

async function failure(p: Promise<unknown>): Promise<GitHubError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(GitHubError);
    return e as GitHubError;
  }
  throw new Error('expected a GitHubError');
}

describe('GitHub client', () => {
  it('reads an empty repository, then makes its first commit with the Contents API', async () => {
    expect(await gh.getRepo()).toEqual({ fullName: 'kevinwilde/groundwork-data', private: true, archived: false, defaultBranch: 'main', htmlUrl: 'https://github.com/kevinwilde/groundwork-data' });
    expect((await failure(gh.getRef('main'))).code).toBe('empty');
    await gh.putFile('README.md', '# Grüße\n', 'Set up Groundwork sync');
    expect(fake.files()).toEqual(new Map([['README.md', '# Grüße\n']]));
    const head = (await gh.getRef('main'))!;
    const commit = await gh.getCommit(head);
    expect(commit).toMatchObject({ message: 'Set up Groundwork sync', parents: [], date: 1_791_380_000_000 });
    const tree = await gh.getTree(commit.tree);
    expect(tree).toEqual({ items: [{ path: 'README.md', type: 'blob', sha: await blobSha('# Grüße\n') }], truncated: false });
    expect(await gh.getBlob(tree.items[0].sha)).toBe('# Grüße\n');
    expect(fake.requests('putFile')[0].body).toMatchObject({ content: btoa(String.fromCharCode(...new TextEncoder().encode('# Grüße\n'))) });
    expect(await gh.getRef('other')).toBeNull();
  });

  it('commits a tree and moves the branch only by fast-forward', async () => {
    const first = await fake.commitFiles({ 'a.jsonl': 'a\n' });
    const base = fake.commits.get(first)!.tree;
    const tree = await gh.createTree(base, [
      { path: 'entries/2026-10.jsonl', mode: '100644', type: 'blob', content: 'x\n' },
      { path: 'a.jsonl', mode: '100644', type: 'blob', sha: null },
    ]);
    const c = await gh.createCommit({ message: 'Mac: added 1 entry', tree, parents: [first], author: { name: 'Groundwork (Mac)', email: 'sync@groundwork.invalid' } });
    expect(c.htmlUrl).toBe(`https://github.com/kevinwilde/groundwork-data/commit/${c.sha}`);
    await gh.updateRef('main', c.sha);
    expect(fake.files()).toEqual(new Map([['entries/2026-10.jsonl', 'x\n']]));
    expect(fake.history().map((x) => x.author?.email)).toEqual(['sync@groundwork.invalid', undefined]);

    // A commit that isn't on top of the current head is refused.
    const stale = await gh.createCommit({ message: 'stale', tree: base, parents: [first] });
    expect((await failure(gh.updateRef('main', stale.sha))).code).toBe('conflict');
    expect(fake.requests('updateRef').every((r) => (r.body as { force: boolean }).force === false)).toBe(true);
  });

  it('retries a commit without the custom author when GitHub rejects it', async () => {
    const first = await fake.commitFiles({ 'a.jsonl': 'a\n' });
    fake.rejectAuthor = true;
    const c = await gh.createCommit({ message: 'm', tree: fake.commits.get(first)!.tree, parents: [first], author: { name: 'x', email: 'sync@groundwork.invalid' } });
    expect(fake.commits.get(c.sha)!.author).toBeUndefined();
    await gh.createCommit({ message: 'm2', tree: fake.commits.get(first)!.tree, parents: [first], author: { name: 'x', email: 'sync@groundwork.invalid' } });
    // Remembered: the second commit doesn't try the author again.
    expect(fake.requests('createCommit').map((r) => 'author' in (r.body as object))).toEqual([true, false, false]);
  });

  it('chains tree requests in batches of at most 1 MB of content', async () => {
    const first = await fake.commitFiles({ 'a.jsonl': 'a\n' });
    const big = 'x'.repeat(400 * 1024);
    const changes = Array.from({ length: 6 }, (_, i) => ({ path: `entries/2026-0${i + 1}.jsonl`, mode: '100644' as const, type: 'blob' as const, content: big }));
    const tree = await gh.createTree(fake.commits.get(first)!.tree, changes);
    expect(fake.requests('createTree')).toHaveLength(3);
    expect(fake.trees.get(tree)!.size).toBe(7);
    expect(await gh.createTree(tree, [])).toBe(tree);
  });

  it('maps responses to error codes', async () => {
    await fake.commitFiles({ 'a.jsonl': 'a\n' });
    const cases: [number, string, Route, () => Promise<unknown>][] = [
      [401, 'auth', 'getRepo', () => gh.getRepo()],
      [403, 'no-access', 'getTree', () => gh.getTree('abc')],
      [403, 'read-only', 'createBlob', () => gh.createBlob('x')],
      [404, 'no-access', 'getRepo', () => gh.getRepo()],
      [404, 'no-access', 'createBlob', () => gh.createBlob('x')],
      [409, 'empty', 'getCommit', () => gh.getCommit('abc')],
      [409, 'conflict', 'updateRef', () => gh.updateRef('main', 'abc')],
      [422, 'conflict', 'updateRef', () => gh.updateRef('main', 'abc')],
      [422, 'invalid', 'createCommit', () => gh.createCommit({ message: 'm', tree: 'abc', parents: [] })],
      [500, 'github-down', 'getRepo', () => gh.getRepo()],
      [503, 'github-down', 'getBlob', () => gh.getBlob('abc')],
    ];
    for (const [status, code, route, call] of cases) {
      fake.failNext(route, { status, body: { message: `nope ${status}` } });
      const e = await failure(call());
      expect([status, route, e.code]).toEqual([status, route, code]);
      expect(e.status).toBe(status);
      expect(e.message).toContain(`nope ${status}`);
    }
  });

  it('maps real permission states', async () => {
    await fake.commitFiles({ 'a.jsonl': 'a\n' });
    const as = (state: 'expired' | 'read-only' | 'no-access') => {
      fake.tokens.set(TOKEN, state);
      return gh;
    };
    expect((await failure(as('expired').getRepo())).code).toBe('auth');
    expect((await failure(as('no-access').getRepo())).code).toBe('no-access');
    expect(await as('read-only').getRef('main')).toBe(fake.head());
    expect((await failure(as('read-only').createBlob('probe'))).code).toBe('read-only');
    fake.tokens.clear();
    fake.archived = true;
    expect((await failure(gh.createBlob('probe'))).code).toBe('read-only');
  });

  it('takes retryAt from retry-after or x-ratelimit-reset', async () => {
    fake.failNext('getRepo', FakeGitHub.rateLimited(1_791_380_600_000));
    const a = await failure(gh.getRepo());
    expect([a.code, a.retryAt]).toEqual(['rate-limited', 1_791_380_600_000]);
    fake.failNext('getRepo', FakeGitHub.rateLimited(1_791_380_600_000, 90));
    expect((await failure(gh.getRepo())).retryAt).toBe(1_791_380_000_000 + 90_000);
    fake.failNext('getRepo', { status: 429, body: { message: 'slow down' }, headers: { 'retry-after': '30' } });
    expect((await failure(gh.getRepo())).code).toBe('rate-limited');
    fake.failNext('getRepo', { status: 403, body: { message: 'You have exceeded a secondary rate limit.' } });
    expect((await failure(gh.getRepo())).code).toBe('rate-limited');
  });

  it('maps network errors to offline', async () => {
    fake.failNext('getRef', 'network');
    expect((await failure(gh.getRef('main'))).code).toBe('offline');
    const slow = createGitHub({ owner: 'o', repo: 'r', token: TOKEN, timeout: 5, fetch: (_u, init) => new Promise((_, reject) => init!.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))) });
    expect((await failure(slow.getRepo())).code).toBe('offline');
  });

  it('sends the API headers on every request, skips the HTTP cache, and omits cookies', async () => {
    await gh.getRepo();
    await failure(gh.getRef('main'));
    await gh.putFile('README.md', 'x\n', 'm');
    const head = (await gh.getRef('main'))!;
    await gh.getBlob((await gh.getTree((await gh.getCommit(head)).tree)).items[0].sha);
    await gh.createBlob('probe');
    expect(fake.log.length).toBe(8);
    for (const r of fake.log) {
      expect(r.headers.authorization).toBe(`Bearer ${TOKEN}`);
      expect(r.headers['x-github-api-version']).toBe(API_VERSION);
      expect(r.headers.accept).toBe(r.route === 'getBlob' ? 'application/vnd.github.raw+json' : 'application/vnd.github+json');
      expect(r.cache).toBe('no-store');
      expect(r.credentials).toBe('omit');
      expect(r.path).not.toContain(TOKEN);
      if (r.body) expect(r.headers['content-type']).toBe('application/json');
    }
  });

  it('never puts the token in an error', async () => {
    const errors: GitHubError[] = [];
    fake.failNext('getRepo', { status: 422, body: { message: `token ${TOKEN} is odd, so is ghp_abcdef123` } });
    errors.push(await failure(gh.getRepo()));
    fake.failNext('getRepo', 'network');
    errors.push(await failure(gh.getRepo()));
    fake.tokens.set(TOKEN, 'expired');
    errors.push(await failure(gh.getRepo()));
    for (const e of errors) {
      expect(String(e)).not.toContain('github_pat_');
      expect(e.message).not.toContain('github_pat_');
      expect(e.message).not.toContain('ghp_');
      expect(JSON.stringify(e)).not.toContain('github_pat_');
    }
  });
});
