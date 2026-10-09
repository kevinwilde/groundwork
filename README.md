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
  countdown for timed holds), what's planned, today's training, how you feel, and the current week.
- **Log**: pick a date and an exercise and record it. Set-based types get a set table and quick entry
  (`3x6@100`, `3 × 60s`, `5x5 225`); single-effort types get a field grid with live pace.
- **Saved sessions**: a named group of exercises you do together, like "Upper A" (bench, pull-ups,
  overhead press). Pick it on the Log page and every exercise appears prefilled with what you did the
  last time you logged that session (or the exercise's last entry, or the session's plan). Adjust
  anything, skip an exercise or add one for the day, then **Log all**. Create sessions under
  Library → Sessions, or use **Save as session** on a day you've already logged.
- **Plans**: workouts planned ahead with every set's target, then followed at the gym one tick at a
  time. See [Workout plans](#workout-plans).
- **Calendar**: month, year and list views. Filter by tags (any/all), exercises, types or saved sessions; colour by
  tag, exercise or type, or shade by a measure (entries, sets, reps, volume, time, distance). Overlays
  for check-ins and a body part's pain score. Saved views, days-per-week chart, and a progress chart
  when a single exercise is selected.
- **Check-in**: as many per day as you like, each with a moment, an overall 1–5 feeling, notes, and a
  0–10 pain score for every active body part. Pain trend charts and history.
- **Library**: exercises, saved sessions, mini-exercises, tags, exercise types (with a field editor) and body parts.
  Mark a body part inactive to stop being asked about it while keeping its history. Turn on **Reorder**
  under Body parts to move them up or down; check-ins and pain trends list them in the same order.
- **Data**: sync with GitHub, export/import (merge or replace, validated with Zod), install and offline
  status, sample history, storage status, week start and theme settings, erase all.

## Workout plans

A plan is one dated workout: a name, exercises with a target for every set (`5 × 190 lb`) or for a
single effort (`5 mi in 40:00`), and notes. It is separate from a saved session: a session is a reusable
template, and a plan is often started from one, but editing a plan never changes the session.

- **Planning**: the **Plans** page (`#/plan`, reached from Today, the Log page's **Plan for later** and the
  Calendar page; it isn't a tab) shows plans missed in the last two weeks, the next 14 days one by one, and
  anything later. **+ Plan** starts from a saved session (targets come from the last time you did it,
  then your history, then the session's own plan), from a day you've logged, or blank. The editor
  takes quick entry (`3 × 5 @ 190`, `5 @ 115, 2 × 5 @ 105`), has a **+5 lb** chip (2.5 for kg), and shows
  when you last did each exercise. Targets are optional. A day can hold any number of plans, for any date
  ahead. Plans can be duplicated or moved to another day. On the calendar, a day with a plan still to do
  gets a dashed outline, and the day dialog lists its plans.
- **Working out** (`#/plan/<id>`): tap a set's tick to log it as planned; tap it again to untick. A run's
  tick opens its fields instead, prefilled with the target, so you log what actually happened (targets
  from past runs keep only time and distance, never last time's heart rate or RPE). Tap the
  row to change what you did (steppers for reps, weight, time and distance), skip it, or remove an added
  set. If you change a weight, Groundwork offers it for the later sets that had the same target. **Every
  tick is saved at once** as that exercise's entry, so closing the app or a locked phone loses nothing, and
  ticked sets show in Today's training and the calendar like any other entry. **Finish** shows sets done
  against planned and anything that fell short; a finished plan can be reopened. A saved session's
  **Start workout** on the Log page makes a plan for that day and opens it; **Log all** still logs a
  whole session afterwards in one go.
- **Status** is worked out, never stored: planned, missed (nothing ticked and the day has passed), in
  progress, or done (finished, or every set ticked or skipped). Plans for past days log to their own
  date, with a **Move to today** link.
- **A plan's entries and History**: deleting a plan's entry from History unticks that exercise in the
  plan (Undo brings both back). You can also edit a plan's entry in History, but the plan stays in charge
  of it: the next tick on that exercise, moving the plan to another day, or saving a change to that
  exercise in the plan editor rewrites the entry from the plan's ticked sets. Deleting a plan keeps its
  entries.

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
`settings.jsonl` (the week start only), `entries/YYYY-MM.jsonl`, `checkins/YYYY-MM.jsonl` and
`plans/YYYY-MM.jsonl` by month, `deleted.jsonl` (deletions, so they reach every device; kept for a
year), and `groundwork.json` (the format). Format 2 added plans: once one device has synced with this
version, devices still on an older one stop with a message asking to update the app, before changing
anything. The first sync after updating rewrites `groundwork.json`; if nothing else changed, its commit
says "updated the repository format". Sample data and device-local settings never leave the device. Make changes in the app: hand
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
  lib/         Pure logic: dates, formatting, colours, summaries/metrics, quick entry, calendar aggregation,
               sessions, workout plans (plans.ts: status, building plans, the tick op builders)
  components/  UI primitives, modal host, entry editor, dialogs, check-in form, charts
  pages/       Today, Log, Calendar, Check-in, Library, Data, and plan/ (Plans, plan editor, workout)
  styles/      app.css (design tokens for light and dark, all component styles)
public/
  logo.svg     Source for the generated app icons
```

The database is on schema version 4 (v2 added saved sessions; v3 added `tombstones` and the device-local
`meta` table for sync; v4 added `plans`, and entries' optional `planId`); existing data upgrades automatically when the new version first opens, and records
saved before v3 get their sync stamps once at startup.

All writes go through `applyOps()` in `src/data/ops.ts`, which runs them in one IndexedDB transaction and
returns the inverse ops; that is how every delete offers Undo. It also stamps every write for sync and
leaves a tombstone for every deletion. To change the schema, add a new `this.version(n)` block in
`src/db/db.ts` rather than editing version 1.

See [plans/device-sync.md](plans/device-sync.md) for the sync design, and
[plans/workout-planning.md](plans/workout-planning.md) for workout planning.

See [plans/initial-implementation.md](plans/initial-implementation.md) for the initial implementation plan and data model.
