# Groundwork — implementation plan

A personal exercise tracker that runs entirely in the browser. No backend: all data lives in
IndexedDB, with JSON export/import for backups and for moving between devices.

## Stack

| Concern | Choice | Why |
| --- | --- | --- |
| Language / UI | TypeScript, React 19 | Requested |
| Build | Vite 8 + `vite-plugin-pwa` | Fast dev server; the production build is an installable, offline-capable PWA for any static host |
| Storage | Dexie 4 + `dexie-react-hooks` | Typed IndexedDB schema with versioned migrations; `useLiveQuery` re-renders the UI whenever data changes (even from another tab) |
| Routing | React Router 7 (`HashRouter`) | Works on any static host, including a sub-path, with no server rewrites |
| Dates | date-fns 4 | Local-date arithmetic and formatting; dates are stored as `yyyy-MM-dd` strings |
| Charts | Recharts 3 | Pain trends, weekly frequency, per-exercise progress |
| Dialogs | Radix Dialog | Accessible modals (focus trap, Esc, scroll lock) |
| Toasts | Sonner | Confirmation toasts with Undo |
| Validation | Zod 4 | Validates backup files before import |
| Fonts | `@fontsource/barlow`, `@fontsource/barlow-condensed` | Bundled with the app so type renders the same offline |
| Misc | `nanoid`, `clsx` | Ids, class names |
| Tests | Vitest | Unit tests for parsing, summaries, calendar aggregation and backup validation |

Styling is hand-written CSS with design tokens (light and dark themes), no CSS framework.

## Architecture

- `src/db/` — Dexie database, record types, seed data, backup (export/import) logic.
- `src/lib/` — pure functions: dates, duration/number formatting, colours, entry summaries and
  metrics, quick-entry parser, snack queue, calendar aggregation, cascading-delete op builders.
- `src/data/DataProvider.tsx` — one live query loads every table into memory and exposes typed maps
  plus derived indexes (entries by date / exercise / snack, check-ins by date) through
  `useData()`. Datasets are personal-scale, so this keeps every view synchronous and simple.
- `src/data/ops.ts` — all writes go through `applyOps()` (one Dexie transaction) which returns
  the inverse ops, giving Undo for free.
- `src/components/` — UI primitives and shared editors (entry editor, exercise / tag / snack /
  type / body-part dialogs, check-in form, day detail).
- `src/pages/` — Today, Log, Calendar, Check-in, Library, Data.

## Data model (IndexedDB database `groundwork`, Dexie schema v2)

| Table | Key / indexes | Shape |
| --- | --- | --- |
| `types` | `id` | `{ id, name, mode: 'sets' \| 'single', fields: [{ key, label, kind: 'int' \| 'number' \| 'duration' \| 'text', unit?, plain? }], color, order }` |
| `tags` | `id`, `name` | `{ id, name, color }` |
| `exercises` | `id`, `typeId`, `*tagIds` | `{ id, name, typeId, tagIds[], color, notes, archived }` |
| `entries` | `id`, `date`, `exerciseId`, `snackId`, `sessionId` (v2) | `{ id, exerciseId, date, sets?[] \| values?{}, notes, source: 'log' \| 'snack', snackId?, sessionId?, sample? }` |
| `snacks` | `id` | `{ id, exerciseId, sets? \| values?, instruction, perDay, active, order }` |
| `sessions` (v2) | `id` | `{ id, name, items: [{ exerciseId, sets? \| values? }], notes, order }` |
| `bodyParts` | `id` | `{ id, name, active, notes, order }` |
| `checkins` | `id`, `date` | `{ id, date, time, moment, overall (1–5), notes, pains: [{ bodyPartId, score 0–10 }], sample? }` |
| `views` | `id` | Saved calendar views `{ id, name, config }` |
| `settings` | `key` | `{ key, value }` (week start, last backup, seeded flag) |

Exercise types are data, not code. "Lift" is `mode: 'sets'` with Reps and Weight fields; "Run" is
`mode: 'single'` with Time, Distance, Avg HR, Max HR, Elevation and RPE. Users can edit these or
add their own (Ride, Swim, Carry…). Fields keyed `reps`, `weight`, `duration` and `distance` feed
calendar measures (volume, total time, distance) and pace.

## Checklist

### 1. Foundation
- [x] Vite + React + TypeScript project, strict `tsconfig`, npm scripts (`dev`, `build`, `preview`, `test`, `typecheck`)
- [x] Design tokens (light/dark), type scale, base styles for buttons, inputs, chips, segmented controls, cards
- [x] `lib/`: dates, durations, numbers, colours, ids
- [x] `db/`: Dexie schema and record types
- [x] `DataProvider` with derived indexes; `applyOps()` with inverse ops for Undo
- [x] `lib/model.ts`: entry summaries, pace, metrics, last-performed lookup, snack queue, cascading deletes
- [x] UI primitives: Modal, Confirm, Icon, Chip, Segmented, Field, Switch, Swatches, Empty, toasts with Undo
- [x] App shell: sidebar on desktop, bottom tab bar on phones, hash routes, theme preference

### 2. Library (definitions)
- [x] Exercise types: built-in Lift, Run, Timed hold, Bodyweight; create/edit custom types with a field editor
- [x] Tags: create, rename, recolour, delete (removed from exercises)
- [x] Exercises: type, tags (create inline), colour, notes, archive; delete with entry-count warning
- [x] Mini-exercises: linked exercise, prescription, instruction, times-per-day target, active toggle
- [x] Body parts: add, rename, mark inactive/active, delete with rating-count warning
- [x] Starter library on first run (Romanian Deadlift tagged lower body / glutes / hamstrings, Plank tagged core, a 60 s plank snack, right knee and left peroneal tendon)

### 3. Recording exercise
- [x] Entry editor driven by the exercise type: set table for set-based types, field grid for single efforts
- [x] Quick entry parser: `3x6@100`, `3 × 60s`, `5x5 225`
- [x] "Last time" reference with one-click reuse; previous values as placeholders
- [x] Pace for types with time + distance
- [x] Log page: date, searchable exercise picker with recents, create exercise on the fly, that day's entries
- [x] Edit/delete entries anywhere through a shared dialog, with Undo

### 4. Today (home)
- [x] Movement snack card: least-recently-done first, daily targets, "Another", one-tap Done that logs the library exercise
- [x] Countdown timer for timed snacks, chime at the end
- [x] Adjust-and-log for a different amount
- [x] All active snacks with today's counts
- [x] Today's training, check-in status with latest pain per body part, this-week strip

### 5. Calendar
- [x] Month view with colour-banded days and entry chips
- [x] Year view (12 mini months)
- [x] List view of matching entries
- [x] Filters: everything / tags (any or all) / exercises / types; include or hide mini-exercises
- [x] Colour by tag, exercise or type, or heat by a measure (entries, sets, reps, volume, time, distance)
- [x] Legend with per-group day counts; click to focus on one group
- [x] Stats: active days, days per week, entries, measure total, last done
- [x] Days-per-week chart (last 16 weeks) and a progress chart when one exercise is selected
- [x] Overlays: check-in markers, pain score for a chosen body part
- [x] Saved views
- [x] Day detail dialog with edit/delete and "log for this day"
- [x] Remember calendar settings between visits

### 6. Check-ins
- [x] Several per day, each with date, time and moment (Morning, Pre-workout, Post-workout, Evening, Other)
- [x] Overall feeling 1–5 and free-form notes
- [x] 0–10 pain scale for each active body part, showing the previous rating
- [x] Pain trend charts (inactive body parts behind a toggle)
- [x] History with edit/delete

### 7. Data
- [x] Export everything to JSON (download, plus copy to clipboard)
- [x] Import from file or pasted JSON with Zod validation, preview counts, merge or replace
- [x] Sample history: load/remove (flagged records only)
- [x] Storage details: counts, persistence status, last-backup reminder
- [x] Settings: week start, theme
- [x] Erase all data with typed confirmation

### 8. Quality
- [x] Vitest unit tests for pure logic
- [x] `tsc` passes with no errors; production build succeeds
- [x] Browser smoke test: create exercise, log a lift and a run, snack Done, check-in with pain, calendar filters, export/import round trip
- [x] Phone width and dark mode check

### 9. Offline (PWA)
- [x] Replace `vite-plugin-singlefile` with `vite-plugin-pwa`: Workbox service worker that precaches the whole app shell
- [x] Web app manifest: name, colours, standalone display, relative scope so it works on a sub-path
- [x] App icons generated from one SVG with `@vite-pwa/assets-generator` (favicon, 192/512, maskable, Apple touch icon)
- [x] Self-host Barlow and Barlow Condensed with `@fontsource` (latin subset) instead of Google Fonts
- [x] "New version available" prompt with Reload, "Ready to work offline" notice, hourly update check
- [x] Data page: install status, an Install button where the browser supports it, and Add to Home Screen steps for iPhone, with a note that the installed app keeps its own data
- [x] Light/dark `theme-color` and iOS home-screen meta tags
- [x] Verify: production build registers the service worker, and the app loads and saves with the server stopped (checked by hand in Chrome)
- [x] Update README (hosting requirement, install steps, how updates arrive)

### 10. Saved sessions
- [x] Data: `sessions` table (Dexie schema v2) holding a name, an ordered list of exercises and an optional planned amount per exercise; logged entries get a `sessionId`
- [x] Backups include sessions; older backups without them still import
- [x] Prefill for each exercise: what you did the last time you logged this session, else the exercise's last entry, else the plan
- [x] Log page: sessions listed above the exercise picker; picking one shows every exercise prefilled, each with its own editor and an Include switch, plus "Add exercise" for extras
- [x] "Log all" saves every included exercise in one step, with Undo
- [x] Session editor: name, exercises (add, reorder, remove), plan per exercise in quick-entry form (`3x8@135`, `2x6@100, 5@110`), notes, delete
- [x] "Save as session" from a day's logged exercises
- [x] Library → Sessions tab: times done, last done, Log now, edit
- [x] Session name shown on logged entries; calendar Show → Sessions filter
- [x] Starter sessions for new installs (Upper A: bench, pull-ups, overhead press; Lower A: RDL, squat, calf raises; Full body B), and sample history logged against them
- [x] Tests for prefill order, plan parsing/formatting, save-as-session, calendar filter and backups

## Verification notes

- `npm test`: 46 unit tests pass (duration/number parsing, quick entry, summaries and pace, metrics,
  snack queue, cascading deletes, calendar filtering/grouping/heat/weekly counts, backup validation,
  and `applyOps` write + undo and import merge/replace against `fake-indexeddb`).
- `npm run typecheck` and `npm run build` pass. The build precaches 19 files (1.25 MB; the JS bundle
  is 1.06 MB, 316 KB gzipped, most of it Recharts).
- Checked in a browser on the dev server and the production build: snack Done with Undo, snack
  timer countdown and stop, logging a lift via quick entry and a run with live pace, editing,
  deleting and undoing an entry, a check-in with two pain scores, pain trend charts, calendar tag and
  exercise filters, year/list views, heat shading, pain overlay, saved views, creating an exercise
  with a new tag, a mini-exercise and a custom type, marking a body part inactive, Copy JSON (clipboard
  fallback), erase-all with typed confirmation, replace-import round trip, and persistence across reload.
  Phone width (bottom tab bar) and dark mode were checked visually.
- Not exercised in the browser: the Export file download itself (it would have saved a file to disk)
  and the chime when a timer reaches zero.
- PWA: the build emits `sw.js`, the manifest and all icons, and the page head links them; the
  precache list covers the app shell, fonts and icons. Bundled fonts load, theme-colour tags follow
  the chosen theme, the Install card renders, and dev mode still works. The service worker itself
  could not be tested because the built-in browser pane refuses to register service workers
  (`sw.js` is served correctly as JavaScript). Offline loading was then confirmed by hand in Chrome.
- Saved sessions: 62 unit tests pass, including prefill order, plan text round trips, save-as-session,
  the calendar session filter, backups with and without sessions, and opening a v1 database as v2 with
  its data intact. In the browser: logging Upper A with one weight changed, one exercise skipped and
  one added for the day (blocked until the added one had values), Undo of the whole batch, the
  duplicate-day warning and updated prefill on reopening, Save as session with validation and
  reordering, Library → Sessions and Log now, the calendar Sessions filter, and phone width.
