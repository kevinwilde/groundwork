# Groundwork

A personal exercise tracker that runs entirely in your browser and works offline once installed.
Everything is stored in IndexedDB; there is no server and no account. Back up with **Data → Export all data** and restore from the same file.

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
  home-screen app does not share data with Safari tabs. Use Data → Export / Restore to move history
  between them. Installed apps are also less likely to have their storage cleared by the browser.

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
- **Data**: export/import (merge or replace, validated with Zod), install and offline status, sample
  history, storage status, week start and theme settings, erase all.

On first run the app loads a starter library and ten weeks of **sample history** (flagged, shown with
a "sample" badge) so the calendar has something to show. Remove it from the banner or the Data page;
your own entries are never touched.

## Project layout

```
src/
  db/          Dexie schema, record types, seed data, backup (export/import)
  data/        DataProvider (live query → in-memory indexes), applyOps (writes + undo), hooks
  lib/         Pure logic: dates, formatting, colours, summaries/metrics, quick entry, calendar aggregation
  components/  UI primitives, modal host, entry editor, dialogs, check-in form, charts
  pages/       Today, Log, Calendar, Check-in, Library, Data
  styles/      app.css (design tokens for light and dark, all component styles)
public/
  logo.svg     Source for the generated app icons
```

The database is on schema version 2 (v2 added saved sessions); existing data upgrades automatically
when the new version first opens.

All writes go through `applyOps()` in `src/data/ops.ts`, which runs them in one IndexedDB transaction and
returns the inverse ops; that is how every delete offers Undo. To change the schema, add a new
`this.version(n)` block in `src/db/db.ts` rather than editing version 1.

See [plans/initial-implementation.md](plans/initial-implementation.md) for the initial implementation plan and data model.
