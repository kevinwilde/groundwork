# Groundwork: device sync plan

This plan syncs the iPhone and the Mac through a private GitHub repository that belongs to the user, for example `kevinwilde/groundwork-data`. There is no server of our own. Groundwork calls the GitHub REST API directly from the browser, using a fine-grained token that can only reach that one repository. The token is pasted once on each device.

Every sync that changes anything becomes one commit, named after the device that made it. The repository's history shows the data changing over time, and old states can be recovered from it. Neither device has to be online at the same time as the other: GitHub holds the latest merged state in between.

Records merge one at a time, and the newest edit wins. "Newest" comes from a hybrid logical clock (HLC) stamp that `applyOps()` puts on every write. Deletions leave tombstones, so they reach the other device instead of coming back. The user syncs with a **Sync now** button; this version never syncs on its own. Offline, everything keeps working on the device, and sync waits.

## Scope of this version

- **In scope:** phases 1–7 and 9.
- **Deferred:** phase 8 (automatic sync) and phase 10 (history browsing and restore in the app, encryption). They stay in this plan for later; nothing from them is built now.
- **Sync is manual only.** It runs when the user taps **Sync now**, and once more straight after an Undo of a sync. There is no automatic-sync code, switch or `meta.github.auto` flag in this version. If phase 8 is built later, automatic sync is **off by default**, behind a per-device switch.

## Key decisions

| Concern | Choice | Why |
| --- | --- | --- |
| Storage | A separate **private** repository the user creates (e.g. `kevinwilde/groundwork-data`), never the app repository | Pushes to `main` in `kevinwilde/groundwork` deploy the app. The data repository has no workflows, so pushes run nothing. Setup refuses any repository that already holds other files (see Setup). |
| API access | GitHub REST API from the browser with `fetch` (api.github.com allows CORS: `Access-Control-Allow-Origin: *`, with `Authorization` and `X-GitHub-Api-Version` allowed in preflight) | No backend, no new dependency. Web Crypto supplies SHA-1 (git blob ids). |
| Auth | One fine-grained personal access token **per device**, limited to the data repository, with **Contents: Read and write** (Metadata: Read-only is added automatically) | Smallest scope GitHub offers. One token per device means a lost phone can be cut off without touching the Mac. It also avoids a problem: GitHub shows a token only once, so a single shared token would have to be pasted on both devices in the same few minutes. |
| Token storage | `meta` row `githubToken`, on the device only | `meta` is never exported, backed up, synced, or read by `readAll()`/`useData()`, so the token never enters React state, backups or the repository. |
| Branch | The repository's default branch, read from `GET /repos` during setup | History is visible on the repository's front page. GitHub's empty-repository bootstrap (the Contents API) writes to the default branch. A dedicated branch only helps when other content shares the repository, which setup forbids. |
| Write path | Git Data API: one tree (inline `content`, chained via `base_tree` in batches of at most 1 MB), one commit, then `PATCH` the ref with `force: false` as the compare-and-swap | All changed files land in one atomic commit. If another device pushed in between, our commit isn't a fast-forward of the new head, so GitHub refuses it (422) and we re-merge. Considered: GraphQL `createCommitOnBranch` (a true `expectedHeadOid` check), but it can't create the first commit either, and REST keeps one API. |
| Downloads | Compare the remote tree's blob SHAs with git blob SHAs computed locally over this device's own rendering of each file; download only files that differ | Byte-identical files hold identical records, so they never need downloading, and no local file cache is needed. A sync after one local edit downloads about one month file. |
| Short circuit | `meta.syncState = { commit, tree, seq, … }`. If the branch head equals `commit` and `meta.seq` equals `seq`, nothing changed on either side | One request (`GET ref`) when nothing has changed. |
| Order | Merge, **apply locally first** (verbatim, guarded by `expectSeq`), then push | The local copy always contains everything that is pushed. A failed push never loses downloaded changes, and the window between the local snapshot and the apply is only the downloads. |
| Merge model | State-based. Per record, the newest HLC wins, with tombstones and an integrity repair pass. The syncing device merges its own data with the downloaded state and writes the result to both sides | The merge is idempotent, commutative and associative, and every write is atomic, so syncing again always converges. |
| Repository format | Plaintext JSON Lines, one record per line, stable key order. Entries and check-ins are split by month; tombstones go in `deleted.jsonl`; `groundwork.json` is the manifest | Readable diffs: one added line per new record, one changed line per edit. Small uploads: a sync usually rewrites one month file. |
| Encryption | **Not in v1.** Plaintext in a private repository. Passphrase encryption is a later phase | The user wants a history they can read and recover from. Encryption makes every diff opaque and adds a passphrase that, once lost, loses the history. See Security. |
| When to sync | **Sync now** button only. Automatic sync is deferred (phase 8); if added later it is off by default | The user syncs at times they choose, so each commit in the history is a deliberate sync. A no-change sync costs one request. |
| Undo of a sync | **Undo on this device** replays the sync's inverse ops as **new edits** (`local` mode), guarded by `expectSeq`, then syncs | With a central repository, a verbatim restore would be undone by the next sync. Replaying as new edits matches every other Undo in the app ("Undo counts as a new edit") and makes the undo stick on all devices. |
| Commit author | `{ name: 'Groundwork (<device>)', email: 'sync@groundwork.invalid' }` | The history lists the device. The address isn't linked to any GitHub account, so syncs don't light up the user's public contribution graph with exercise times. Falls back to the default author if GitHub rejects it. |
| Clock | HLC rather than plain `Date.now()` | Explained under Merge. |
| Where stamps are set | Centrally, inside `applyOps()` | Today `updatedAt` is set on only some writes (see the audit below). Every write already goes through `applyOps()`, so stamping there can't be missed. |
| Dependencies | None added | `fetch`, `crypto.subtle` (SHA-1), `TextEncoder`, Web Locks, all in Safari 16.4+, Chrome and Node 22. |

## Timestamp audit: why stamping moves into `applyOps`

| Write | Where | `createdAt` | `updatedAt` |
| --- | --- | --- | --- |
| Exercise create/edit | `ExerciseDialog.submit` | new: now | set on every save |
| Entry create | `LogPage` L134, `TodayPage` L51, `EntryDialog` (new), `SessionLogger` (`now + i`) | now | none |
| Entry edit | `EntryDialog.submit` | kept | set |
| Session create/edit | `SessionDialog.submit` | kept or now | set on every save |
| Check-in create/edit | `Checkin.tsx` submit | kept or now | set on every save |
| Tag create/edit | `TagDialog`, inline in `ExerciseDialog` L140 | now | never (the type has no field) |
| Type, snack, body part create/edit | `TypeDialog`, `SnackDialog`, `BodyPartDialog`, `LibraryPage` L319 | now | never (the types have no field) |
| Snack active toggle, body-part active toggle | `LibraryPage` L219, L347 | kept | never |
| Tag-delete strip, body-part-delete strip | `opsDeleteTag`, `opsDeleteBodyPart` in `lib/model.ts` | kept | **not bumped** (spreads the old record) |
| Saved view create | `Filters.tsx` L206 | now | no edits exist |
| Settings (`weekStart`, `lastExportAt`, `seeded`) | `DataPage`, `bootstrap` | none | none |
| Undo | `toast.save(inverse)` | the old record is restored, including its old `updatedAt` | n/a |
| Starter library | `seed.libraryOps(Date.now())` | **first-run time, different on each device** | n/a |
| Sample history | `seed.sampleOps` | made-up past times; **random `uid()` ids, different on each device** | n/a |
| Backup import | `backup.importOps` | from the file, defaults to 0 | passed through |

Conclusion: `updatedAt` can't be used for merging. Every write after v3 gets an `hlc`, set by `applyOps()`. Records from before v3 get a best-effort stamp computed once (see Data model).

## Architecture

New `src/sync/` (pure modules first, browser glue last):

- `hlc.ts`: encodes, decodes and compares HLC strings. Holds `Clock` (`next`, `observe`, `stamper`), `SEED_HLC`, `SEED_GONE_HLC`, `legacyStamp()` and `wallOf()`.
- `scope.ts`: `SHARED_SETTINGS = new Set(['weekStart'])`, `isSynced(table, rec)` (excludes `sample` records and device-local settings), `tombstoneId(table, key)`.
- `canonical.ts`: stable JSON with sorted keys and `undefined` dropped. Used for equality and ties.
- `merge.ts`: the `SyncSet`, `Version`, `Change` and `Counts` types, plus `mergeSets(local, remote, { stamp, now })`, `planToOps(changes, samples)` and `addCounts`. Pure.
- `integrity.ts`: the repair pass over the merged state (restores parents, strips dead tags). Pure.
- `legacy.ts`: stamps pre-v3 records, normalizes unchanged seed records, infers tombstones for missing starter records. Pure functions plus a `stampLegacy(db)` runner.
- `layout.ts`: repository layout. `FORMAT`, `MANIFEST_PATH`, `pathOf(table, rec)`, `isManagedPath`, `groupByPath(set)`, `renderFiles(set)` (path to text, deterministic), `parseFile(path, text)` (validated, line numbers, no defaults applied), `renderManifest()`, `DATA_README`. Pure.
- `gitsha.ts`: `blobSha(text)` is the SHA-1 of `` `blob ${byteLength}\0` `` plus the UTF-8 bytes, which is git's blob id. `blobShas(files)`.
- `message.ts`: `commitMessage({ device, counts, kind, app })` and `parseTrailers(message)`. Pure.
- `github.ts`: the `GitHubApi` interface, `createGitHub({ owner, repo, token, fetch })`, `GitHubError { code, status, retryAt }`. Error text never contains the token.
- `local.ts`: database glue. `ensureDevice(db)`, `readSyncSet(db)` (one read transaction returning `{ set, seq, clock, samples }`), `purgeTombstones(db)`, `getMeta`/`setMeta`.
- `engine.ts`: `runSync(ctx, opts)` (the algorithm below, including preview), `initRepo`, `testConnection(input)`, `undoSync(result)`.
- `lock.ts`: `withSyncLock(fn)` via `navigator.locks.request('groundwork-sync', …)`, with an in-memory mutex fallback for Node and old browsers.
- `auto.ts` (phase 8, deferred): `startAutoSync({ db, events, now, timers })`. Triggers, debounce, backoff, toasts.
- `status.ts`: a small external store (`useSyncStatus()` via `useSyncExternalStore`): phase, progress, last result (with Undo), last error.
- `device.ts`: `defaultDeviceName()` from `isIOS()` and `isStandalone()` (in `lib/install.ts`) and the user agent: "iPhone", "iPhone (Safari)", "iPad", "Mac (Safari)", "Mac (Chrome)".
- `errors.ts`: `SyncErrorCode`, and `describe(code, ctx)` returning `{ message, action? }` with the exact wording below.
- `ui/SyncCard.tsx`, `ui/SetupDialog.tsx`, `ui/FirstSyncReview.tsx`, `ui/SyncResult.tsx`: the Data page card and its dialogs.

Changed files:

- `src/db/types.ts`: a `Stamped { hlc?: string; updatedAt?: number }` mixin on every record type (including `Setting`), `Tombstone`, `Tables.tombstones`, `DataTable = Exclude<TableName, 'tombstones'>`. `TABLES: DataTable[]` stays the user-data list.
- `src/db/db.ts`: the v3 schema and typed `tombstones` and `meta` tables.
- `src/data/ops.ts`: `applyOps(ops, opts)` gains stamping, tombstones, the clock, `seq`, verbatim mode, `expectSeq`, `origin`, `now` and a `db` override. Adds `StaleError`. (`subscribeWrites(fn)` comes with phase 8.)
- `src/components/toast.ts`: `save(ops, opts?)` passes options through.
- `src/db/seed.ts`: seed records carry `SEED_HLC` and `createdAt: 0`. New `seedIndex()`.
- `src/data/bootstrap.ts`: calls `ensureDevice`, `stampLegacy` and `purgeTombstones`, and applies first-run seeding verbatim.
- `src/db/backup.ts`: backup format v3 (tombstones and `hlc`), exported `recordSchemas`, `mergeImport()`, `replaceImportOps()`.
- `src/db/labels.ts` (new): `LABELS` moved here from `DataPage`, plus `NOUNS: Record<DataTable, [singular, plural]>` for commit messages and results.
- `src/lib/dates.ts`: `fmtAgo(ms)` ("just now", "5 minutes ago") and `fmtWhen(ms)` ("today at 09:12", "yesterday at 18:40", "Mon, Oct 5 at 08:10").
- `src/pages/DataPage.tsx`: the Sync card first. Wording changes in Backup, Restore, Install and Erase.
- `src/App.tsx` (phase 8, deferred): mounts `<AutoSync />` inside `DataProvider`, so it runs after `bootstrap()`.
- `src/components/Icon.tsx`: a `sync` icon (two circular arrows, same stroke style).
- `vite.config.ts`: `define: { __APP_VERSION__ }` read from `package.json` (declared in a new `src/globals.d.ts`), a build-only CSP plugin (see Security), and new manifest wording. `package.json` goes to 1.1.0.
- Tests: new `src/test/fakeGitHub.ts` (an in-memory GitHub).

Dropped from the previous plan: `framing.ts`, `protocol.ts`, `signal.ts`, `webrtc.ts`, `camera.ts`, the QR and Scanner UI, `fakeChannel.ts`, and the `qrcode` and `jsqr` dependencies.

## Data model (Dexie schema v3)

```ts
// v3: device sync. Deleted records leave tombstones so deletions reach other devices;
// meta holds device-local state (device id, clock, sync config, token) and is never exported or synced.
this.version(3).stores({ tombstones: 'id, deletedAt', meta: 'key' });
```

| Table | Key / indexes | Shape |
| --- | --- | --- |
| every data table | unchanged | gains `hlc?: string` (set by `applyOps`, always present after bootstrap) and `updatedAt?: number` (wall clock, for information only) |
| `tombstones` (v3) | `id` = `` `${table}:${key}` ``, `deletedAt` | `{ id, table: DataTable, key, hlc, deletedAt }` |
| `meta` (v3) | `key` | rows below |

| `meta` key | Value | Written by |
| --- | --- | --- |
| `device` | `{ id (10 chars, [0-9a-z]), createdAt, name }` | `ensureDevice`; the name is edited in the Sync card |
| `clock` | `{ wall, counter }` | `applyOps` |
| `seq` | number, incremented once by every non-empty `applyOps` call | `applyOps` |
| `legacyStamped` | `true` | `stampLegacy` |
| `github` | `{ owner, repo, branch, htmlUrl, tokenHint: '…X9aB', tokenExpiresAt?: number, connectedAt }` | setup and settings. Contains no secret, so the card's live query may read it |
| `githubToken` | `{ token }` | setup and Replace token. Read only inside `engine.ts` |
| `syncState` | `{ commit, tree, seq, at, remote: { device?: string, at: number } }` | the engine, after a sync that leaves both sides equal. Deleted on Disconnect, Erase and Replace import |

- **Why `meta` is a separate table and not `settings`:** settings are exported in backups and imported by `importOps`. A device id or token carried inside a backup would leak, or give two devices the same id.
- **No `.upgrade()` callback.** Legacy stamping runs in `bootstrap()` through `stampLegacy()`, in one rw transaction, and is idempotent: it only touches records without `hlc`, then sets `meta.legacyStamped`. This avoids an import cycle (`db.ts`, then `seed.ts`, then `data/ops.ts`, then back to `db.ts`) and keeps it testable. `DataProvider` already waits for `bootstrap()`, so nothing reads or writes unstamped data. As extra safety, `merge.ts` reads `rec.hlc ?? legacyStamp(rec)`.
- **What `stampLegacy` does to records without `hlc`:**
  1. If the id is in `seedIndex()` and the record matches the seed under `canonical()` (ignoring `hlc`, `createdAt` and `updatedAt`), it is replaced with the exact seed record (`SEED_HLC`, `createdAt: 0`). Unchanged starter records then become byte-identical on every device, so their file lines never differ.
  2. Otherwise `hlc = legacyStamp(rec) = encode(max(updatedAt ?? 0, createdAt ?? 0), 0, 'legacy')`. Settings get wall 0.
  3. If `settings.seeded` is true, every seed id missing locally (with no tombstone) gets a tombstone with `SEED_GONE_HLC`. This beats an unchanged seed copy elsewhere but loses to an edited copy. It is safe because every deployed install was seeded with the full v2 library (first deploy 2026-09-25), so a missing starter record means the user deleted it.
- **Tombstone retention:** 365 days by `deletedAt`. `purgeTombstones()` runs in bootstrap through `applyOps([...del('tombstones', id)], { mode: 'verbatim', origin: 'bootstrap' })`. The merge drops expired tombstones from both inputs (see Merge), so they leave `deleted.jsonl` at the next push. Tombstones are about 100 bytes each, and removing sample data creates none.
- **Backup format v3:** `BACKUP_SCHEMA = 3`. Records keep `hlc` (`z.looseObject` already passes it through; add `hlc: z.string().optional()`). New top-level `tombstones: z.array(tombstone).default([])`. v1 and v2 files still import, and their records get `legacyStamp()`. `meta` is never part of a backup.

## Merge

### HLC

- **Why not plain timestamps:** with `Date.now()`, if the iPhone's clock is 3 minutes slow, an edit made on it right after a sync can lose to an older edit from the Mac. A clock set backwards makes a device's own later edit lose to its earlier one.
- **What the HLC does:** each stamp is `max(wall clock, highest stamp seen) + counter`, and the clock state is persisted.
  - It only moves forward on each device.
  - After a sync, each device's clock is at least every stamp it holds, so any edit made after a sync beats everything that sync brought.
  - When both devices changed the same record between syncs, the winner is still roughly the later edit by wall clock.
  - Cost: about 50 lines plus one `meta` row.
- **Format:** `` `${wall.toString(36).padStart(9,'0')}.${counter.toString(36).padStart(4,'0')}.${node}` ``. The fields are fixed-width, so comparing the strings gives chronological order. `node` is the device id, so exact ties break the same way on every device. Special values: `SEED_HLC = '000000000.0000.seed'`, `SEED_GONE_HLC = '000000001.0000.seed'`, and legacy stamps with node `legacy`.
- **Clock behavior:** `next(now)` resets the counter when `now > wall`. Otherwise it increments the counter, and on overflow it adds 1 to `wall`. `observe(h)` raises the state to `h` if `h` is greater. `stamper(node, now)` returns `() => string` for repairs.
- **Skew warning (replaces the handshake clock check):** there's no peer handshake now, and GitHub's `Date` header isn't readable cross-origin. Instead, if the newest downloaded stamp's wall is more than 10 min ahead of this device's clock, the result carries a `clock` warning (wording below). Sync isn't refused, because HLC ordering stays correct; a wrong clock only skews ties between concurrent edits.

### `applyOps(ops, { mode = 'local', expectSeq?, origin = 'user', now = Date.now, db = defaultDb })`

All of this happens in one transaction over the op tables plus `tombstones` and `meta`.

- **`seq` and `expectSeq`:** read `meta.clock` and `meta.seq`. If `expectSeq` is given and doesn't equal `seq`, throw `StaleError`. Increment `seq` once per non-empty call. The device id is created lazily, so tests work without `bootstrap`.
- **`local` mode (user edits, normal Undo, undo of a sync):**
  - Each put to a data table gets `hlc = clock.next(now())` and `updatedAt = now()`.
  - Exception: if the value is `canonical()`-equal to the previous record (ignoring `hlc` and `updatedAt`), it keeps the previous stamp. A dialog saved without changes then can't override a real edit on the other device.
  - Each delete of an existing record that passes `isSynced` writes a tombstone with a fresh `hlc`. Sample records and device-local settings get no tombstone.
  - Ops on `tombstones` in the input are **ignored**: in local mode, tombstones follow from the data ops. This is what makes replaying an inverse (which contains tombstone ops) correct as new edits.
- **`verbatim` mode (sync apply, imports, seeding, purge):**
  - Puts are written exactly as given and must already have `hlc`; otherwise the call throws.
  - Deletes don't create tombstones; the caller supplies them as `put('tombstones', t)` ops.
  - At the end, the clock calls `observe(max hlc written)`.
- **In both modes:**
  - A put to a data table deletes that key's tombstone, so a key is always either live or tombstoned, never both.
  - `clear` never creates tombstones. Callers that reset a device add `clear('tombstones')` themselves.
  - Inverse ops capture every side effect, including tombstone puts and deletes.
- **After commit (phase 8, deferred):** `emitWrite({ origin, synced })`, where `synced` means some op touched a record that passes `isSynced`, or a tombstone. `auto.ts` subscribes and ignores `origin: 'sync' | 'bootstrap'`.

### `mergeSets(local, remote, { stamp, now })` (pure)

```ts
type Key = `${DataTable}:${string}`;
type Version = { live: true; hlc: string; rec: AnyRecord } | { live: false; hlc: string; tomb: Tombstone };
type SyncSet = Map<Key, Version>;                         // built by index(): filtered by isSynced; duplicate keys reduced with winner()

function winner(a?: Version, b?: Version): Version {
  if (!a || !b) return (a ?? b)!;
  if (a.hlc !== b.hlc) return a.hlc > b.hlc ? a : b;
  if (a.live !== b.live) return a.live ? b : a;             // an exact tie: the deletion wins
  if (!a.live) return a;
  return canonical(a.rec) >= canonical(b.rec) ? a : b;     // only legacy stamps (or hand edits) can tie with different content
}

function mergeSets(L: SyncSet, R: SyncSet, { stamp, now }: MergeOpts): MergeResult {
  const cutoff = now - 365 * DAY;
  const keep = (v: Version) => v.live || v.tomb.deletedAt >= cutoff;  // expired tombstones drop out of both sides
  const lv = filter(L, keep), rv = filter(R, keep);
  const merged = new Map([...union(lv.keys(), rv.keys())].map((k) => [k, winner(lv.get(k), rv.get(k))]));
  const repairs = repair(merged, lv, rv, stamp);           // integrity.ts; replaces entries in `merged` with newly stamped live versions
  const local = [...diff(lv, merged), ...expired(L, cutoff)]; // expired local tombstones become purge changes
  return { merged, local, counts: { local: count(lv, merged, repairs), remote: count(rv, merged, repairs) }, repairs: repairs.size };
}

function diff(side: SyncSet, merged: SyncSet): Change[] {
  // A key is skipped when side and merged have the same hlc, the same live state, and (if live) the same canonical JSON.
  // merged live      -> { put rec }            (counted as added if the side had no live copy, else updated, or restored if it is a repair)
  // merged tombstone -> { tombstone, delete }  (delete only if the side had a live copy; counted as deleted)
}
```

- **Stamps for repairs:** the engine builds `stamp` as `Clock.from(snapshot.clock).observe(maxHlc(R)).stamper(device.id, now)`, so repair stamps are newer than everything in both sets. A repaired version always differs from the local copy, so it reaches the local apply, which persists the advanced clock.
- **`planToOps(changes, samples)`:**
  - put becomes `put(table, rec)`.
  - delete becomes `del(table, key)` plus `put('tombstones', t)`.
  - A tombstone for a record this device never had becomes only `put('tombstones', t)`, so tombstone sets end up equal.
  - A purge becomes `del('tombstones', id)`.
  - **Local sample cascade:** for each exercise deleted by the plan, delete this device's sample entries for it. For each body part deleted, put the sample check-ins with that pain stripped. `samples` comes from the same `readSyncSet` snapshot, and `expectSeq` makes the result consistent.
- **Remote side:** there are no remote ops. The engine renders `merged` into files and uploads the files whose blob SHA changed. `counts.remote` feeds the commit message.

### Integrity pass (`integrity.ts`)

The cascade builders in `lib/model.ts` only handle children the deleting device knew about. Each of those cascaded children has its own tombstone and loses normally. Children created on the other device afterwards have no tombstone. Today an orphaned entry silently disappears from the UI (`EntryRow` returns `null` when the exercise is missing). So the merge repairs the merged state and prefers keeping data. "Dead" means the merged version is a tombstone. A parent can be restored only if one side had it live before the merge. The checks repeat until nothing changes.

- A live entry or snack whose `exerciseId` is dead: restore that exercise (its record with a new stamp).
- A live exercise whose `typeId` is dead: restore that type.
- A live check-in with a pain score for a dead `bodyPartId`: restore that body part.
- A live exercise with dead `tagIds`: strip those ids, using a newly stamped exercise. This matches `opsDeleteTag`, since tags are only labels.
- Left alone, as today: `entry.sessionId` and `entry.snackId` (soft links whose history stays), `session.items[].exerciseId` (filtered by `lib/sessions.ts`), and `views.config` ids (tolerated by `normalizeConfig`).

### Edge cases

| Case | Rule |
| --- | --- |
| Same record edited on both devices | The higher HLC wins the whole record. There's no field-level merge (see open questions). |
| Deleted on A, unchanged on B | A's tombstone is newer, so the record is deleted on B. |
| Deleted on A, edited later on B | B's edit is newer, so the record comes back on A and A's tombstone is removed. |
| Undo of a delete (toast) | The re-put gets a fresh HLC, newer than the tombstone, and removes the local tombstone. If the tombstone has already synced, the restored record beats it at the next sync. |
| Undo of an edit (toast) | The previous values are re-put with a fresh HLC, because Undo counts as a new edit. |
| Undo toast open when a sync changes this device | An Undo inverse computed before the sync could clobber a version the sync pulled in. Any sync that applies local changes calls `toast.dismiss()` first. |
| Dialog open while a sync updates the same record | The save is the newest edit and wins on every device. Accepted (rare: it needs the same record edited on two devices at once). |
| Cascading deletes | Each cascaded delete leaves its own tombstone. Tag and body-part strips are ordinary stamped puts. The integrity pass covers children the deleting device never saw. |
| Starter library (same ids on every device) | Seeded with `SEED_HLC` and `createdAt: 0` (`libraryOps()` defaults change), so it is byte-identical everywhere. Any edit or deletion beats it. Erase-all reseeds the same way. |
| Restoring built-in types when none are left (`bootstrap`) | Applied in `local` mode with fresh stamps, as a deliberate repair. |
| Sample data (random ids on each device) | Device-local: never written to GitHub, never tombstoned (`opsRemoveSample` leaves no tombstones). Sync deletes of exercises and body parts cascade to local sample records (see `planToOps`). |
| Settings | Shared: `weekStart`. Device-local: `seeded`, `lastExportAt`, and any future key unless it is added to `SHARED_SETTINGS` (a safe default). Theme (`gw.theme`) and calendar filters (`gw.calendar`) stay in localStorage, per device. |
| Saved calendar views | Synced like any other record. |
| Two devices sync at the same moment | The second `PATCH ref` isn't a fast-forward (422), so that device re-reads the head, downloads the files that changed, re-merges and pushes. Retried up to 5 times with jittered backoff. |
| Sync interrupted (app closed, offline, page frozen by iOS) | Each step is atomic (one IndexedDB transaction, one ref update). See the failure table under Sync algorithm. Syncing again converges. |
| Erase all | A reset of this device only: clears the data tables and `tombstones`, deletes `meta.syncState`, keeps the device id, clock, GitHub config and token, and reseeds verbatim. Nothing is pushed by the erase itself. The next sync copies the data back from GitHub, and creates no commit, because the merge equals what GitHub has. |
| Replace import | A reset of this device to the backup: same as erase, then the backup's records verbatim (their own `hlc`, or a legacy stamp) and its tombstones. The next sync merges, so newer changes from other devices still win. Because `syncState` was deleted, that sync shows the first-sync review. |
| Merge import | `mergeSets(readSyncSet(), backupSet)`, applying only the local side, verbatim. This replaces "the backup copy always wins", because records written with fresh stamps would overwrite newer edits from other devices. Merge skips sample records and device-local settings. Replace restores everything. |
| Records from before v3 | Legacy pass (see Data model). Pre-v3 deletions are unknown, apart from starter records. Other deleted records can come back on the first sync. The first-sync review shows the counts and offers a backup export first. Undo is available. |
| Clock skew | Handled by the HLC, plus the skew warning. |
| Tombstone retention | 365 days by `deletedAt`. If `syncState.at` is more than 365 days old, the result warns: "This device hadn't synced for over a year. Items deleted on other devices since then may have come back." |
| More than two devices, or Safari and the Home Screen app on one iPhone | Each is a separate device with its own database and token, syncing against the same repository. Newest-wins with tombstones doesn't depend on order, so they converge. |
| Hand edits on GitHub | Files are validated, and a broken line stops the sync with the file and line number. A hand-edited record that keeps its `hlc` ties with the device copies, and the tie-break is deterministic but arbitrary. Unsupported in v1; the data README says so. |
| History rewritten on GitHub (force-push, reset) | The next sync merges the new head with this device's full copy, so devices re-upload anything newer. Rolling the repository back doesn't roll devices back; use the later Restore phase for that. |
| Repository deleted, or the token revoked | The sync fails with `no-access` or `auth`. Local data is untouched. Connecting a new empty repository uploads everything again. |
| Browser clears site data (including the token) | Set up sync again. The first sync pulls everything back from GitHub. This also protects against iOS evicting storage for a Safari tab. |

## Repository layout

```
groundwork-data/
├── README.md            written once if the repository is empty; never read or changed afterwards
├── groundwork.json      manifest
├── settings.jsonl       shared settings only (weekStart)
├── types.jsonl
├── tags.jsonl
├── exercises.jsonl
├── snacks.jsonl         mini-exercises
├── sessions.jsonl
├── bodyParts.jsonl
├── views.jsonl          saved calendar views
├── deleted.jsonl        tombstones
├── entries/
│   ├── 2026-09.jsonl
│   └── 2026-10.jsonl
└── checkins/
    ├── 2026-09.jsonl
    └── 2026-10.jsonl
```

- **Paths (`pathOf`):** `entries/${date.slice(0, 7)}.jsonl`, `checkins/${date.slice(0, 7)}.jsonl`, `deleted.jsonl` for tombstones, and `${table}.jsonl` for every other table. File names are the table names, so the mapping stays obvious; the data README explains `snacks`.
- **Managed paths (`isManagedPath`):** `groundwork.json`, `^(types|tags|exercises|snacks|sessions|bodyParts|views|settings|deleted)\.jsonl$`, and `^(entries|checkins)/\d{4}-\d{2}\.jsonl$`. Everything else is foreign. Foreign files are kept (trees are built on `base_tree`) and never read. This also keeps files from a newer version's tables intact.
- **Line format:** JSON Lines, one record per line, `\n` endings, a final newline. Inside a record, `id` (or `key` for settings) comes first, `hlc` last, and every other key in alphabetical order. Nested object keys are alphabetical and arrays keep their order. `undefined` is dropped and `null` kept. Example (illustrative stamp):
  `{"id":"en_4k2j9x0a1b2c","createdAt":1791380000000,"date":"2026-10-07","exerciseId":"ex_bench","notes":"","sessionId":"ses_upper_a","sets":[{"reps":8,"weight":120},{"reps":8,"weight":120}],"source":"log","updatedAt":1791380000000,"hlc":"0mgv7q2xs.0000.k3j9x0a1b2"}`
- **Line order:** entries by `(date, createdAt, id)`; check-ins by `(date, time, createdAt, id)`; `deleted.jsonl` by `(deletedAt, id)`; settings by `key`; every other table by `id`. New records mostly append at the end of a file, so a diff shows one `+` line per added record, one changed line per edit, and one `-` line per deletion, plus one `+` line in `deleted.jsonl`.
- **Empty files aren't written.** A month or table with no records has no file, and a file that becomes empty is deleted in the commit (`sha: null`).
- **Determinism:** `renderFiles` is pure, so the same records produce the same bytes on every device. Unchanged files then have the same blob SHA, which drives the download skip and the "nothing to upload" check. `layout.test.ts` pins it.
- **Excluded:** `isSynced` drops records with `sample: true` and settings outside `SHARED_SETTINGS` before rendering. When parsing, the same filter ignores such lines if someone adds them by hand.
- **Manifest (`groundwork.json`, pretty-printed, constant for a given format):**
  ```json
  {
    "app": "groundwork",
    "format": 1,
    "schema": 3,
    "about": "Synced by Groundwork. One record per line in each .jsonl file. Make changes in the app; edits made here can be overwritten."
  }
  ```
  It never changes between syncs, so it adds no noise. If `format > FORMAT` or `schema > BACKUP_SCHEMA`, the sync stops with `newer-format`. If the manifest's blob SHA equals `blobSha(renderManifest())`, it isn't downloaded.
- **Data README (`DATA_README`):** one paragraph on what the repository is and that each sync is one commit named after the device; the file list above; "One record per line. Make changes in the app: edits here may be overwritten. Keep this repository private."
- **Parsing (`parseFile`):** split on `\n`, skip blank lines, `JSON.parse` each line, and check it with `recordSchemas[table]` from `backup.ts` plus a required `hlc` matching the HLC pattern. Tombstone lines get a tombstone schema. The **original object is kept**: Zod is used to validate, not transform, so defaults never create phantom "updates". A failure throws `bad-data` with `{ path, line, issue }`. A record in the wrong month file is accepted and re-rendered into the right file at the next push.
- **Sizes:** an entry line is about 250–300 bytes. Ten entries a day is about 85 KB per month file. Five years comes to roughly 130 files and 6 MB, far below every GitHub limit (see GitHub API).

## Sync algorithm

### `runSync(ctx, { preview = false, reason })`

`ctx = { db, gh, cfg, device, now, onProgress }`. `reason` is `'manual' | 'undo'` in this version (phase 8 would add `'open' | 'change' | 'online'`). The whole call runs inside `withSyncLock`; automatic triggers use `ifAvailable` and skip when another tab is already syncing.

```ts
async function runSync(ctx, { preview = false, reason = 'manual' } = {}): Promise<SyncOutcome> {
  if (navigator.onLine === false) throw syncError('offline');
  const undo: Op[] = []; let undoSeq: number | null = null;
  const totals = { local: emptyCounts(), remote: emptyCounts() };
  const warnings: Warning[] = [];
  let checkedRepo = false;

  for (let attempt = 1; attempt <= 5; attempt++) {
    onProgress('checking');
    const state = await getMeta(db, 'syncState');                 // undefined until this device's first sync completes

    // 1. Branch head (cache: 'no-store'; GitHub sends max-age=60 on refs)
    let head: string | null;
    try { head = await gh.getRef(cfg.branch); }                    // 404 → null
    catch (e) {
      if (!isEmptyRepo(e)) throw e;                                // 409 "Git Repository is empty."
      if (preview) return previewEmpty(await readSyncSet(db));     // everything here would be uploaded
      head = await initRepo(gh, cfg);                              // Contents API creates the first commit
    }
    if (head === null) { await refreshBranch(ctx); continue; }     // default branch renamed: re-read GET /repos once, else `no-branch`

    // 2. Short circuit: nothing changed on either side
    if (state && head === state.commit && (await getMeta(db, 'seq')) === state.seq) return { kind: 'up-to-date', warnings };

    // 3. Remote listing
    const commit = head === state?.commit ? { tree: state.tree, remote: state.remote } : toInfo(await gh.getCommit(head)); // trailers give the device name
    const listing = await gh.getTree(commit.tree);                 // recursive; `truncated` → error 'too-many-files'
    const remote = new Map(listing.filter((e) => e.type === 'blob' && isManagedPath(e.path)).map((e) => [e.path, e.sha]));
    if (!remote.has(MANIFEST_PATH)) assertOnlyAllowedForeign(listing);   // README.md, LICENSE, .gitignore; else 'not-groundwork'
    else if (remote.get(MANIFEST_PATH) !== MANIFEST_SHA) checkManifest(await gh.getBlob(remote.get(MANIFEST_PATH)!)); // 'newer-format'

    // 4. Local snapshot (one read transaction: synced records, tombstones, seq, clock, sample index)
    const snap = await readSyncSet(db);
    const groupsL = groupByPath(snap.set);
    const shasL = await blobShas(renderFiles(snap.set));

    // 5. Download only files whose bytes differ from this device's rendering of the same path
    const need = [...remote].filter(([p, sha]) => p !== MANIFEST_PATH && shasL.get(p) !== sha);
    onProgress('downloading', { done: 0, total: need.length });
    const texts = await pool(4, need, ([, sha]) => gh.getBlob(sha));     // raw media type, decoded as UTF-8
    const R = index([...remote.keys()].filter((p) => p !== MANIFEST_PATH).flatMap((p) =>
      shasL.get(p) === remote.get(p) ? groupsL.get(p)! : parseFile(p, texts.get(p)!)));   // identical files: take this device's records

    // 6. Merge (pure)
    const stamp = Clock.from(snap.clock).observe(maxHlc(R)).stamper(device.id, now());
    const m = mergeSets(snap.set, R, { stamp, now: now() });
    if (wallOf(maxHlc(R)) > now() + 10 * MIN) warnings.push({ kind: 'clock', minutes: aheadBy(R) });
    if (preview) return { kind: 'preview', counts: m.counts, firstSync: !state, remoteHasData: remote.size > 1 };

    // 7. Apply locally first: verbatim, all or nothing, refused if anything was written since the snapshot
    if (m.local.length) {
      onProgress('saving');
      toast.dismiss();                                              // no stale Undo toasts after the data changed under them
      try {
        const inv = await applyOps(planToOps(m.local, snap.samples), { db, mode: 'verbatim', expectSeq: snap.seq, origin: 'sync' });
        undo.unshift(...inv); undoSeq = snap.seq + 1; addCounts(totals.local, m.counts.local);
      } catch (e) {
        if (e instanceof StaleError) { await backoff(attempt); continue; }   // a write landed mid-sync: start over
        throw syncError('storage', e);
      }
    }
    const syncedSeq = snap.seq + (m.local.length ? 1 : 0);          // expectSeq guarantees exactly one increment

    // 8. Render the merged state and diff it against the remote tree
    const files = renderFiles(m.merged);                            // includes groundwork.json
    const shas = await blobShas(files);
    const changes: TreeEntry[] = [
      ...[...files].filter(([p]) => remote.get(p) !== shas.get(p)).map(([path, content]) => ({ path, mode: '100644', type: 'blob', content })),
      ...[...remote.keys()].filter((p) => !files.has(p)).map((path) => ({ path, mode: '100644', type: 'blob', sha: null })),
    ];
    const finish = (c: string, t: string, info: RemoteInfo) =>
      setMeta(db, 'syncState', { commit: c, tree: t, seq: syncedSeq, at: now(), remote: info });
    if (!changes.length) { await finish(head, commit.tree, commit.remote); return result('pulled-or-up-to-date'); }

    // 9. Never upload to a public or archived repository (checked once per run, before the first write)
    if (!checkedRepo) { const r = await gh.getRepo(); if (!r.private) throw syncError('public'); if (r.archived) throw syncError('archived'); checkedRepo = true; }

    // 10. One commit, then compare-and-swap the branch
    onProgress('uploading', { files: changes.length });
    const tree = await gh.createTreeChained(commit.tree, changes);  // ≤ 1 MB of inline content per request, each on the previous base_tree
    if (tree === commit.tree) { await finish(head, commit.tree, commit.remote); return result('pulled-or-up-to-date'); } // never an empty commit
    const kind = reason === 'undo' ? 'undo' : remote.size <= 1 ? 'first' : 'sync';
    const c = await gh.createCommit({ message: commitMessage({ device: device.name, counts: m.counts.remote, kind, app: __APP_VERSION__ }), tree, parents: [head], author: AUTHOR(device) });
    try { await gh.updateRef(cfg.branch, c.sha); }                 // force: false
    catch (e) { if (isConflict(e)) { onProgress('retrying'); await backoff(attempt); continue; } throw e; }  // 409/422: another device pushed
    addCounts(totals.remote, m.counts.remote);
    await finish(c.sha, tree, { device: device.name, at: now() });
    return { kind: 'synced', totals, commitUrl: c.htmlUrl, undo, undoSeq, warnings };
  }
  throw syncError('busy');
}
```

- **Result kinds:** `result()` returns `up-to-date` when nothing was applied locally. Otherwise it returns `pulled` with `totals`, `undo` and `undoSeq`. A run that applied local changes and then fails afterwards rethrows with `partial: totals.local`, so the UI can say what arrived.
- **`backoff(attempt)`:** `250 ms × 2^(attempt−1)` plus up to 250 ms of random jitter.
- **`toInfo(commit)`:** `{ tree: commit.tree.sha, remote: { device: parseTrailers(commit.message).device, at: Date.parse(commit.committer.date) } }`.

### `initRepo(gh, cfg)`: the empty repository

The Git Data API answers 409 until the repository has a commit. The Contents API can create the first one.

```ts
try { await gh.putFile('README.md', DATA_README, 'Set up Groundwork sync'); }  // PUT /contents/README.md, base64 content, default branch
catch (e) { if (e.status !== 422) throw e; }   // 422: already exists (another device initialized it a moment ago)
return (await gh.getRef(cfg.branch)) ?? throwSyncError('no-branch');
```

The data itself then goes out through the normal path in the same run: GitHub's history shows "Set up Groundwork sync" followed by "Mac: first sync, 563 records". If the user ticked "Add a README file" when creating the repository, the repository isn't empty, the README is theirs, and Groundwork never touches it.

### First sync on a device

- **Repository empty, or with no Groundwork data:** no review. Test connection already said "the first sync uploads this device's data". The merge equals the local data, so the commit uploads every file.
- **Repository has data and this device has its own records** (any synced record whose `hlc` isn't `SEED_HLC`): run `runSync({ preview: true })` and show `FirstSyncReview` with both sides' counts. **Sync now** then runs a normal sync from scratch, so the counts may move slightly if something changed meanwhile.
- **Repository has data and this device has only starter records** (a fresh install): sync directly. The remote wins every record, and sample data stays local.

### What happens when a step fails

| Fails at | State afterwards | Next sync |
| --- | --- | --- |
| Before the local apply (offline, 401, 404, a parse or validation error, the app closed) | Nothing changed anywhere | Starts over |
| Local apply, `StaleError` | Nothing applied; retried within the run (up to 5 attempts) | n/a |
| Local apply, storage error (quota) | Transaction rolled back, nothing changed | Starts over |
| After the local apply, before the ref update (tree or commit request fails, offline, page frozen, `public`) | This device has the merged data; GitHub is unchanged; unreferenced tree or commit objects may exist (harmless); `syncState` isn't updated | The merge finds nothing new locally and uploads this device's state |
| Ref update returns 409 or 422 | As above | Retried within the run: re-reads the head and re-merges (the local copy already holds the earlier remote changes) |
| Ref update succeeded but the response was lost; or `setMeta('syncState')` failed | GitHub has the new commit; `syncState` is stale | The head differs, but every remote file's SHA equals this device's rendering, so there are no downloads and no push, and `syncState` is saved. About 3 requests |

Syncing again always converges, for three reasons:
- The merge is a join: idempotent, commutative and associative, with repairs that only add newer versions.
- Each write is atomic: one IndexedDB transaction, one ref update.
- The local apply comes before the push, so GitHub never holds a state that isn't already on the device that pushed it.

### `testConnection({ repo, token })`

1. Parse the repository as `owner/name` (`^[A-Za-z0-9-]+/[A-Za-z0-9._-]+$`). A pasted `https://github.com/owner/name(.git)` URL is accepted. Trim the token. Refuse `ghp_` and `gho_` prefixes (`classic-token`); expect `github_pat_`.
2. `GET /repos/{owner}/{repo}`: 401 gives `auth`; 404 gives `no-access`; `private !== true` gives `public`; `archived` gives `archived`. Keep `default_branch`, `full_name` and `html_url`.
3. `GET ref` on the default branch:
   - 409: the repository is empty, so the result is `{ ok, empty: true }`.
   - Otherwise, `GET commit` and `GET tree`. With no manifest and only README.md, LICENSE or .gitignore, the result is `{ ok, empty: true }`. With other files, the result is `not-groundwork`. With a manifest, check it, then return `{ ok, hasData: true, remote: { device, at } }`.
4. Write probe (non-empty repositories): `POST /git/blobs` with `"groundwork connection test\n"`. A dangling blob is invisible and harmless. 403 gives `read-only`, 404 gives `no-access`. For empty repositories, write access is checked by `initRepo` at the first sync (403 there also gives `read-only`).
5. Only after success: write `meta.github` and `meta.githubToken`, and delete `meta.syncState` if the repository changed.

### Undo of a sync (`undoSync(result)`)

`applyOps(result.undo, { mode: 'local', expectSeq: result.undoSeq, origin: 'user' })`. In local mode, tombstone ops are ignored. Records the sync added are deleted with fresh tombstones. Records it updated or deleted are re-put with fresh stamps. Then `runSync({ reason: 'undo' })` runs immediately, which writes a commit such as "Mac: undid a sync (deleted 3 entries, updated 1 check-in)". `StaleError` gives `undo-stale`. Undo is offered only for the latest result, only if that sync applied local changes, and only until `meta.seq` moves; the button disappears on the next write. It isn't persisted across reloads.

## GitHub API

| Purpose | Request | Notes |
| --- | --- | --- |
| Repository info | `GET /repos/{owner}/{repo}` | `private`, `archived`, `default_branch`, `full_name`, `html_url` |
| Branch head | `GET /repos/{o}/{r}/git/ref/heads/{branch}` | 409 means the repository is empty; 404 means there's no such branch |
| Commit | `GET /repos/{o}/{r}/git/commits/{sha}` | `tree.sha`, `message` (trailers), `committer.date` |
| Listing | `GET /repos/{o}/{r}/git/trees/{tree_sha}?recursive=1` | Check `truncated`. Not paginated |
| File | `GET /repos/{o}/{r}/git/blobs/{sha}` | `Accept: application/vnd.github.raw+json` returns the raw bytes; `res.text()` decodes them, so no base64 |
| Write probe | `POST /repos/{o}/{r}/git/blobs` | `{ content, encoding: 'utf-8' }` |
| Tree | `POST /repos/{o}/{r}/git/trees` | `{ base_tree, tree: [{ path, mode: '100644', type: 'blob', content }, { path, mode, type, sha: null }] }`. Inline `content` creates the blobs; `sha: null` deletes a file |
| Commit | `POST /repos/{o}/{r}/git/commits` | `{ message, tree, parents: [head], author }`. The committer defaults to the author; the date is server time. If GitHub returns 422, retry once without `author` |
| Compare-and-swap | `PATCH /repos/{o}/{r}/git/refs/heads/{branch}` | `{ sha, force: false }`. 422 "Update is not a fast forward" or 409 means a conflict, so retry |
| First commit | `PUT /repos/{o}/{r}/contents/README.md` | `{ message, content: base64(utf8) }`. The only base64 in the app |

- **Headers on every request:** `Accept: application/vnd.github+json` (raw for blob GETs); `Authorization: Bearer <token>`; `X-GitHub-Api-Version: 2026-03-10` (the newest supported version; `GET /versions` lists `2026-03-10` and `2022-11-28`, and none of the 2026-03-10 breaking changes touch these endpoints); `Content-Type: application/json` when there's a body.
- **Fetch options:** `cache: 'no-store'`, because GitHub sends `Cache-Control: max-age=60` on refs and a cached head would loop on 422 for a minute. `credentials: 'omit'`. `signal` combines a 20 s per-request timeout with the user's Cancel. The service worker has no runtime caching rule for `api.github.com`; don't add one.
- **Rate limits:**
  - Primary: 5,000 requests per hour per user. Secondary: 100 concurrent requests, 900 points per minute (GET 1, writes 5), and 80 content-creating requests per minute, 500 per hour.
  - A no-change sync is 1 request. A typical push is about 4 GETs plus 3 writes.
  - Manual syncs stay far below these limits.
  - Downloads run at most 4 in parallel.
  - On a 403 or 429 with `x-ratelimit-remaining: 0` or a `retry-after` header (both exposed to CORS), return `rate-limited`, with `retryAt` taken from `retry-after` or `x-ratelimit-reset`. The card shows when sync will work again.
- **Sizes:**
  - Blobs up to 100 MB are fine through the Git Data API. The Contents API's 1 MB limit for JSON reads is why reads use blobs, not `/contents`.
  - Tree listings truncate above 100,000 entries or 7 MB; expected is about 150 entries. Truncation gives `too-many-files`, which should never happen.
  - Inline tree content is batched at 1 MB per request. A first upload of 6 MB is 6 chained tree requests, then one commit.
- **CORS limits:** `Date` and `GitHub-Authentication-Token-Expiration` aren't exposed, so the token's expiry is unreadable. The user enters it (optional; prefilled to today + 366 days).
- **Redirects:** a renamed repository answers 301 or 307. `fetch` follows it, and the client updates `owner/repo` from `full_name` on the next `getRepo()`.
- **Error mapping (`github.ts`, then `errors.ts`):**

| Response | Code |
| --- | --- |
| `TypeError` from `fetch` (offline, DNS, blocked), or a timeout `AbortError` | `offline` |
| 401 | `auth` |
| 403 or 429 with rate-limit headers, or a body mentioning "rate limit" | `rate-limited` |
| 403 otherwise (e.g. "Resource not accessible by personal access token") | `read-only` on writes, `no-access` on reads |
| 404 on `/repos`, or on any write | `no-access` |
| 404 on `git/ref` | missing branch (re-read the default branch once, then `no-branch`) |
| 409 on `git/*` reads and on `initRepo`'s follow-up | empty repository (handled), or "still being created" (`busy`) |
| 409 or 422 on `PATCH ref` | conflict, so retry |
| other 422 | `invalid` (includes GitHub's `message`) |
| 5xx | `github-down` |

- **Privacy check:** at Test connection and once per sync run, before the first write. A public repository blocks uploads; it doesn't block reading.
- **Token expiry:** GitHub returns 401 once the token expires, giving the `auth` message. If `tokenExpiresAt` is set, the card warns 14 days ahead. GitHub also emails before a token expires.

## Setup UX

**Sync card, not connected** (first card on the Data page):
- Title "Sync with GitHub".
- Text: "Keep your devices in step through a private GitHub repository that only you can see. Every sync is saved there as a commit, so you also get a history of your data."
- Button: **Set up sync**.
- In iOS Safari (`isIOS() && !isStandalone()`): "You're using Groundwork in Safari. If you've added it to your Home Screen, set up sync there instead: the two keep separate data."

**`SetupDialog`** (`Modal` size md), three numbered sections on one scrolling page:

1. **Create a private repository**
   - "Create a new repository just for Groundwork data and make it Private. Don't use the Groundwork app's repository or any repository with code in it."
   - **Open GitHub** links to `https://github.com/new?name=groundwork-data&visibility=private&description=Groundwork%20data%2C%20synced%20by%20the%20app`.
   - Field "Repository", placeholder `kevinwilde/groundwork-data`, hint "Or paste its address."
   - Skip this step on the second device.
2. **Create a token for this device**
   - **Open GitHub** links to `https://github.com/settings/personal-access-tokens/new?name=Groundwork%20(iPhone)&description=Groundwork%20sync%20for%20kevinwilde%2Fgroundwork-data&target_name=kevinwilde&expires_in=366&contents=write`. The name, owner and repository come from the form; the device name is truncated so the token name stays within 40 characters.
   - Steps shown under the link:
     1. Sign in to GitHub if asked. The form opens with the name, expiry and permission filled in.
     2. **Resource owner:** your account (kevinwilde).
     3. **Expiration:** 366 days (filled in).
     4. **Repository access:** choose **Only select repositories**, then pick **groundwork-data**. This can't be filled in for you.
     5. **Permissions → Repository permissions → Contents: Read and write** (filled in). **Metadata: Read-only** is added automatically. Leave everything else at No access.
     6. Click **Generate token** and copy it. It starts with `github_pat_`, and GitHub shows it only once.
   - Fallback line: "If the form isn't filled in: github.com → your picture → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token."
   - Getting it onto the iPhone: "On iPhone, the easiest way is to do this in Safari on the phone (use Request Desktop Website if the page is cramped), copy the token, and paste it here. Or create it on your Mac and copy it there: with Handoff on, it reaches the iPhone's clipboard for a couple of minutes."
3. **Connect**
   - "Token": a masked text input (`-webkit-text-security: disc`, `autocomplete="off"`, `autocapitalize="none"`, `spellcheck={false}`, so no password-manager save prompt), with **Paste** (`navigator.clipboard.readText()`) and **Show**.
   - "Token expires on": a date, prefilled to today + 366 days; hint "Groundwork reminds you two weeks before."
   - "This device's name": prefilled from `defaultDeviceName()`; hint "Shown in your GitHub history, like 'iPhone: added 3 entries'."
   - **Test connection**.

**Test results** (shown under the button):

| State | Text | Next |
| --- | --- | --- |
| testing | "Checking kevinwilde/groundwork-data…" | spinner |
| empty | "Connected to kevinwilde/groundwork-data (private). It's empty, so the first sync sets it up and uploads this device's data." | **Sync now** |
| has data | "Connected to kevinwilde/groundwork-data (private). It has Groundwork data, last changed by Mac yesterday at 18:40." | **Sync now** (opens the first-sync review if this device has its own data) |
| error | the `errors.ts` message for the code (table below) | fix and test again |

**`FirstSyncReview`:**
- Title "First sync on this iPhone".
- Text: "GitHub has 612 records and this iPhone has 140 of its own. Syncing combines them: where both have the same record, the most recently changed copy wins. Records you deleted on one device before this update may come back."
- Two lists, by table using `LABELS`: "This iPhone gets: 480 logged entries added · 3 exercises updated" and "GitHub gets: 20 logged entries added".
- "If you're not sure, export a backup first."
- Buttons: **Export backup** (the same handler as the Backup card), Cancel, **Sync now**.

**Connected settings** (under a "Settings" disclosure in the card):
- "This device: iPhone · token github_pat_…X9aB, expires 7 Oct 2027".
- **Rename device**.
- **Replace token**: the Connect section again, with the repository fixed. Test, then save.
- **Disconnect**: a confirmation, "Disconnect this iPhone from GitHub? Your data stays on this iPhone and on GitHub. To revoke access completely, also delete this device's token on GitHub." This deletes `meta.github`, `meta.githubToken` and `meta.syncState`. The toast offers **Open GitHub tokens** (`https://github.com/settings/personal-access-tokens`).
- **Rotating a token:** on GitHub, open the token and choose Regenerate token (new value, same settings; the old value stops working at once). Then use Replace token on that device only. Other devices have their own tokens and aren't affected.
- **QR transfer of the token:** not planned. It would bring back a camera, a decoder and roughly 40 KB that this plan just removed, and a token on screen is easy to photograph. Creating the token on the phone, or Universal Clipboard, covers both devices. Reconsider only if a device with no Apple pairing is added.

## Sync UX

**Card, connected:**
- Status pill:
  - "Synced 2 hours ago" (ok);
  - "Not synced yet" (warn);
  - "Syncing…";
  - "Sync failed" (warn);
  - "Offline · sync when you're back online";
  - "Token expires in 6 days" (warn, when 14 days or fewer remain).
- Line: "kevinwilde/groundwork-data · latest change from Mac, today at 09:12" (`syncState.remote`; "from this iPhone" when it's this device).
- Buttons: **Sync now** (primary, `sync` icon; disabled while syncing) and **View history** (`https://github.com/{owner}/{repo}/commits/{branch}`).
- Warnings from the last result, shown under the status:
  - `clock`: "Your devices' clocks seem about 3 hours apart. Turn on Set Automatically in Date & Time on each device."
  - The stale-year warning from the edge-case table.

**Progress** (the line under the button while syncing): "Checking GitHub…", then "Downloading 2 of 3 files…", then "Saving on this iPhone…", then "Uploading 1 file…". On a retry: "Another device synced at the same time. Trying again…".

**Result** (replaces the progress line until the next write or sync):
- "Synced just now."
- "On this iPhone: 3 logged entries added · 1 check-in updated." or "Nothing new for this iPhone."
- "Sent to GitHub: 1 exercise updated. View commit" (`commitUrl`), or "Nothing to send."
- "Already up to date." when both sides were unchanged.
- **Undo on this iPhone**, only if local changes were applied. It confirms first:
  - Title "Undo the sync on this iPhone?"
  - Message: "This puts this iPhone back the way it was before the sync: removes 3 logged entries and restores 1 check-in. Groundwork then syncs, so your other devices change too. The earlier versions stay in your GitHub history."
  - Confirm label "Undo sync".
  - On `undo-stale`: "Something changed on this iPhone after the sync, so it can't be undone."
- Partial failure: "Got 3 changes from GitHub, but couldn't send this iPhone's changes. {message}"

**Commit messages** (`message.ts`):
- **Subject:** `{device}: {verb clauses}`, built from `counts.remote` in the order added, updated, deleted, restored; within a verb, tables by count descending, joined with ", " and " and ", using `NOUNS`. Example: "iPhone: added 3 entries and 1 check-in, updated 1 exercise".
  - Longer than 72 characters: "Mac: 412 changes (entries, check-ins, exercises, …)".
  - `first`: "Mac: first sync, 563 records".
  - `undo`: "Mac: undid a sync (deleted 3 entries, updated 1 check-in)".
  - Only expired tombstones dropped: "iPhone: tidied the deleted-records list".
- **Body:** one line per table, e.g. "Logged entries: 3 added, 1 updated".
- **Trailers** (`parseTrailers` reads them back):
  ```
  Groundwork-Device: iPhone
  Groundwork-Device-Id: k3j9x0a1b2
  Groundwork-Version: 1.1.0
  ```

**Automatic sync (`auto.ts`): deferred to phase 8, not in this version.** If it's built later it is **off by default**, behind a per-device switch "Sync automatically". The design for later:

| Trigger | Action |
| --- | --- |
| After `bootstrap()` (app open) | `sync('open')` |
| `visibilitychange` to visible | `sync('open')` if the last attempt was 60 s or more ago |
| `emitWrite` with `synced` and an origin other than `sync` or `bootstrap` | Debounce 30 s (each write resets it), then `sync('change')`; at most one automatic push every 2 min |
| `visibilitychange` to hidden with a change pending | `sync('change')` now (best effort; iOS may freeze the page, which is safe) |
| `online` | `sync('online')` if a change is pending or the last attempt was `offline` |

- **Skipped when:** offline (the change stays pending); `retryAt` is in the future; another sync holds the lock; or the last error was `auth`, `no-access`, `read-only`, `public`, `archived`, `newer-format`, `bad-data` or `not-groundwork`. Those last ones stop automatic sync until the next manual sync or a settings change.
- **When an automatic sync changed this device:** toast "Updated from Mac: 3 logged entries added." (no action; Undo lives on the Data card).
- **When an automatic sync fails:** no toast for `offline`, `github-down`, `rate-limited` or `busy`; the card shows it. For the stopping errors, one toast per app session, with a **Details** action that opens `/data`.

**Errors** (`errors.ts`). Each shows the message and its buttons; **Try again** is always offered except where noted.

| Code | Message | Buttons |
| --- | --- | --- |
| `offline` | "Couldn't reach GitHub. Check your connection and try again. Everything is still saved on this iPhone." | Try again |
| `auth` | "GitHub didn't accept this iPhone's token. It may have expired or been deleted. Create a new token on GitHub, then choose Replace token." | Replace token · Open GitHub tokens |
| `no-access` | "Couldn't find kevinwilde/groundwork-data, or this token can't see it. Check the name, and that the token's Repository access includes it." | Open GitHub tokens |
| `read-only` | "This token can read kevinwilde/groundwork-data but can't change it. On GitHub, edit the token and set Contents to Read and write." | Open GitHub tokens |
| `rate-limited` | "GitHub is limiting requests from your account. Sync will work again in about 12 minutes." | none (until `retryAt`) |
| `public` | "kevinwilde/groundwork-data is public, so anyone can read it. Nothing was uploaded. Make it private on GitHub (Settings → General → Danger Zone → Change visibility), then sync again." | Open repository settings |
| `archived` | "kevinwilde/groundwork-data is archived, so it can't be changed. Unarchive it on GitHub, or connect a different repository." | Open repository settings |
| `not-groundwork` | "kevinwilde/groundwork-data already has other files in it (such as package.json). Create a new, empty private repository just for Groundwork data." | none |
| `newer-format` | "The data on GitHub was saved by a newer version of Groundwork. Update this iPhone: close Groundwork and open it again, and tap Reload if it offers a new version. Then sync again." | none |
| `bad-data` | "A file on GitHub isn't valid Groundwork data: entries/2026-10.jsonl, line 14 (dates must look like 2026-09-25). Nothing was changed. If it was edited by hand, undo that edit on GitHub." | Open file |
| `no-branch` | "Couldn't find the branch main in kevinwilde/groundwork-data. If you renamed or deleted it, disconnect and set up sync again." | none |
| `busy` | "Another device kept syncing at the same time. Nothing was lost. Try again in a moment." | Try again |
| `storage` | "Couldn't save on this iPhone: {message}. Nothing was changed here or on GitHub." | Try again |
| `github-down` | "GitHub isn't responding properly right now ({status}). Try again in a few minutes." | Try again |
| `invalid` / `too-many-files` / unknown | "Sync failed: {message}. Try again. If it keeps happening, export a backup." | Try again |
| `classic-token` (setup) | "That's a classic token (ghp_…), which can reach every repository you have. Create a fine-grained token limited to groundwork-data instead." | none |
| `bad-repo` (setup) | "Enter the repository as owner/name, for example kevinwilde/groundwork-data." | none |

"iPhone" in these messages is `device.name`.

## Security and privacy

- **Where the token lives:** only in `meta.githubToken` in this origin's IndexedDB.
  - Never in `settings`, backups (`buildBackup` reads `TABLES` only), React state (`useData()` reads `TABLES` only; the card reads `meta.github`, which holds `tokenHint`), the repository, the build, URLs (header only) or logs.
  - `GitHubError` messages contain the status, GitHub's `message` and the path, never headers.
  - The setup form clears its token state after saving, and the UI never shows the token again; only `tokenHint` (last 4 characters) appears.
  - Tests assert that `github_pat_` is absent from an exported backup, from `readAll()` and from every error string.
- **XSS exposure:**
  - Any script running on the origin can read IndexedDB. Groundwork loads no third-party scripts: fonts are bundled and there's no analytics.
  - React escapes text, and there's no `dangerouslySetInnerHTML`.
  - Add a production-only CSP via a `transformIndexHtml` plugin with `apply: 'build'`. Dev uses inline HMR, so the dev server keeps no CSP.
    ```
    default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://api.github.com; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'
    ```
    `'unsafe-inline'` covers React style attributes, Recharts and Sonner. This blocks sending the token to arbitrary hosts. It doesn't stop a script that posts to api.github.com with its own credentials, so treat it as defense in depth.
- **Shared origin on GitHub Pages:** every project site under `kevinwilde.github.io` is the same origin, so they share IndexedDB. Any other Pages project published under that account could read Groundwork's data and token. Mitigations:
  - Don't publish untrusted code under that account's Pages.
  - Or serve Groundwork from a custom subdomain (a CNAME in the Pages settings), which gets its own origin. Moving origins means moving data once (sync makes that easy: set up sync on the new origin, then sync).
- **Limiting scope:** a fine-grained token, one repository, Contents read/write only (plus mandatory Metadata read), one token per device, 366-day expiry. Setup rejects classic tokens and repositories that hold other files (so a mis-pasted app repository can't be used).
- **Someone with an unlocked device:**
  - They can already read and change the data in the app, and sync.
  - Extracting the token takes developer tools (Safari Web Inspector needs a cable and a trusted Mac for iOS). The token reaches only the data repository: reading what the app already shows, adding commits, or force-pushing and deleting files (Contents write allows force updates of refs).
  - Recovery: delete that device's token on GitHub. The other device holds a full copy and re-uploads it at its next sync. Old commits stay reachable by SHA for a while.
  - With GitHub Pro, a branch ruleset on the data repository can block force pushes and deletion.
- **What GitHub can see:** the repository is plaintext. GitHub can technically read private repositories under its privacy statement. Anyone or anything else with access to the repository can read it too: collaborators, OAuth apps granted repository access, classic tokens.
- **History is permanent:** deleting a record in the app doesn't remove it from history. To purge history, delete the repository, create a new one, and sync again.
- **Contribution graph:** commits use the unlinked author `sync@groundwork.invalid`, so sync times don't show on the public contribution graph even with "Include private contributions" on.
- **Encryption, later phase (not v1):**
  - **Why not now:** encryption makes the history unreadable on GitHub, which defeats the history the user asked for. It adds a passphrase that must be entered on each device, and a lost passphrase loses the history, though the devices keep their data. It also adds code where bugs mean data loss.
  - **Sketch:** per-file AES-GCM with a key from PBKDF2-SHA-256 (600,000 iterations; salt and a key check in `groundwork.json`). The IV is derived as `HMAC(key, path ‖ plaintext)`, so identical plaintext gives identical ciphertext and blob-SHA skipping keeps working (this leaks only equality). The `format` becomes 2.

## Interaction with existing features

- **Undo toasts:** unchanged semantics (new edits). Syncs that change this device dismiss open toasts first.
- **Backups:** kept, and still useful. They are offline copies that don't depend on GitHub, protection if a bad change propagates, and the migration path between origins.
  - Format v3 adds tombstones and `hlc`, merge import uses `mergeSets`, and replace becomes a device reset.
  - The Backup card's text when connected: "Your data is also synced to GitHub. A backup file is a copy you keep yourself." Its warn pill ("Never backed up" or "Last backup 20 days ago") becomes ok if `syncState.at` is under 14 days old: "Synced to GitHub 2 hours ago".
  - Restore wording for merge: "Keeps the most recently changed copy of each record and applies deletions saved in the backup." For replace: "Replaces everything on this device with the backup. If sync is on, the next sync combines it with GitHub, and newer changes from your other devices still win."
- **Erase all:** a device-local reset (see the edge-case table). The confirm message when connected: "All data on this device will be deleted and the starter library loaded again. Your data on GitHub isn't touched: the next sync copies it back here. To stop syncing too, disconnect first." When not connected, the current wording stays.
- **Install card:** the iPhone note becomes "On iPhone and iPad the installed app keeps its own data, separate from Safari. Use GitHub sync in the app you use, or move your history with a backup." It also shows the version (`__APP_VERSION__`).
- **PWA offline cache:** the app shell stays precached and sync needs the network. The service worker never sees API calls, because Workbox has no runtime route for them. A deploy with a newer `format` makes old copies stop with `newer-format` until reloaded, and the existing "new version" prompt handles the reload.
- **Deploy workflow:** unchanged. `npm test` in CI runs every sync test against the fake GitHub; tests never touch the network and need no secrets. The data repository has no workflows and no Pages, and the data README says not to add them.
- **Multiple tabs:** Web Locks give one sync at a time. `expectSeq` covers writes from other tabs, and the CAS covers other devices.
- **Wording elsewhere:** the manifest description becomes "Track lifts, runs, movement snacks and how your body feels. Works offline; your data stays on your devices and, if you turn on sync, your own private GitHub repository." Update the `index.html` meta description the same way. The nav footer is unchanged.

## Checklist

### 1. Stamps, tombstones and schema v3 (no visible change)
- [x] `db/types.ts`: `Stamped` on all record types (including `Setting`), `Tombstone`, `Tables.tombstones`, `DataTable`, `TABLES: DataTable[]`. Fix `LABELS` and the backup `satisfies` to use `DataTable`.
- [x] `db/db.ts`: v3 block (`tombstones: 'id, deletedAt'`, `meta: 'key'`) and typed tables.
- [x] `sync/hlc.ts`, `sync/scope.ts`, `sync/canonical.ts`.
- [x] `data/ops.ts`: `applyOps(ops, { mode, expectSeq, origin, now, db })` as specified, plus `StaleError`. Clock, device id and `seq` are read and written inside the transaction. Local mode ignores tombstone ops.
- [x] `components/toast.ts`: `save(ops, opts?)`.
- [x] `db/seed.ts`: `libraryOps()` defaults to `createdAt: 0` and `hlc: SEED_HLC`; add `seedIndex()`.
- [x] `sync/legacy.ts` and `sync/local.ts` (`ensureDevice`, `stampLegacy`, `purgeTombstones`, `getMeta`/`setMeta`, `readSyncSet`). `bootstrap.ts` applies first-run seeding verbatim.
- [x] `DataPage` Erase: `[...TABLES.map(clear), clear('tombstones'), ...libraryOps(), put seeded]`, verbatim, plus deleting `meta.syncState`.
- [x] Tests:
  - `hlc.test.ts`: string order equals numeric order; the clock only moves forward when the wall clock goes backwards; counter overflow; `observe`.
  - `ops.test.ts`: puts are stamped; unchanged puts keep their stamp; a delete writes a tombstone; sample and device-local deletes don't; Undo of a delete beats its tombstone and removes it; local mode ignores tombstone ops; a verbatim replay of the inverse restores the exact state including tombstones; `StaleError`.
  - `migration.test.ts`: a v2 database opens as v3 with its data intact. After `stampLegacy`, every record has `hlc`, unchanged seed records equal the seed, edited ones get legacy stamps, and missing starter records get `SEED_GONE_HLC` tombstones. A second run changes nothing.

### 2. Merge as pure functions
- [x] `sync/merge.ts` (`mergeSets`, `winner`, `diff`, `count`, `planToOps` with the sample cascade, retention) and `sync/integrity.ts`.
- [x] `merge.test.ts`, table-driven over every row of the edge-case table that the merge decides:
  - merging the same pair twice gives an empty local plan the second time;
  - swapping sides mirrors the counts;
  - seed records unchanged on both sides produce nothing;
  - sample records and `seeded`/`lastExportAt` never appear;
  - expired tombstones drop out and become purge changes.
- [x] `integrity.test.ts`: restoring an exercise, a type and a body part; stripping a tag; repair stamps newer than both sets; restores repeat until nothing changes.
- [x] `mergeConvergence.test.ts`, over two fake-indexeddb databases using the real `applyOps` and `mergeSets` (no GitHub yet):
  - a seeded PRNG drives about 200 random creates, edits, deletes, cascades and undos, with random direct merges and clock offsets up to ±10 min;
  - after a final merge, `readSyncSet` must be equal on both;
  - skew case: device A's clock is 5 min slow, A edits after a merge, and A's edit wins the next merge.

### 3. Backups use the merge (sync by file works after this phase)
- [x] `backup.ts`: schema 3, `tombstones`, `hlc`, exported `recordSchemas`, `buildBackup(raw, tombstones)`, `mergeImport(local, parsed)` returning `{ ops, counts }`, `replaceImportOps(parsed)`. Merge skips sample records and device-local settings.
- [x] `DataPage` Restore: the new wording and a toast with counts. Export reads `db.tombstones`. Replace deletes `meta.syncState`.
- [x] Tests: v3 round trip; a v2 file merges using legacy stamps; merge doesn't overwrite a newer local edit; replace clears tombstones; update the existing `importOps` tests; a backup never contains `meta`.

### 4. Repository layout, git SHAs and commit messages (pure)
- [x] `sync/layout.ts`, `sync/gitsha.ts`, `sync/message.ts`, `src/db/labels.ts` (`LABELS`, `NOUNS`).
- [x] `layout.test.ts`:
  - the same set inserted in different orders renders identical bytes;
  - key order (`id` first, `hlc` last, nested keys alphabetical) and line order per table;
  - month split; empty tables produce no file;
  - `parseFile(renderFiles(x))` round-trips;
  - parsing applies no defaults;
  - a bad line reports path and line number;
  - sample and device-local lines are ignored;
  - `isManagedPath` rejects `README.md`, `package.json` and `entries/2026-1.jsonl`;
  - the manifest SHA is stable.
- [x] `gitsha.test.ts`: `blobSha('')` is `e69de29bb2d1d6434b8b29ae775ad8c2e48c5391`; `blobSha('hello world\n')` is `3b18e512dba79e4c8300dd08aeb37f8e728b8dad`; non-ASCII text matches Node's `createHash('sha1')` over `blob <bytes>\0…`.
- [x] `message.test.ts`: verb clauses, the 72-character fallback, `first`, `undo`, housekeeping, trailers round trip.

### 5. GitHub client and fake GitHub
- [x] `sync/github.ts`: the endpoints, headers, `cache: 'no-store'`, timeouts, chained tree creation (1 MB batches), base64 only in `putFile`, raw blob reads, and the error mapping.
- [x] `src/test/fakeGitHub.ts`, an in-memory GitHub behind a `fetch` function:
  - repository flags (`private`, `archived`, `empty`, `defaultBranch`) and token states (`valid`, `expired`, `read-only`, `no-access`);
  - blobs keyed by real git SHA-1;
  - content-addressed trees, so identical content gives an identical SHA;
  - recursive listing; commits with server dates; `PATCH ref` with a real fast-forward check (walks parents); `PUT contents` on an empty repository;
  - 409 for git reads on an empty repository;
  - `failNext(route, response)`, `before(route, hook)` for interleavings, rate-limit responses with headers, and a request log.
- [x] `github.test.ts`, against the fake:
  - each status maps to the right code;
  - `retryAt` comes from `retry-after` or `x-ratelimit-reset`;
  - a `TypeError` maps to `offline`;
  - every request carries the `Accept`, `Authorization` and `X-GitHub-Api-Version` headers;
  - refs use `no-store`;
  - `String(error)` and `error.message` never contain the token;
  - chained trees above 1 MB use several requests.

### 6. Sync engine (no UI)
- [ ] `sync/engine.ts` (`runSync`, `initRepo`, `testConnection`, `undoSync`), `sync/lock.ts`, `sync/device.ts`, `sync/errors.ts`.
- [ ] `engine.test.ts`, with two `GroundworkDB` instances with different names and one fake:
  - first sync to an empty repository gives the README commit, then one data commit; the files equal `renderFiles`;
  - first sync of the second device with its own data: preview counts, then sync, and both are equal;
  - a sync with nothing changed is exactly 1 request;
  - one local entry gives one commit touching one month file, with the right message;
  - a remote change downloads only the differing files (checked in the request log);
  - concurrent syncs: A pauses in `before('updateRef')`, B syncs fully, A gets 422, retries and converges; history is linear;
  - a local write injected between snapshot and apply gives `StaleError`, a retry, and the write is pushed;
  - failures at each row of the failure table leave the stated state, and the next sync converges;
  - the ref update succeeds but the response is lost: the next sync downloads nothing and pushes nothing;
  - `public`, `archived`, `read-only`, `auth`, `not-groundwork`, `newer-format` and `bad-data` each change nothing locally or remotely;
  - deletion propagation; delete-then-edit revival; an integrity restore across devices; the sample cascade on a device that has sample data;
  - `undoSync` deletes the added records everywhere after the follow-up sync; `undo-stale` after a write;
  - erase-all, then sync, restores the data and creates no commit;
  - an expired tombstone leaves `deleted.jsonl`;
  - `github_pat_` never appears in a backup, in `readAll()` or in any thrown error.
- [ ] `syncConvergence.test.ts`, a seeded property test with three devices and one fake:
  - about 300 steps of random ops (the real builders from `lib/model.ts`) and random syncs, with clock offsets up to ±10 min;
  - random interleavings (a `before` hook runs another device's whole sync at a random point) and 5% injected request failures;
  - after every step, fold every device's `readSyncSet` into an oracle (per key, the highest `hlc` ever seen);
  - at the end, sync all devices until a full round makes no commit, then assert: every device equals the parsed remote, both equal the oracle, every commit's files parse, and no commit's tree equals its parent's.

### 7. Setup and manual sync UI
- [ ] `sync/status.ts`, `ui/SyncCard.tsx`, `ui/SetupDialog.tsx`, `ui/FirstSyncReview.tsx`, `ui/SyncResult.tsx`. The card is first on `DataPage`, with a live query on `meta` `github`, `syncState` and `device`.
- [ ] Prefilled repository and token links built from the form; masked token input with Paste; expiry date; device name; Test connection states; Rename, Replace token, Disconnect.
- [ ] Progress, results, View commit, Undo with confirmation, error panels with the exact wording and buttons above, the expiry warning, and the clock and stale-year warnings.
- [ ] `lib/dates.ts` `fmtAgo` and `fmtWhen` (with tests), the `sync` icon, `__APP_VERSION__` and `src/globals.d.ts`, version in the Install card, `package.json` set to 1.1.0.
- [ ] Wording updates in Backup, Restore, Install and Erase, plus the manifest and meta descriptions.
- [ ] Browser check on the dev server, pointing `createGitHub` at the fake through a dev-only `?fakeGitHub` switch (`import.meta.env.DEV` only): setup, first sync, results, Undo, each error panel, phone width and dark mode.

### 8. Automatic sync (deferred, not in this version)
- [ ] `sync/auto.ts` and `<AutoSync />` in `App.tsx`: the triggers, debounce, minimum interval, backoff until `retryAt`, stopping errors, toasts, and the toggle in the card (`meta.github.auto`, **off by default**).
- [ ] `auto.test.ts` with fake timers and injected `events`, `online` and `lock`:
  - five writes in 20 s produce one sync 30 s after the last;
  - two automatic pushes are never closer than 2 min apart;
  - `hidden` with a change pending syncs at once;
  - offline marks the change pending, and `online` syncs it;
  - `auth` stops automatic sync until a manual sync;
  - `origin: 'sync'` writes don't trigger;
  - nothing runs before the first sync.

### 9. Hardening, docs and real devices
- [ ] The production CSP plugin in `vite.config.ts`, and a test that the built `index.html` contains it. Check that charts, toasts, fonts and sync work with no CSP violations in Safari and Chrome.
- [ ] README: a Sync section (repository, token, per-device setup, what's in the repository, privacy, the shared `github.io` origin), the "Where data lives" note, and schema v3.
- [ ] Manual checklist below against a real private repository on the deployed build. Add verification notes to this plan.

### 10. Later (deferred, not in this version)
- [ ] **History and restore:**
  - List commits with `GET /repos/{o}/{r}/commits?sha={branch}&per_page=30` (paginated by `Link`), showing date, device and subject.
  - Restore a whole commit, or one record by its file history (`?path=`). Read that commit's tree, parse it, and apply the differences as **new edits** (`local` mode: old records re-put with fresh stamps, records absent then deleted now). Push "iPhone: restored data from 3 Oct 2026 (abc1234)".
  - Only new edits stick: resetting the ref alone would be undone by devices re-uploading their copies.
- [ ] **Encryption** (format 2, as sketched under Security).
- [ ] Optional: a local blob cache keyed by SHA, if downloading one month file per sync ever matters; QR token transfer (see Setup); field-level merge.

## Testing

- **Unit tests (pure):** `hlc`, `canonical`, `merge`, `integrity`, `layout`, `gitsha`, `message`, `errors`, `fmtAgo`/`fmtWhen`.
- **Database tests (fake-indexeddb):** `applyOps` stamping, tombstones and replay; the v2 to v3 migration with `stampLegacy`; backup merge and replace; the merge-only convergence test.
- **Fake GitHub (`src/test/fakeGitHub.ts`):** implements exactly the endpoints listed under GitHub API, at the `fetch` level, so `github.ts` is exercised too. It uses real git blob SHAs so the download skip is tested for real. It supports CAS conflicts, empty repositories, permission states, rate limits, injected failures and interleaving hooks. Node 22 provides `fetch`, `Response`, `crypto.subtle` (SHA-1) and `TextEncoder`. `navigator.onLine` and locks are injected. No test touches the network.
- **End-to-end:** `engine.test.ts` and `syncConvergence.test.ts` between two or three named databases, as listed in phase 6.
- **Manual test against a real private repository:**
  - [ ] Create `kevinwilde/groundwork-data` (private, empty). In Mac Safari, set up from the prefilled links. Test connection says it's empty. The first sync makes two commits (setup, then "first sync"), and the files and line format match this plan.
  - [ ] iPhone Home Screen app: create the iPhone's own token in Safari on the phone, paste it in the app, test, go through the first-sync review, and sync. A second sync says "Already up to date", and Web Inspector shows one request.
  - [ ] Universal Clipboard: copy a token on the Mac and use Paste on the iPhone.
  - [ ] Log an entry on the iPhone and tap Sync now: a commit appears ("iPhone: added 1 entry") whose diff is one added line. Tap Sync now on the Mac: the entry arrives.
  - [ ] With the iPhone in airplane mode, edit the same exercise on both devices, then reconnect and sync both. The later edit wins on both.
  - [ ] Delete an exercise on the Mac and log it on the iPhone before syncing. After both sync, the exercise is restored on both.
  - [ ] Tap Sync now on both devices at once. Both succeed (one retries), history stays linear, and the data is equal.
  - [ ] Airplane mode: Sync now shows the `offline` message, edits keep working, and after reconnecting Sync now works.
  - [ ] Delete the iPhone's token on GitHub. The next sync shows `auth`, Replace token fixes it, and the Mac is unaffected.
  - [ ] Make the repository public for a moment. Sync refuses to upload with the `public` message. Make it private again.
  - [ ] A token with Contents set to Read-only: Test connection shows `read-only`.
  - [ ] Erase all on the iPhone. The next sync restores everything and creates no commit.
  - [ ] Undo a sync on the Mac: check the confirmation text, the revert, the follow-up "undid a sync" commit, and that the iPhone matches after its next sync.
  - [ ] Swipe the app away during "Uploading", then reopen. Sync converges with no duplicate commit.
  - [ ] Set the token's expiry date to 3 days ahead: the warning pill appears.
  - [ ] Search the repository, an exported backup and the console for `github_pat_`: no matches.
  - [ ] View history opens the commits page. The production build shows no CSP violations.

## Risks and open questions

| Risk | Mitigation |
| --- | --- |
| Token stolen through XSS, or by another Pages site on the shared `kevinwilde.github.io` origin | No third-party scripts; production CSP; single-repository scope; one token per device; a custom-domain recommendation in the README; revoke on GitHub. |
| Browser HTTP cache returns a stale ref (`max-age=60`) | `cache: 'no-store'` on every request, plus a test that refs use it. |
| Rate limits | A 1-request no-change path, `rate-limited` with `retryAt`, clear commit subjects. Phase 8 would add a debounce and a minimum interval. |
| iOS freezes or kills the page mid-sync | Every step is atomic; the failure table; convergence tests with injected failures. |
| First sync of pre-v3 data brings back deleted records | Starter-record tombstones, the first-sync review with counts and Export backup, Undo (as new edits). |
| Hand edits on GitHub | Validation with file and line; the data README warns; ties are deterministic. |
| GitHub API changes or outages | Pinned `X-GitHub-Api-Version`; mapped errors; local-first, so the app keeps working and syncs later. |
| Clock far off on one device | HLC ordering stays correct; the clock warning. |
| Contents write allows force-pushes (stolen token, or a bug) | No code path sends `force: true` (tested). Other devices re-upload their full copies. Branch ruleset with GitHub Pro. |
| GitHub rejects the `.invalid` author email | Retry the commit once without `author` (default identity) and remember that for the session. |
| Universal Clipboard expires quickly | Create each device's token on that device; the Paste button; the long-press fallback. |
| Two tabs syncing at once | Web Locks, plus `expectSeq` and the CAS. |
| `applyOps` changes touch every write | Phase 1 tests before any sync code. Cost is one extra `meta` read and write per transaction. |
| Dexie v3 upgrade while an old tab is open | Dexie closes the older connection on `versionchange`; the existing PWA "new version" prompt asks for a reload. |

Open questions (with recommended answers):

1. **Automatic sync?** Deferred (phase 8). If added: off by default, with a per-device switch.
2. **One token per device, or one shared?** Per device: GitHub shows a token once, it lets you revoke one device, and expiries can be staggered.
3. **Token expiry: 366 days or none?** 366 days, with the in-app reminder. "No expiration" is allowed by GitHub, but a token that never expires is riskier.
4. **Commit author: device identity or the user's account?** Device identity with the unlinked address. It reads better and keeps exercise times off the public contribution graph.
5. **Should erase or replace ever reach other devices ("Erase everywhere")?** No in v1. Both are device resets. To delete everything, delete the repository.
6. **Is `lastExportAt` per device?** Keep it per device. The Backup pill also counts recent syncs as backed up.
7. **Field-level merge** for the same record edited on two devices between syncs: out of scope. The whole record is the unit.
8. **Supporting hand edits** (a remote record whose content changed but whose `hlc` didn't): not in v1. A later option is "remote wins such ties and is restamped".
9. **Custom domain** for a separate origin: recommended if anything else is published on `kevinwilde.github.io`.
10. **History browsing and restore:** phase 10, as new edits.
11. **Encryption:** phase 10, with deterministic per-file IVs so the download skip keeps working.
12. **QR token transfer:** not planned unless pasting proves insufficient.
