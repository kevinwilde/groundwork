import { applyOps, StaleError, type Op } from '../data/ops';
import { db as defaultDb, type GroundworkDB } from '../db/db';
import type { DeviceInfo } from './device';
import { asSyncError, syncError, SyncError } from './errors';
import { blobSha, blobShas } from './gitsha';
import { createGitHub, GitHubError, type CommitInfo, type GitHubApi, type RepoInfo, type TreeChange, type TreeItem } from './github';
import { Clock, maxHlc, SEED_HLC, wallOf } from './hlc';
import { checkManifest, DATA_README, groupByPath, isManagedPath, MANIFEST_PATH, parseFile, renderFiles, renderManifest, STARTER_FILES } from './layout';
import { deleteMeta, ensureDevice, getMeta, readSyncSet, setMeta, type GitHubConfig, type RemoteInfo, type Snapshot } from './local';
import { addCounts, count, diff, emptyCounts, index, mergeSets, planToOps, sameVersion, type Counts } from './merge';
import { commitMessage, parseTrailers } from './message';
import { withSyncLock } from './lock';
import { TOMBSTONE_TTL } from './scope';

/**
 * The sync algorithm: read the branch head, download only the files whose bytes differ from this
 * device's own rendering, merge, apply the result here first (verbatim, refused if anything was
 * written meanwhile), then push one commit and move the branch with a compare-and-swap. Every step
 * is atomic, so a sync interrupted anywhere converges the next time.
 */

/** The token's row in `meta`. Only this file reads or writes it. */
const TOKEN_KEY = 'githubToken';
/** Not linked to any GitHub account, so syncs don't show on the public contribution graph. */
export const AUTHOR_EMAIL = 'sync@groundwork.invalid';
const ATTEMPTS = 5;
const MIN = 60_000;
const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';

export type Progress = { step: 'checking' } | { step: 'downloading'; done: number; total: number } | { step: 'saving' } | { step: 'uploading'; files: number } | { step: 'retrying' };

export type Warning = { kind: 'clock'; minutes: number } | { kind: 'stale' };

export interface SyncContext {
  db: GroundworkDB;
  gh: GitHubApi;
  cfg: GitHubConfig;
  device: DeviceInfo;
  now: () => number;
  onProgress?: (p: Progress) => void;
  /** Called before a sync changes this device: open Undo toasts would now undo the wrong thing. */
  beforeApply?: () => void;
  online?: () => boolean;
  lock?: <T>(fn: () => Promise<T>) => Promise<T>;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export interface Totals {
  local: Counts;
  remote: Counts;
}

export type SyncOutcome =
  | { kind: 'up-to-date'; warnings: Warning[]; seq: number }
  | { kind: 'pulled' | 'synced'; totals: Totals; commitUrl?: string; undo: Op[]; undoSeq: number | null; warnings: Warning[]; seq: number }
  | { kind: 'preview'; counts: Totals; firstSync: boolean; remoteHasData: boolean; remoteRecords: number; ownRecords: number };

const isEmptyRepo = (e: unknown) => e instanceof GitHubError && e.code === 'empty';
const isConflict = (e: unknown) => e instanceof GitHubError && e.code === 'conflict';
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

let manifestSha: Promise<string> | null = null;
const manifestBlobSha = () => (manifestSha ??= blobSha(renderManifest()));

function toInfo(c: CommitInfo): { tree: string; remote: RemoteInfo } {
  const t = parseTrailers(c.message);
  return { tree: c.tree, remote: { device: t.device, deviceId: t.deviceId, at: c.date } };
}

/** Run `fn` over `items`, at most `limit` at a time. */
async function pool<T, R>(limit: number, items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Managed files keyed by path, after refusing repositories that hold something else. */
async function readListing(gh: GitHubApi, items: TreeItem[]): Promise<Map<string, string>> {
  const blobs = items.filter((e) => e.type === 'blob');
  const remote = new Map(blobs.filter((e) => isManagedPath(e.path)).map((e) => [e.path, e.sha]));
  const manifest = remote.get(MANIFEST_PATH);
  if (!manifest) {
    // Without a manifest, only GitHub's new-repository files may be there.
    const other = blobs.find((e) => !STARTER_FILES.has(e.path));
    if (other) throw syncError('not-groundwork', { example: other.path });
  } else if (manifest !== (await manifestBlobSha())) checkManifest(await gh.getBlob(manifest));
  return remote;
}

/** Records on this device other than the untouched starter library. */
const ownRecords = (snap: Snapshot) => [...snap.set.values()].filter((v) => v.live && v.hlc !== SEED_HLC).length;

function previewEmpty(snap: Snapshot): SyncOutcome {
  return { kind: 'preview', counts: { local: emptyCounts(), remote: count(diff(new Map(), snap.set)) }, firstSync: true, remoteHasData: false, remoteRecords: 0, ownRecords: ownRecords(snap) };
}

/** The Git Data API answers 409 until a repository has a commit; the Contents API can make the first one. */
export async function initRepo(gh: GitHubApi, cfg: GitHubConfig): Promise<string> {
  try {
    await gh.putFile('README.md', DATA_README, 'Set up Groundwork sync');
  } catch (e) {
    // 422: it already exists, because another device initialised the repository a moment ago.
    if (!(e instanceof GitHubError && e.status === 422)) throw e;
  }
  try {
    const head = await gh.getRef(cfg.branch);
    if (head) return head;
  } catch (e) {
    if (isEmptyRepo(e)) throw syncError('busy', { message: 'The repository is still being created.' });
    throw e;
  }
  throw syncError('no-branch');
}

/** Sync this device with GitHub. Runs inside the sync lock; `preview` only counts what would change. */
export function runSync(ctx: SyncContext, opts: { preview?: boolean; reason?: 'manual' | 'undo' } = {}): Promise<SyncOutcome> {
  return (ctx.lock ?? withSyncLock)(() => syncOnce(ctx, opts));
}

async function syncOnce(ctx: SyncContext, { preview = false, reason = 'manual' }: { preview?: boolean; reason?: 'manual' | 'undo' }): Promise<SyncOutcome> {
  const { db, gh, device, now } = ctx;
  const progress = ctx.onProgress ?? (() => {});
  const sleep = ctx.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const random = ctx.random ?? Math.random;
  const online = ctx.online ? ctx.online() : typeof navigator === 'undefined' || navigator.onLine !== false;
  if (!online) throw syncError('offline');

  const undo: Op[] = [];
  let undoSeq: number | null = null;
  const totals: Totals = { local: emptyCounts(), remote: emptyCounts() };
  const warnings: Warning[] = [];
  let cfg = ctx.cfg;
  let checkedRepo = false;
  let refreshedBranch = false;
  const backoff = (attempt: number) => sleep(250 * 2 ** (attempt - 1) + random() * 250);

  /** Keep the saved config in step with a renamed repository or default branch. */
  const noteRepo = async (r: RepoInfo, branch = cfg.branch) => {
    const [owner, repo] = r.fullName.split('/');
    if (owner === cfg.owner && repo === cfg.repo && branch === cfg.branch) return;
    cfg = { ...cfg, owner, repo, branch, htmlUrl: r.htmlUrl };
    await setMeta(db, 'github', cfg);
  };
  /** Never upload to a public or archived repository. Checked once per run, before the first write. */
  const ensureWritable = async () => {
    if (checkedRepo) return;
    const r = await gh.getRepo();
    if (!r.private) throw syncError('public');
    if (r.archived) throw syncError('archived');
    await noteRepo(r);
    checkedRepo = true;
  };

  try {
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      progress({ step: 'checking' });
      const state = await getMeta(db, 'syncState');
      if (attempt === 1 && state && now() - state.at > TOMBSTONE_TTL) warnings.push({ kind: 'stale' });

      // 1. The branch head (never from the HTTP cache).
      let head: string | null;
      try {
        head = await gh.getRef(cfg.branch);
      } catch (e) {
        if (!isEmptyRepo(e)) throw e;
        if (preview) return previewEmpty(await readSyncSet(db));
        await ensureWritable();
        head = await initRepo(gh, cfg);
      }
      if (head === null) {
        // The default branch may have been renamed: read it again once.
        if (refreshedBranch) throw syncError('no-branch');
        refreshedBranch = true;
        const r = await gh.getRepo();
        if (r.defaultBranch === cfg.branch) throw syncError('no-branch');
        await noteRepo(r, r.defaultBranch);
        continue;
      }

      // 2. Nothing changed on either side: one request.
      const seq = (await getMeta(db, 'seq')) ?? 0;
      if (!preview && state && head === state.commit && seq === state.seq) return { kind: 'up-to-date', warnings, seq };

      // 3. What's on GitHub.
      const info = head === state?.commit ? { tree: state.tree, remote: state.remote } : toInfo(await gh.getCommit(head));
      const listing = await gh.getTree(info.tree);
      if (listing.truncated) throw syncError('too-many-files', { message: 'the repository has too many files to list' });
      const remote = await readListing(gh, listing.items);

      // 4. This device, in one read transaction.
      const snap = await readSyncSet(db);
      const groups = groupByPath(snap.set);
      const localShas = await blobShas(renderFiles(snap.set));

      // 5. Download only files whose bytes differ from this device's rendering of the same path.
      const need = [...remote].filter(([p, sha]) => p !== MANIFEST_PATH && localShas.get(p) !== sha);
      let done = 0;
      if (need.length) progress({ step: 'downloading', done, total: need.length });
      const texts = new Map(
        await pool(4, need, async ([p, sha]) => {
          const text = await gh.getBlob(sha);
          progress({ step: 'downloading', done: ++done, total: need.length });
          return [p, text] as const;
        }),
      );
      // Identical files hold identical records, so this device's own copies stand in for them.
      const R = index([...remote.keys()].filter((p) => p !== MANIFEST_PATH).flatMap((p) => (texts.has(p) ? parseFile(p, texts.get(p)!) : (groups.get(p) ?? []))));

      // 6. Merge.
      const top = maxHlc([...R.values()].map((v) => v.hlc));
      const stamp = Clock.from(snap.clock).observe(top).stamper(device.id, now());
      const m = mergeSets(snap.set, R, { stamp, now: now() });
      // Only stamps this sync brought: once seen, a device's own later edits carry them forward too.
      const arrived = maxHlc([...R.values()].filter((v) => !sameVersion(snap.set.get(v.key), v)).map((v) => v.hlc));
      const ahead = wallOf(arrived) - now();
      if (ahead > 10 * MIN && !warnings.some((w) => w.kind === 'clock')) warnings.push({ kind: 'clock', minutes: Math.round(ahead / MIN) });
      if (preview) {
        const remoteRecords = [...R.values()].filter((v) => v.live).length;
        return { kind: 'preview', counts: m.counts, firstSync: !state, remoteHasData: remote.size > 1, remoteRecords, ownRecords: ownRecords(snap) };
      }

      // 7. Apply here first: verbatim, all or nothing, refused if anything was written since the snapshot.
      if (m.local.length) {
        progress({ step: 'saving' });
        ctx.beforeApply?.();
        try {
          const inverse = await applyOps(planToOps(m.local, snap.samples), { db, mode: 'verbatim', expectSeq: snap.seq, origin: 'sync', now });
          undo.unshift(...inverse);
          undoSeq = snap.seq + 1;
          addCounts(totals.local, m.counts.local);
        } catch (e) {
          if (e instanceof StaleError) {
            await backoff(attempt);
            continue;
          }
          throw syncError('storage', { message: errorText(e) });
        }
      }
      const syncedSeq = snap.seq + (m.local.length ? 1 : 0);

      // 8. Render the merged state and compare it with what's on GitHub.
      const files = renderFiles(m.merged);
      const shas = await blobShas(files);
      const changes: TreeChange[] = [
        ...[...files].filter(([p]) => remote.get(p) !== shas.get(p)).map(([path, content]): TreeChange => ({ path, mode: '100644', type: 'blob', content })),
        ...[...remote.keys()].filter((p) => !files.has(p)).map((path): TreeChange => ({ path, mode: '100644', type: 'blob', sha: null })),
      ];
      const finish = (commit: string, tree: string, from: RemoteInfo) => setMeta(db, 'syncState', { commit, tree, seq: syncedSeq, at: now(), remote: from });
      const pulled = (): SyncOutcome => (undo.length ? { kind: 'pulled', totals, undo, undoSeq, warnings, seq: syncedSeq } : { kind: 'up-to-date', warnings, seq: syncedSeq });
      if (!changes.length) {
        await finish(head, info.tree, info.remote);
        return pulled();
      }

      // 9 and 10. One commit, then compare-and-swap the branch.
      await ensureWritable();
      progress({ step: 'uploading', files: changes.length });
      const tree = await gh.createTree(info.tree, changes);
      if (tree === info.tree) {
        // Never an empty commit.
        await finish(head, info.tree, info.remote);
        return pulled();
      }
      const kind = reason === 'undo' ? 'undo' : remote.size <= 1 ? 'first' : 'sync';
      const message = commitMessage({ device, counts: m.counts.remote, kind, app: APP_VERSION });
      const commit = await gh.createCommit({ message, tree, parents: [head], author: { name: `Groundwork (${device.name})`, email: AUTHOR_EMAIL } });
      try {
        await gh.updateRef(cfg.branch, commit.sha);
      } catch (e) {
        if (!isConflict(e)) throw e;
        // Another device pushed in between: read the new head, download what changed, merge again.
        progress({ step: 'retrying' });
        await backoff(attempt);
        continue;
      }
      addCounts(totals.remote, m.counts.remote);
      await finish(commit.sha, tree, { device: device.name, deviceId: device.id, at: now() });
      return { kind: 'synced', totals, commitUrl: commit.htmlUrl, undo, undoSeq, warnings, seq: syncedSeq };
    }
    throw syncError('busy');
  } catch (e) {
    const err = asSyncError(e);
    // What already arrived here stays; the UI says so.
    if (undo.length) err.partial = totals.local;
    throw err;
  }
}

/**
 * Undo a sync on this device as new edits (local mode), so the undo sticks everywhere: records it
 * added are deleted with fresh tombstones, records it changed are put back with fresh stamps. Then sync.
 */
export async function undoSync(result: { undo: Op[]; undoSeq: number | null }, ctx: SyncContext): Promise<SyncOutcome> {
  if (!result.undo.length || result.undoSeq === null) throw syncError('undo-stale');
  try {
    await applyOps(result.undo, { db: ctx.db, mode: 'local', expectSeq: result.undoSeq, origin: 'user', now: ctx.now });
  } catch (e) {
    if (e instanceof StaleError) throw syncError('undo-stale');
    throw syncError('storage', { message: errorText(e) });
  }
  return runSync(ctx, { reason: 'undo' });
}

/** `?fakeGitHub` in `npm run dev` points sync at the in-memory fake. Dropped from production builds. */
async function resolveFetch(): Promise<typeof fetch> {
  if (import.meta.env.DEV && typeof location !== 'undefined' && new URLSearchParams(location.search).has('fakeGitHub')) {
    const { devFakeGitHub } = await import('../test/fakeGitHub');
    return devFakeGitHub().fetch;
  }
  return (input, init) => fetch(input, init);
}

/** A sync context for this device, or null when sync isn't set up. The only place the token is read. */
export async function openContext(db: GroundworkDB = defaultDb, extra: Partial<SyncContext> & { fetch?: typeof fetch } = {}): Promise<SyncContext | null> {
  const [cfg, device, row] = await Promise.all([getMeta(db, 'github'), ensureDevice(db), db.meta.get(TOKEN_KEY)]);
  const token = (row?.value as { token?: string } | undefined)?.token;
  if (!cfg || !token) return null;
  const { fetch: f, ...rest } = extra;
  const gh = createGitHub({ owner: cfg.owner, repo: cfg.repo, token, fetch: f ?? (await resolveFetch()) });
  return { db, gh, cfg, device, now: Date.now, ...rest };
}

/** Whether this device has records of its own (anything but the untouched starter library). */
export async function hasOwnRecords(db: GroundworkDB = defaultDb): Promise<boolean> {
  return ownRecords(await readSyncSet(db)) > 0;
}

export interface ConnectInput {
  /** owner/name, or the repository's address. */
  repo: string;
  token: string;
  expiresAt?: number;
  deviceName?: string;
}

export type TestResult = { ok: true; fullName: string; empty: boolean; remote?: RemoteInfo } | { ok: false; error: SyncError };

/** "owner/name" from what the user typed or pasted, including https://github.com/owner/name(.git). */
export function parseRepo(input: string): { owner: string; repo: string } | null {
  const s = input
    .trim()
    .replace(/^(?:https?:\/\/)?(?:www\.)?github\.com\//i, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '');
  const m = /^([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)$/.exec(s);
  return m ? { owner: m[1], repo: m[2] } : null;
}

/**
 * Check the repository and token, and only then save them. Refuses classic tokens, public or archived
 * repositories, repositories with other files in them, and tokens that can't write.
 */
export async function testConnection(input: ConnectInput, { db = defaultDb, fetch: f, now = Date.now }: { db?: GroundworkDB; fetch?: typeof fetch; now?: () => number } = {}): Promise<TestResult> {
  try {
    const parsed = parseRepo(input.repo);
    if (!parsed) throw syncError('bad-repo');
    const token = input.token.trim();
    if (/^gh[po]_/.test(token)) throw syncError('classic-token');
    if (!token) throw syncError('auth');
    const gh = createGitHub({ ...parsed, token, fetch: f ?? (await resolveFetch()) });
    const r = await gh.getRepo();
    if (!r.private) throw syncError('public');
    if (r.archived) throw syncError('archived');

    let head: string | null = null;
    let empty = true;
    try {
      head = await gh.getRef(r.defaultBranch);
      if (head === null) throw syncError('no-branch');
    } catch (e) {
      if (!isEmptyRepo(e)) throw e;
    }
    let remote: RemoteInfo | undefined;
    if (head) {
      const commit = await gh.getCommit(head);
      const listing = await gh.getTree(commit.tree);
      const files = await readListing(gh, listing.items);
      if (files.has(MANIFEST_PATH)) {
        empty = false;
        remote = toInfo(commit).remote;
      }
      // Write probe: a dangling blob is invisible and harmless. An empty repository's first sync checks writing instead.
      await gh.createBlob('groundwork connection test\n');
    }

    const [owner, repo] = r.fullName.split('/');
    const prev = await getMeta(db, 'github');
    const same = !!prev && prev.owner.toLowerCase() === owner.toLowerCase() && prev.repo.toLowerCase() === repo.toLowerCase();
    const cfg: GitHubConfig = { owner, repo, branch: r.defaultBranch, htmlUrl: r.htmlUrl, tokenHint: `…${token.slice(-4)}`, connectedAt: same ? prev.connectedAt : now() };
    if (input.expiresAt) cfg.tokenExpiresAt = input.expiresAt;
    const device = await ensureDevice(db);
    await db.transaction('rw', db.meta, async () => {
      if (!same) await deleteMeta(db, 'syncState');
      await setMeta(db, 'github', cfg);
      await db.meta.put({ key: TOKEN_KEY, value: { token } });
      const name = input.deviceName?.trim();
      if (name && name !== device.name) await setMeta(db, 'device', { ...device, name });
    });
    return { ok: true, fullName: r.fullName, empty, remote };
  } catch (e) {
    return { ok: false, error: asSyncError(e) };
  }
}

/** Forget the repository and token on this device. The data stays here and on GitHub. */
export async function disconnect(db: GroundworkDB = defaultDb) {
  await db.meta.bulkDelete(['github', TOKEN_KEY, 'syncState']);
}
