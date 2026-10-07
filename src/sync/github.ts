/**
 * The GitHub REST API, called straight from the browser (api.github.com allows CORS). Only the
 * endpoints sync needs, all scoped to one repository. The token goes in the Authorization header
 * and nowhere else: never in URLs, and never in error messages.
 */

const API = 'https://api.github.com';
export const API_VERSION = '2026-03-10';
const TIMEOUT = 20_000;
/** Inline content per tree request; bigger uploads chain several trees through `base_tree`. */
export const TREE_BATCH_BYTES = 1024 * 1024;

export type GitHubErrorCode = 'offline' | 'cancelled' | 'auth' | 'rate-limited' | 'read-only' | 'no-access' | 'missing' | 'empty' | 'conflict' | 'invalid' | 'github-down';

export class GitHubError extends Error {
  readonly code: GitHubErrorCode;
  readonly status?: number;
  /** For `rate-limited`: when requests will be accepted again (ms). */
  readonly retryAt?: number;

  constructor(code: GitHubErrorCode, message: string, extra: { status?: number; retryAt?: number } = {}) {
    super(message);
    this.name = 'GitHubError';
    this.code = code;
    this.status = extra.status;
    this.retryAt = extra.retryAt;
  }
}

export interface RepoInfo {
  fullName: string;
  private: boolean;
  archived: boolean;
  defaultBranch: string;
  htmlUrl: string;
}

export interface CommitInfo {
  sha: string;
  tree: string;
  message: string;
  /** Committer date (ms). */
  date: number;
  parents: string[];
}

export interface TreeItem {
  path: string;
  type: 'blob' | 'tree' | 'commit';
  sha: string;
}

/** A file to write (inline content) or delete (`sha: null`) in a new tree. */
export type TreeChange = { path: string; mode: '100644'; type: 'blob'; content: string } | { path: string; mode: '100644'; type: 'blob'; sha: null };

export interface Author {
  name: string;
  email: string;
}

export interface GitHubApi {
  readonly fullName: string;
  getRepo(): Promise<RepoInfo>;
  /** The branch head, or null when there's no such branch. Throws `empty` for an empty repository. */
  getRef(branch: string): Promise<string | null>;
  getCommit(sha: string): Promise<CommitInfo>;
  getTree(sha: string): Promise<{ items: TreeItem[]; truncated: boolean }>;
  /** A file's text (raw media type, decoded as UTF-8). */
  getBlob(sha: string): Promise<string>;
  createBlob(text: string): Promise<string>;
  /** One tree on top of `base`, chained through several requests when the content passes 1 MB. */
  createTree(base: string, changes: TreeChange[]): Promise<string>;
  createCommit(commit: { message: string; tree: string; parents: string[]; author?: Author }): Promise<{ sha: string; htmlUrl: string }>;
  /** Compare-and-swap: refused (`conflict`) unless the commit is a fast-forward of the branch head. */
  updateRef(branch: string, sha: string): Promise<void>;
  /** Contents API, the only way to make the first commit in an empty repository. Default branch. */
  putFile(path: string, text: string, message: string): Promise<void>;
}

export interface GitHubOptions {
  owner: string;
  repo: string;
  token: string;
  fetch?: typeof fetch;
  /** The user's Cancel. */
  signal?: AbortSignal;
  timeout?: number;
  now?: () => number;
}

const segments = (path: string) => path.split('/').map(encodeURIComponent).join('/');

function base64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Anything that looks like a token, removed from text that may be shown or logged. */
const redact = (text: string, token: string) => (token ? text.split(token).join('…') : text).replace(/\b(?:github_pat_|gh[pousr]_)[A-Za-z0-9_]+/g, '…');

interface RequestOptions {
  body?: unknown;
  raw?: boolean;
  /** Writes map 403 to `read-only` instead of `no-access`. */
  write?: boolean;
  /** 404 means "not there" (a missing branch) rather than "can't see the repository". */
  missingOk?: boolean;
}

export function createGitHub(opts: GitHubOptions): GitHubApi {
  let owner = opts.owner;
  let repo = opts.repo;
  const { token, signal, timeout = TIMEOUT, now = Date.now } = opts;
  const doFetch: typeof fetch = opts.fetch ?? ((input, init) => fetch(input, init));
  // GitHub may refuse the unlinked author address; then commits use the token owner's identity.
  let authorRejected = false;

  async function request(method: string, path: string, ro: RequestOptions = {}): Promise<Response> {
    const where = `${method} /repos/${owner}/${repo}${path}`;
    const headers: Record<string, string> = {
      Accept: ro.raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': API_VERSION,
    };
    if (ro.body !== undefined) headers['Content-Type'] = 'application/json';
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeout);
    const cancel = () => ctl.abort();
    signal?.addEventListener('abort', cancel);
    let res: Response;
    try {
      // no-store: GitHub sends max-age=60 on refs, and a cached head would loop on conflicts for a minute.
      res = await doFetch(`${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}${path}`, {
        method,
        headers,
        body: ro.body === undefined ? undefined : JSON.stringify(ro.body),
        cache: 'no-store',
        credentials: 'omit',
        signal: ctl.signal,
      });
    } catch {
      if (signal?.aborted) throw new GitHubError('cancelled', 'Sync was cancelled.');
      throw new GitHubError('offline', `Couldn't reach GitHub (${where}).`);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
    }
    if (res.ok) return res;
    throw await toError(res, method, path, where, ro);
  }

  async function toError(res: Response, method: string, path: string, where: string, ro: RequestOptions): Promise<GitHubError> {
    const status = res.status;
    let message = '';
    try {
      const body = (await res.json()) as { message?: unknown };
      if (typeof body?.message === 'string') message = redact(body.message, token);
    } catch {
      /* not JSON */
    }
    const text = `GitHub ${status} on ${where}${message ? `: ${message}` : ''}`;
    const isRef = method === 'PATCH' && path.startsWith('/git/refs/');
    const remaining = res.headers.get('x-ratelimit-remaining');
    const retryAfter = res.headers.get('retry-after');
    const reset = res.headers.get('x-ratelimit-reset');
    if (status === 401) return new GitHubError('auth', text, { status });
    if ((status === 403 || status === 429) && (remaining === '0' || retryAfter !== null || /rate limit/i.test(message))) {
      const retryAt = retryAfter !== null ? now() + Number(retryAfter) * 1000 : reset !== null ? Number(reset) * 1000 : now() + 60_000;
      return new GitHubError('rate-limited', text, { status, retryAt });
    }
    if (status === 403) return new GitHubError(ro.write ? 'read-only' : 'no-access', text, { status });
    if (status === 404) return new GitHubError(ro.missingOk ? 'missing' : 'no-access', text, { status });
    if (status === 409) return new GitHubError(isRef ? 'conflict' : 'empty', text, { status });
    if (status === 422) return new GitHubError(isRef ? 'conflict' : 'invalid', text, { status });
    if (status >= 500) return new GitHubError('github-down', text, { status });
    return new GitHubError('invalid', text, { status });
  }

  const json = async <T>(res: Response) => (await res.json()) as T;

  async function createTreeOnce(base: string, tree: TreeChange[]): Promise<string> {
    return (await json<{ sha: string }>(await request('POST', '/git/trees', { body: { base_tree: base, tree }, write: true }))).sha;
  }

  return {
    get fullName() {
      return `${owner}/${repo}`;
    },

    async getRepo() {
      const r = await json<{ full_name: string; private: boolean; archived: boolean; default_branch: string; html_url: string }>(await request('GET', ''));
      // A renamed repository redirects; follow the new name from now on.
      const [o, n] = r.full_name.split('/');
      if (o && n) [owner, repo] = [o, n];
      return { fullName: r.full_name, private: r.private === true, archived: r.archived === true, defaultBranch: r.default_branch, htmlUrl: r.html_url };
    },

    async getRef(branch) {
      try {
        return (await json<{ object: { sha: string } }>(await request('GET', `/git/ref/heads/${segments(branch)}`, { missingOk: true }))).object.sha;
      } catch (e) {
        if (e instanceof GitHubError && e.code === 'missing') return null;
        throw e;
      }
    },

    async getCommit(sha) {
      const c = await json<{ sha: string; tree: { sha: string }; message: string; committer: { date: string }; parents: { sha: string }[] }>(await request('GET', `/git/commits/${sha}`));
      return { sha: c.sha, tree: c.tree.sha, message: c.message, date: Date.parse(c.committer.date), parents: c.parents.map((p) => p.sha) };
    },

    async getTree(sha) {
      const t = await json<{ tree: TreeItem[]; truncated: boolean }>(await request('GET', `/git/trees/${sha}?recursive=1`));
      return { items: t.tree.map(({ path, type, sha: s }) => ({ path, type, sha: s })), truncated: t.truncated === true };
    },

    async getBlob(sha) {
      return (await request('GET', `/git/blobs/${sha}`, { raw: true })).text();
    },

    async createBlob(text) {
      return (await json<{ sha: string }>(await request('POST', '/git/blobs', { body: { content: text, encoding: 'utf-8' }, write: true }))).sha;
    },

    async createTree(base, changes) {
      let tree = base;
      let batch: TreeChange[] = [];
      let bytes = 0;
      for (const change of changes) {
        const size = 'content' in change ? new TextEncoder().encode(change.content).byteLength : 0;
        if (batch.length && bytes + size > TREE_BATCH_BYTES) {
          tree = await createTreeOnce(tree, batch);
          batch = [];
          bytes = 0;
        }
        batch.push(change);
        bytes += size;
      }
      if (batch.length) tree = await createTreeOnce(tree, batch);
      return tree;
    },

    async createCommit({ message, tree, parents, author }) {
      const post = async (withAuthor: boolean) =>
        json<{ sha: string; html_url: string }>(await request('POST', '/git/commits', { body: { message, tree, parents, ...(withAuthor && author ? { author } : {}) }, write: true }));
      let c: { sha: string; html_url: string };
      try {
        c = await post(!authorRejected);
      } catch (e) {
        if (!(e instanceof GitHubError && e.status === 422 && author && !authorRejected)) throw e;
        authorRejected = true;
        c = await post(false);
      }
      return { sha: c.sha, htmlUrl: c.html_url };
    },

    async updateRef(branch, sha) {
      // force: false is the compare-and-swap. Nothing in Groundwork ever sends force: true.
      await request('PATCH', `/git/refs/heads/${segments(branch)}`, { body: { sha, force: false }, write: true });
    },

    async putFile(path, text, message) {
      await request('PUT', `/contents/${segments(path)}`, { body: { message, content: base64(text) }, write: true });
    },
  };
}
