import { blobSha } from '../sync/gitsha';

/**
 * An in-memory GitHub behind a `fetch` function, implementing exactly the endpoints in
 * src/sync/github.ts. Blobs use real git SHA-1 ids, so the download skip is tested for real; trees and
 * commits are content-addressed. `PATCH ref` does a real fast-forward check. Tests can inject failures
 * and run code before a request (interleavings). Used by the sync tests, and in `npm run dev` through
 * the dev-only `?fakeGitHub` switch. Never touches the network.
 */

export type Route = 'getRepo' | 'getRef' | 'getCommit' | 'getTree' | 'getBlob' | 'createBlob' | 'createTree' | 'createCommit' | 'updateRef' | 'putFile';
export type TokenState = 'valid' | 'expired' | 'read-only' | 'no-access';
/** A canned response, a network error, or `lost`: the request takes effect but the response never arrives. */
export type Canned = { status: number; body?: unknown; headers?: Record<string, string> } | 'network' | 'lost';
export type Hook = (req: LoggedRequest) => void | Promise<void>;

export interface LoggedRequest {
  route: Route | 'unknown';
  method: string;
  /** Relative to the repository, e.g. `/git/ref/heads/main`. */
  path: string;
  headers: Record<string, string>;
  cache?: RequestCache;
  credentials?: RequestCredentials;
  body?: unknown;
  status?: number;
}

interface CommitObject {
  sha: string;
  tree: string;
  parents: string[];
  message: string;
  author?: { name: string; email: string };
  date: string;
}

const ROUTES: [string, RegExp, Route][] = [
  ['GET', /^$/, 'getRepo'],
  ['GET', /^\/git\/ref\/heads\/(.+)$/, 'getRef'],
  ['GET', /^\/git\/commits\/([0-9a-f]+)$/, 'getCommit'],
  ['GET', /^\/git\/trees\/([0-9a-f]+)(\?recursive=1)?$/, 'getTree'],
  ['GET', /^\/git\/blobs\/([0-9a-f]+)$/, 'getBlob'],
  ['POST', /^\/git\/blobs$/, 'createBlob'],
  ['POST', /^\/git\/trees$/, 'createTree'],
  ['POST', /^\/git\/commits$/, 'createCommit'],
  ['PATCH', /^\/git\/refs\/heads\/(.+)$/, 'updateRef'],
  ['PUT', /^\/contents\/(.+)$/, 'putFile'],
];
const WRITES = new Set<Route>(['createBlob', 'createTree', 'createCommit', 'updateRef', 'putFile']);

function fromBase64(b64: string): string {
  const bin = atob(b64);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

const reply = (status: number, body?: unknown, headers: Record<string, string> = {}) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });

class HttpError {
  constructor(
    readonly status: number,
    readonly message: string,
  ) {}
}

export class FakeGitHub {
  owner = 'kevinwilde';
  name = 'groundwork-data';
  private = true;
  archived = false;
  defaultBranch = 'main';
  /** Accept any owner/name (the dev switch): the repository takes the name it is asked for. */
  anyRepo = false;
  /** Make the commit endpoint refuse custom authors, as GitHub may for an unverified address. */
  rejectAuthor = false;
  /** Report the tree listing as truncated. */
  truncate = false;
  /** Fail this share of requests at random, for chaos tests: a 500, a network error, or a lost response. */
  chaos: { rate: number; random: () => number } | null = null;
  tokens = new Map<string, TokenState>();
  now: () => number = () => Date.now();

  blobs = new Map<string, string>();
  /** Flattened trees: path to blob sha. */
  trees = new Map<string, Map<string, string>>();
  commits = new Map<string, CommitObject>();
  refs = new Map<string, string>();
  log: LoggedRequest[] = [];
  forcedUpdates = 0;

  private failures = new Map<Route, Canned[]>();
  private hooks = new Map<Route, { fn: Hook; once: boolean }[]>();
  private counter = 0;

  get fullName() {
    return `${this.owner}/${this.name}`;
  }
  get empty() {
    return this.refs.size === 0;
  }
  head(branch = this.defaultBranch) {
    return this.refs.get(branch) ?? null;
  }

  /** The next request to `route` gets this instead. Queued in order. */
  failNext(route: Route, response: Canned) {
    this.failures.set(route, [...(this.failures.get(route) ?? []), response]);
  }

  /** Run `fn` before the next request to `route` is handled (or every one, with `once: false`). */
  before(route: Route, fn: Hook, { once = true } = {}) {
    this.hooks.set(route, [...(this.hooks.get(route) ?? []), { fn, once }]);
  }

  clearHooks() {
    this.hooks.clear();
    this.failures.clear();
  }

  /** A rate-limit response, with the headers GitHub exposes to CORS. */
  static rateLimited(resetAt: number, retryAfter?: number): Canned {
    return {
      status: 403,
      body: { message: 'API rate limit exceeded for user ID 1.' },
      headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.floor(resetAt / 1000)), ...(retryAfter !== undefined ? { 'retry-after': String(retryAfter) } : {}) },
    };
  }

  tokenState(token: string): TokenState {
    const set = this.tokens.get(token);
    if (set) return set;
    // Conventions, handy in the browser: a token containing "expired", "readonly" or "noaccess" behaves that way.
    if (/expired/i.test(token)) return 'expired';
    if (/readonly/i.test(token)) return 'read-only';
    if (/noaccess/i.test(token)) return 'no-access';
    return 'valid';
  }

  requests(route?: Route) {
    return route ? this.log.filter((r) => r.route === route) : this.log;
  }

  /** The files on a branch, path to text. */
  files(branch = this.defaultBranch): Map<string, string> {
    const head = this.head(branch);
    if (!head) return new Map();
    const tree = this.trees.get(this.commits.get(head)!.tree)!;
    return new Map([...tree].sort(([a], [b]) => (a < b ? -1 : 1)).map(([p, sha]) => [p, this.blobs.get(sha)!]));
  }

  /** Commits on a branch, newest first, following first parents. */
  history(branch = this.defaultBranch): CommitObject[] {
    const out: CommitObject[] = [];
    for (let sha = this.head(branch); sha; sha = this.commits.get(sha)!.parents[0] ?? null) out.push(this.commits.get(sha)!);
    return out;
  }

  /** Write files straight into a new commit on the branch (a hand edit, or a repository with other content). */
  async commitFiles(files: Record<string, string | null>, message = 'Edit on GitHub', branch = this.defaultBranch): Promise<string> {
    const head = this.head(branch);
    const tree = new Map(head ? this.trees.get(this.commits.get(head)!.tree)! : []);
    for (const [path, text] of Object.entries(files)) {
      if (text === null) tree.delete(path);
      else tree.set(path, await this.storeBlob(text));
    }
    const sha = await this.storeCommit(await this.storeTree(tree), head ? [head] : [], message);
    this.refs.set(branch, sha);
    return sha;
  }

  fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = (init.method ?? 'GET').toUpperCase();
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((v, k) => (headers[k] = v));
    const m = /^\/repos\/([^/]+)\/([^/]+)(.*)$/.exec(url.pathname);
    if (url.origin !== 'https://api.github.com' || !m) throw new TypeError('Failed to fetch');
    const [, owner, name, rest] = m;
    const path = decodeURI(rest) + url.search;
    const match = ROUTES.find(([mth, re]) => mth === method && re.test(path));
    const route = match?.[2] ?? 'unknown';
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    const entry: LoggedRequest = { route, method, path, headers, cache: init.cache, credentials: init.credentials, body };
    this.log.push(entry);

    if (route !== 'unknown') {
      const hooks = this.hooks.get(route) ?? [];
      this.hooks.set(
        route,
        hooks.filter((h) => !h.once),
      );
      for (const h of hooks) await h.fn(entry);
    }

    let canned = route !== 'unknown' ? this.failures.get(route)?.shift() : undefined;
    if (!canned && this.chaos && route !== 'unknown' && this.chaos.random() < this.chaos.rate) {
      const pick = this.chaos.random();
      canned = pick < 0.4 ? { status: 500, body: { message: 'Server Error' } } : pick < 0.7 || !WRITES.has(route) ? 'network' : 'lost';
    }
    if (canned === 'network') throw new TypeError('Failed to fetch');
    if (canned && canned !== 'lost') {
      entry.status = canned.status;
      return reply(canned.status, canned.body, canned.headers);
    }

    let res: Response;
    try {
      res = await this.handle(route, owner, name, path, headers, body);
    } catch (e) {
      if (!(e instanceof HttpError)) throw e;
      res = reply(e.status, { message: e.message, documentation_url: 'https://docs.github.com/rest' });
    }
    entry.status = res.status;
    if (canned === 'lost') throw new TypeError('Failed to fetch');
    return res;
  };

  private async handle(route: Route | 'unknown', owner: string, name: string, path: string, headers: Record<string, string>, body: any): Promise<Response> {
    const auth = /^Bearer (.+)$/.exec(headers.authorization ?? '');
    if (!auth) throw new HttpError(401, 'Requires authentication');
    const token = this.tokenState(auth[1]);
    if (token === 'expired') throw new HttpError(401, 'Bad credentials');
    if (this.anyRepo) [this.owner, this.name] = [owner, name];
    if (token === 'no-access' || `${owner}/${name}`.toLowerCase() !== this.fullName.toLowerCase()) throw new HttpError(404, 'Not Found');
    if (route === 'unknown') throw new HttpError(404, 'Not Found');
    const write = WRITES.has(route);
    if (write && token === 'read-only') throw new HttpError(403, 'Resource not accessible by personal access token');
    if (write && this.archived) throw new HttpError(403, 'Repository was archived so is read-only.');
    const arg = ROUTES.find(([, , r]) => r === route)![1].exec(path)?.[1] ?? '';
    const empty = () => {
      if (this.empty) throw new HttpError(409, 'Git Repository is empty.');
    };

    switch (route) {
      case 'getRepo':
        return reply(200, { full_name: this.fullName, private: this.private, archived: this.archived, default_branch: this.defaultBranch, html_url: `https://github.com/${this.fullName}` });
      case 'getRef': {
        empty();
        const sha = this.refs.get(arg);
        if (!sha) throw new HttpError(404, 'Not Found');
        return reply(200, { ref: `refs/heads/${arg}`, object: { sha, type: 'commit' } });
      }
      case 'getCommit': {
        empty();
        const c = this.commits.get(arg);
        if (!c) throw new HttpError(404, 'Not Found');
        return reply(200, { sha: c.sha, tree: { sha: c.tree }, message: c.message, committer: { date: c.date }, parents: c.parents.map((sha) => ({ sha })), html_url: this.commitUrl(c.sha) });
      }
      case 'getTree': {
        empty();
        const tree = this.trees.get(arg);
        if (!tree) throw new HttpError(404, 'Not Found');
        const dirs = new Set<string>();
        for (const p of tree.keys()) for (let i = p.indexOf('/'); i > 0; i = p.indexOf('/', i + 1)) dirs.add(p.slice(0, i));
        const items = [
          ...[...dirs].map((p) => ({ path: p, mode: '040000', type: 'tree', sha: '0'.repeat(40) })),
          ...[...tree].map(([p, sha]) => ({ path: p, mode: '100644', type: 'blob', sha, size: this.blobs.get(sha)!.length })),
        ].sort((a, b) => (a.path < b.path ? -1 : 1));
        return reply(200, { sha: arg, tree: items, truncated: this.truncate });
      }
      case 'getBlob': {
        empty();
        const text = this.blobs.get(arg);
        if (text === undefined) throw new HttpError(404, 'Not Found');
        if (headers.accept === 'application/vnd.github.raw+json') return new Response(text, { status: 200 });
        return reply(200, { sha: arg, encoding: 'base64', content: btoa(String.fromCharCode(...new TextEncoder().encode(text))) });
      }
      case 'createBlob': {
        empty();
        return reply(201, { sha: await this.storeBlob(body.encoding === 'base64' ? fromBase64(body.content) : body.content) });
      }
      case 'createTree': {
        empty();
        const base = this.trees.get(body.base_tree);
        if (!base) throw new HttpError(422, 'Invalid tree info');
        const tree = new Map(base);
        for (const e of body.tree as { path: string; content?: string; sha?: string | null }[]) {
          if (typeof e.content === 'string') tree.set(e.path, await this.storeBlob(e.content));
          else if (e.sha === null) {
            if (!tree.delete(e.path)) throw new HttpError(422, `Could not delete ${e.path}: not in the tree`);
          } else if (e.sha && this.blobs.has(e.sha)) tree.set(e.path, e.sha);
          else throw new HttpError(422, 'Invalid tree info');
        }
        return reply(201, { sha: await this.storeTree(tree) });
      }
      case 'createCommit': {
        empty();
        if (!this.trees.has(body.tree)) throw new HttpError(422, 'Tree SHA does not exist');
        if (!(body.parents as string[]).every((p) => this.commits.has(p))) throw new HttpError(422, 'Parent SHA does not exist or is not a commit object');
        if (body.author && this.rejectAuthor) throw new HttpError(422, 'Invalid request. author email is invalid');
        const sha = await this.storeCommit(body.tree, body.parents, body.message, body.author);
        const c = this.commits.get(sha)!;
        return reply(201, { sha, html_url: this.commitUrl(sha), tree: { sha: c.tree }, message: c.message, committer: { date: c.date }, parents: c.parents.map((p) => ({ sha: p })) });
      }
      case 'updateRef': {
        empty();
        const current = this.refs.get(arg);
        if (!current) throw new HttpError(422, 'Reference does not exist');
        if (!this.commits.has(body.sha)) throw new HttpError(422, 'Object does not exist');
        if (body.force === true) this.forcedUpdates++;
        else if (!this.isAncestor(current, body.sha)) throw new HttpError(422, 'Update is not a fast forward');
        this.refs.set(arg, body.sha);
        return reply(200, { ref: `refs/heads/${arg}`, object: { sha: body.sha, type: 'commit' } });
      }
      case 'putFile': {
        const text = fromBase64(body.content);
        const head = this.head();
        if (head && this.trees.get(this.commits.get(head)!.tree)!.has(arg)) throw new HttpError(422, 'Invalid request.\n\n"sha" wasn\'t supplied.');
        const sha = await this.commitFiles({ [arg]: text }, body.message);
        return reply(201, { content: { path: arg }, commit: { sha, html_url: this.commitUrl(sha) } });
      }
    }
  }

  private commitUrl(sha: string) {
    return `https://github.com/${this.fullName}/commit/${sha}`;
  }

  private isAncestor(ancestor: string, sha: string): boolean {
    const seen = new Set<string>();
    const stack = [sha];
    while (stack.length) {
      const s = stack.pop()!;
      if (s === ancestor) return true;
      if (seen.has(s)) continue;
      seen.add(s);
      stack.push(...(this.commits.get(s)?.parents ?? []));
    }
    return false;
  }

  private async storeBlob(text: string) {
    const sha = await blobSha(text);
    this.blobs.set(sha, text);
    return sha;
  }

  private async storeTree(tree: Map<string, string>) {
    const sorted = [...tree].sort(([a], [b]) => (a < b ? -1 : 1));
    const sha = await blobSha(`tree\n${sorted.map(([p, s]) => `${s} ${p}`).join('\n')}`);
    this.trees.set(sha, new Map(sorted));
    return sha;
  }

  private async storeCommit(tree: string, parents: string[], message: string, author?: { name: string; email: string }) {
    const date = new Date(this.now()).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const sha = await blobSha(`commit\n${tree}\n${parents.join(' ')}\n${date}\n${++this.counter}\n${message}`);
    this.commits.set(sha, { sha, tree, parents, message, author, date });
    return sha;
  }
}

let dev: FakeGitHub | null = null;

/** The page's fake GitHub for `npm run dev` with `?fakeGitHub`, exposed as `window.__fakeGitHub` for poking at. */
export function devFakeGitHub(): FakeGitHub {
  if (!dev) {
    dev = new FakeGitHub();
    dev.anyRepo = true;
    (window as unknown as { __fakeGitHub: FakeGitHub }).__fakeGitHub = dev;
  }
  return dev;
}
