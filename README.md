# Groundwork

A personal exercise tracker that runs entirely in your browser and works offline once installed.
Everything is stored in IndexedDB; there is no server of its own and no account. Devices can sync through a private GitHub
repository that you own (see [Sync](#sync)). Back up with **Data → Export all data** and restore from the same file.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
```

Other scripts:

| Script | What it does |
| --- | --- |
| `npm run build` | Type-checks, then builds the installable PWA into `dist/` |
| `npm run preview` | Serves the production build (service worker included) at http://localhost:4173 |
| `npm test` | Runs the Vitest suite |
| `npm run typecheck` | `tsc -b` only |

## Offline and installing

Groundwork is a Progressive Web App. After it has loaded once from a web address, it works with no
connection: the service worker caches the whole app, including its fonts and icons, and your data
already lives on the device.

- **Hosting:** put the contents of `dist/` on any static host that serves HTTPS (GitHub Pages,
  Netlify, Cloudflare Pages, S3). `.github/workflows/deploy.yml` tests, builds and publishes to
  GitHub Pages on every push to `main` (set Settings → Pages → Source to GitHub Actions). Paths are relative and routes use the URL hash, so a sub-path such
  as `username.github.io/groundwork/` works without rewrites. Service workers don't run from
  `file://`, so opening `dist/index.html` from disk doesn't work.
- **Installing:** Chrome, Edge and Android show an **Install app** button on the Data page. On iPhone
  or iPad, open the site in Safari, tap Share, then **Add to Home Screen**. In Safari on a Mac, use
  File → Add to Dock.
- **Updates:** when you deploy a new build, open copies download it in the background (they also check
  hourly) and show "A new version of Groundwork is ready" with a **Reload** button. Nothing reloads by
  itself, so a half-filled form is never lost.
- **Where data lives:** each browser, and each installed copy, has its own database. On iPhone the
  home-screen app does not share data with Safari tabs. Set up sync in the copy you use, or use Data →
  Export / Restore to move history between them. Installed apps are also less likely to have their
  storage cleared by the browser.

To try offline locally: `npm run build && npm run preview`, open http://localhost:4173 in Chrome, wait
for "Groundwork is ready to work offline", then stop the preview server (or tick **Offline** in DevTools →
Network) and reload.

Icons are generated at build time from `public/logo.svg` (settings in `pwa-assets.config.ts`).
Service-worker options live in `vite.config.ts`; in `npm run dev` the service worker is off.

## What's in it

- **Today**: a movement-snack card (least recently done first, daily targets, one-tap Done, a
  countdown for timed holds), today's training, how you feel, and the current week.
- **Log**: pick a date and an exercise and record it. Set-based types get a set table and quick entry
  (`3x6@100`, `3 × 60s`, `5x5 225`); single-effort types get a field grid with live pace.
- **Saved sessions**: a named group of exercises you do together, like "Upper A" (bench, pull-ups,
  overhead press). Pick it on the Log page and every exercise appears prefilled with what you did the
  last time you logged that session (or the exercise's last entry, or the session's plan). Adjust
  anything, skip an exercise or add one for the day, then **Log all**. Create sessions under
  Library → Sessions, or use **Save as session** on a day you've already logged.
- **Calendar**: month, year and list views. Filter by tags (any/all), exercises, types or saved sessions; colour by
  tag, exercise or type, or shade by a measure (entries, sets, reps, volume, time, distance). Overlays
  for check-ins and a body part's pain score. Saved views, days-per-week chart, and a progress chart
  when a single exercise is selected.
- **Check-in**: as many per day as you like, each with a moment, an overall 1–5 feeling, notes, and a
  0–10 pain score for every active body part. Pain trend charts and history.
- **Library**: exercises, saved sessions, mini-exercises, tags, exercise types (with a field editor) and body parts.
  Mark a body part inactive to stop being asked about it while keeping its history.
- **Data**: sync with GitHub, export/import (merge or replace, validated with Zod), install and offline
  status, sample history, storage status, week start and theme settings, erase all.

On first run the app loads a starter library and ten weeks of **sample history** (flagged, shown with
a "sample" badge) so the calendar has something to show. Remove it from the banner or the Data page;
your own entries are never touched.

## Sync

Sync keeps devices (say an iPhone and a Mac) in step through a **private GitHub repository** that you
create, for example `kevinwilde/groundwork-data`. Groundwork calls the GitHub REST API straight from the
browser; there is still no server of its own. Every sync that changes anything is one commit named after
the device ("iPhone: added 3 entries"), so the repository's history shows your data changing over time
and old states can be recovered from it. Sync runs when you tap **Sync now** on the Data page; it never
syncs on its own. Offline, everything keeps working on the device and sync waits.

**Setting it up** (Data → Sync with GitHub → Set up sync):

1. **Create the repository** once: new, **Private**, used for nothing else. Don't use the app's own
   repository or anything with code in it; setup refuses repositories that hold other files.
2. **Create a token for each device**: a fine-grained personal access token limited to that one
   repository, with **Contents: Read and write** (Metadata: Read-only is added automatically) and a
   366-day expiry. The dialog's **Open GitHub** link prefills the form; you still pick the repository
   under "Only select repositories". One token per device means a lost phone can be cut off without
   touching the Mac. On iPhone, create the token in Safari on the phone and paste it, or copy it on the
   Mac and use Universal Clipboard.
3. **Connect**: paste the token, check the expiry date and device name, and **Test connection**. Nothing is
   saved until the test passes. On the second device, enter the same repository with its own token.

The first sync of a device that already has data of its own shows both sides' counts first and offers a
backup. Where both sides have the same record, the most recently changed copy wins.

**What's in the repository:** JSON Lines files, one record per line: `types.jsonl`, `tags.jsonl`,
`exercises.jsonl`, `snacks.jsonl` (mini-exercises), `sessions.jsonl`, `bodyParts.jsonl`, `views.jsonl`,
`settings.jsonl` (the week start only), `entries/YYYY-MM.jsonl` and `checkins/YYYY-MM.jsonl` by month,
`deleted.jsonl` (deletions, so they reach every device; kept for a year), and `groundwork.json` (the
format). Sample data and device-local settings never leave the device. Make changes in the app: hand
edits on GitHub may be overwritten, and a malformed line stops sync with its file and line number.

**How it merges:** every write is stamped with a hybrid logical clock, so the newest edit wins even when
two devices' clocks disagree, and deletions leave tombstones instead of coming back. If one device deletes
an exercise that the other has just logged, the exercise is restored rather than the entry vanishing.
**Undo on this device** after a sync reverts it as new edits and syncs again, so the undo reaches your
other devices; the earlier versions stay in the history.

**Privacy and security:**

- The repository is plaintext: anyone with access to it (and GitHub itself) can read it. Keep it private;
  sync refuses to upload to a public or archived repository.
- The token is stored only in this device's IndexedDB (`meta` table). It is never in backups, the
  repository, URLs or error messages, and the app only ever shows its last four characters. Production
  builds set a Content Security Policy that only allows requests to the app itself and api.github.com.
- **Shared origin on GitHub Pages:** every project site under `username.github.io` is the same origin
  and shares IndexedDB, so any other Pages site published under that account could read Groundwork's data
  and token. Don't publish untrusted code there, or serve Groundwork from its own custom subdomain (a
  CNAME in the Pages settings). Moving origins means setting up sync on the new one, then syncing.
- To revoke a device, delete its token on GitHub (Settings → Developer settings → Personal access
  tokens). To rotate one, choose Regenerate token on GitHub and then **Replace token** on that device.
  Data → Sync with GitHub → Settings → **Disconnect** forgets the repository and token on a device; the
  data stays.
- Deleting a record doesn't remove it from the history. To purge history, delete the repository, create
  a new one and sync again.

Erase all and Replace import reset only this device; the next sync merges with GitHub again. Backups are
still useful as offline copies that don't depend on GitHub.

Tests never touch the network: `src/test/fakeGitHub.ts` is an in-memory GitHub behind `fetch`. In
`npm run dev`, open the app with `?fakeGitHub` (for example `http://localhost:5173/?fakeGitHub#/data`) to
point sync at that fake instead of GitHub; it is exposed as `window.__fakeGitHub` and isn't part of
production builds.

## Project layout

```
src/
  db/          Dexie schema, record types, seed data, backup (export/import)
  data/        DataProvider (live query → in-memory indexes), applyOps (writes + undo), hooks
  sync/        GitHub sync: clock stamps, merge, repository layout, GitHub client, engine, Sync card (ui/)
  lib/         Pure logic: dates, formatting, colours, summaries/metrics, quick entry, calendar aggregation
  components/  UI primitives, modal host, entry editor, dialogs, check-in form, charts
  pages/       Today, Log, Calendar, Check-in, Library, Data
  styles/      app.css (design tokens for light and dark, all component styles)
public/
  logo.svg     Source for the generated app icons
```

The database is on schema version 3 (v2 added saved sessions; v3 added `tombstones` and the device-local
`meta` table for sync); existing data upgrades automatically when the new version first opens, and records
saved before v3 get their sync stamps once at startup.

All writes go through `applyOps()` in `src/data/ops.ts`, which runs them in one IndexedDB transaction and
returns the inverse ops; that is how every delete offers Undo. It also stamps every write for sync and
leaves a tombstone for every deletion. To change the schema, add a new `this.version(n)` block in
`src/db/db.ts` rather than editing version 1.

See [plans/device-sync.md](plans/device-sync.md) for the sync design.

See [plans/initial-implementation.md](plans/initial-implementation.md) for the initial implementation plan and data model.
