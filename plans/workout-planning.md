# Groundwork: workout planning

Plan workouts ahead of time with every set's target reps, weight or time, then follow the plan at the gym, ticking off each set. Ticking a set logs it immediately. When a set doesn't go to plan, tap it, enter what you actually did, and tick it.

## Decisions (agreed 2026-10-09)

| Question | Choice |
| --- | --- |
| When is a workout saved? | **On every tick.** Each tick writes the plan and that exercise's entry together, in one `applyOps()` call. Closing the app, a locked phone or never pressing Finish loses nothing. A half-done workout shows in history as half done. |
| What happens to the existing "Log all" form? | **Kept.** `SessionLogger` stays for logging a workout afterwards. The workout screen is for logging live. A saved session gains **Start workout**, which creates a plan for today and opens it. |
| Rest timer? | **No.** Not in this version, and not sketched in the UI. |
| How many plans per day? | **Any number.** A day can have a morning run and an evening lift. Plans on the same day keep the order they were added in. |
| How far ahead? | **Any date.** The Plans page shows the next two weeks day by day, so planning the next three days means three taps on **+ Plan**. |
| Plan or saved session? | **Separate things.** A saved session ("Upper A") is a reusable template. A plan is one dated workout with its own targets, often started from a session. Editing a plan never changes the session. |
| Where do plans live in the app? | A **Plans** page at `#/plan`, reached from Today, Log and the calendar. **No new tab:** the phone tab bar already has six. |

## Concepts

- **Plan:** a dated workout. It has a name, an optional saved session it came from, exercises with planned sets, and notes.
- **Target:** the planned values for one set, such as `5 × 190 lb`, or for a single effort, such as `5 km in 25:00`.
- **Tick:** marks a set as done. A plain tick logs the target as done. Adjusting a set first logs what was actually done.
- **Status:** derived from the plan, never stored.

  | Status | When |
  | --- | --- |
  | Planned | Nothing ticked yet, and the date is today or later. |
  | Missed | Nothing ticked, the date has passed, and the plan was never finished. |
  | In progress | Some sets ticked, and not finished. |
  | Done | Finished, or every set has been ticked or skipped. |

## Data model (Dexie schema v4)

### New `plans` table, synced

```ts
/** One planned set: the target, and once ticked, what was done. */
export interface PlannedSet {
  target: SetValues;
  /** What was done. Absent until ticked. */
  done?: SetValues;
  skipped?: boolean;
}

export interface PlanItem {
  /** Stable within the plan, so ticks and React keys survive reordering. */
  key: string;
  exerciseId: string;
  /** Set-based types (lifts). */
  sets?: PlannedSet[];
  /** Single-effort types (runs): the target, and what was done. */
  target?: SetValues;
  done?: SetValues;
  skipped?: boolean;
  /** Note for this exercise today, copied into the entry. */
  notes: string;
  /** The entry this exercise's ticked sets are logged as. */
  entryId?: string | null;
}

export interface Plan extends Stamped {
  id: string;
  date: DateStr;
  name: string;
  sessionId?: string | null;
  items: PlanItem[];
  notes: string;
  /** Position among the plans on the same date. */
  order: number;
  /** Set by Finish. Ticking works without it. */
  finishedAt?: number | null;
  createdAt: number;
}
```

- **Entries:** gain an optional `planId`. As today, `sessionId` is the plan's `sessionId`, so the calendar's session filter and `prefill()` "From Upper A on …" keep working for live workouts.
- **Dexie:** add `this.version(4).stores({ plans: 'id, date' })`. Never edit the v3 block.

### Every place a new table has to be added

- `Tables`, `TABLES` (`src/db/types.ts`).
- `RawData`, `EMPTY_RAW` and `buildData` (`src/data/snapshot.ts`). Add `plans: Map`, plus `plansByDate`, sorted by `order` then `createdAt`.
- `readAll()` (`src/data/ops.ts`).
- `src/db/labels.ts`.
- **Backups:** `recordSchemas.plans` and `BACKUP_SCHEMA = 4` (`src/db/backup.ts`). Older backups import with no plans. Entries' `planId` is nullable and optional, like `sessionId`.
- **Sync layout:** plans are split by month like entries, as `plans/YYYY-MM.jsonl` (`src/sync/layout.ts`). This touches `pathOf`, `tableOfPath`, `MANAGED` and the README table the layout writes.
- **Sync format:** bump `FORMAT`. A device still on the old app would reject tombstones with `table: 'plans'`, so it should stop with the existing `newer-format` message ("update the app") instead. Check that the bump does exactly that, and nothing more, before relying on it.
- **Merge integrity:** a plan item's `exerciseId` is a soft link, like session items. Don't resurrect exercises for it. Plans whose items point at deleted exercises hide those items, as `sessionExercises()` does.
- **Test helpers** (`src/test/randomEdits.ts`, `fixtures.ts`), so the convergence tests cover plans.

### Writes

All writes are pure op builders in a new `src/lib/plans.ts`, applied with `save()`. The builders:

- **`opsTick(d, plan, itemKey, setIndex, values?)`:**
  - Sets `done` to `values`, or to a copy of the target.
  - Rewrites that exercise's entry from the item's ticked sets, in plan order, without skipped or unticked sets.
  - Creates the entry on the first tick, with `id = item.entryId ?? uid('en')`, `date = plan.date`, `source: 'log'`, `sessionId`, `planId` and `notes`.
  - Returns `[put('plans', …), put('entries', …)]`.
- **`opsUntick(…)`:** clears `done`. If no ticked sets remain for that exercise, deletes the entry and clears `entryId`.
- **`opsSetTargets(plan, itemKey, fromIndex, patch)`:** for "Use 105 for sets 3–4 too?". It changes only the targets of later sets that aren't ticked yet.
- **`opsAddSet` and `opsSkipSet`.** Also `opsSkipExercise`, which skips the remaining unticked sets, and `opsAddExercise`.
- **`opsFinish`, `opsReopen`, `opsMovePlan(date)`, `opsDuplicatePlan(date)` and `opsDeletePlan`.**
  - Duplicate copies targets only: no `done`, no `entryId`, no `finishedAt`.
  - Delete keeps logged entries. They're history.
- **`opsDeleteEntry(d, entry)`:** used by the delete button in `EntryRow` and `EntryDialog`. When the entry has a `planId`, it also clears that item's `done` values and `entryId`, in the same call. Undo restores both.

Editing a plan's entry in History is allowed. The next tick on that exercise rewrites the entry from the plan. This edge case is noted in the README.

### Derived helpers (pure, tested)

- **`planStatus(plan, today)`:** returns the status described under Concepts.
- **`planProgress(plan)`:** returns `{ done, total }`, counting sets.
- **`currentSet(plan)`:** the first set that is neither ticked nor skipped.
- **`planFromSession(d, session, date)`:** targets come from `prefill()` (the last run, then history, then the session's own plan). With no history, it uses blank sets, as many as last time or 3.
- **`planFromDay(d, date, targetDate)`:** reuses `itemsFromDay()` and copies the values as targets.
- **`bumpTargets(type, sets, step)`:** the **+5 lb** chip. The step comes from the weight field's unit: 5 for lb, 2.5 for kg.
- **`diffFromTarget(set)`:** drives the struck-through target in the UI (~~5~~ 4 × 115).

## UX

### Plans page (`#/plan`)

- **Missed:** past plans with nothing ticked from the last 14 days. Each has **Move to today** and **Delete**, with an undo toast.
- **Next 14 days:** one row per day starting today, including empty days. Each row lists that day's plan cards and has a **+ Plan** button.
- **Later:** plans beyond 14 days, by date.
- **Plan card:** shows the name, exercise names, set count and status.
  - Actions: **Start** or **Resume** (today and earlier), **Edit**, **Duplicate to…**, **Move to…** and **Delete**. Duplicate and Move use a date picker.
  - Starting a plan dated after today asks "This plan is for Sat. Move it to today and start?"
- **+ Plan:** asks where to start, then opens the editor with that date. The choices:
  - one of the saved sessions;
  - **Copy a day** (any past day with entries);
  - **Blank**.

### Plan editor (`#/plan/new?date=…&from=session:<id>|day:<date>|blank`, `#/plan/<id>/edit`)

- **It's a page, not a dialog:** five exercises with set rows are too long for a modal on a phone.
- **Fields:** date, name (defaulting to the session's name or "Workout"), notes, and the exercise list. The list supports move up/down, remove and **Add exercise**.
- **Each exercise:**
  - `EntryEditor` in `prescription` mode, which gives per-set rows plus quick entry (`3 × 5 @ 190`, `5 @ 115, 2 × 5 @ 105`);
  - a **+5 lb** chip (`bumpTargets`) for set-based types with a weight field;
  - a muted line under the exercise showing the last time it was done ("Last: 3 × 5 @ 185 · Oct 9").
- **Validation:**
  - at least one exercise;
  - targets are optional (an exercise with none gets blank sets, which open the set editor when tapped);
  - a second plan with the same name on the same day gets a warning, but isn't blocked.
- **Saving:** **Save** goes back to the Plans page, which is the planning-several-days flow. **Save and start** appears when the date is today.
- **Editing an in-progress plan** is allowed. Changing a ticked set's target doesn't change what was done.

### Workout screen (`#/plan/<id>`)

The workout is phone-first and laid out for one thumb.

- **Header:** name, date and progress ("5 of 11 sets"), with a thin progress bar, plus **Edit plan** and the plan's notes.
- **Exercises:** one block each, with the exercise header, the muted "Last: …" line and a note toggle.
- **Set rows:** the set number, the target (or what was done), and a 44 × 44 tick button with an `aria-label` such as "Set 2, 5 × 190 lb, not done".
  - **Tap the tick** on an unticked set to log it as planned. Blank targets open the set editor instead.
  - **Tap the tick** on a ticked set to untick it.
  - **Tap the row** to open the set editor inline, under the row:
    - steppers for reps (±1), weight (± the bump step), duration (±5 s) and distance (±0.1);
    - each value can also be typed;
    - buttons: **Log 4 × 115**, **Skip set**, **Remove set** (for added sets only) and **Cancel**.
    - On a ticked set, the editor changes what was done.
  - **A changed value:** if a value differs from the target and later unticked sets share the old target for that field, the editor offers a choice. For example, "Set 2 changed to 105 lb. Use it for sets 3–4 too?" with **Just this set** and **Sets 3–4**.
  - **When a set differs from its target,** the row shows the target struck through.
- **Current set:** the first unticked, unskipped set is highlighted. After a tick it scrolls into view with `block: 'nearest'`, without smooth scrolling under `prefers-reduced-motion`.
- **Per exercise:** **Add set**, which copies the last set's target, and **Skip exercise**. A finished or skipped exercise collapses to one summary line, which can be tapped to expand it.
- **Single-effort exercises (runs)** have one row, such as "Target 5 km · 25:00". The tick logs the target; the row opens field inputs, with no steppers.
- **Bottom of the screen:** an **Add exercise** select, then **Finish**.
- **Finish** sets `finishedAt` and shows a summary: sets done against planned, and each exercise that missed its target ("Overhead press: 14 of 15 reps"). **Done** returns to Today. A finished plan can be reopened.
- **Announcements:** a visually hidden `role=status` announces each tick ("Bench press set 2 logged, 5 × 190 lb").
- **No toasts on ticks:** unticking is the undo.
- **Dates:** ticks log on the plan's date. If the date has passed, the header reads "Logging to Tue, Oct 7" with a **Move to today** link.

### Today

- **A "Planned" card** at the top of the left column. It's shown when there's a plan today, a plan coming up in the next 7 days, or a missed plan.
- **Today's plans:** each with its name, progress and **Start** or **Resume**.
- **Coming up:** the next three plans, labelled "Tomorrow · Lower" or "Sat · Upper B".
- **Missed:** at most one line ("Upper A was planned for Tue"), with **Move to today**.
- **Footer:** **Plan a workout** and **All plans**, which goes to `#/plan`.
- **Ticked sets** also appear in Today's training as normal entries.

### Calendar

- **Month grid:** a day with a planned or in-progress plan gets a dashed outline. It shows only when one of the plan's exercises matches the current filter; use `makeMatcher` with a minimal entry built from the item.
- **Past plans:** a missed plan isn't drawn on the grid. Ticked sets already show as entries.
- **Year grid:** unchanged.
- **Day dialog:** lists the day's plans (status, **Start** or **Edit**) and has a **Plan a workout** button for that date.

### Log

- **Sessions picker:** **Plan for later** next to **New session**, which goes to `#/plan`.
- **`SessionLogger` header:** **Start workout**, next to **Edit session**. It creates a plan from the session for the logger's date, using `planFromSession` (the same prefill as **Log all**), then opens the workout screen.

## Checklist

### 1. Data model and storage (no visible change)

- [x] Add the `Plan`, `PlanItem` and `PlannedSet` types, and `Entry.planId`.
- [x] Add Dexie v4 with the `plans` table.
- [x] Update the snapshot (`plans`, `plansByDate`), `readAll()`, `EMPTY_RAW` and the labels.
- [x] Bump the backup schema to 4 and add `recordSchemas.plans`. A v3 backup must import with no plans.
- [ ] Sync: add the `plans/YYYY-MM.jsonl` layout and bump `FORMAT`. Check the `newer-format` behaviour on an old copy.
- [ ] Extend the test helpers and convergence tests to cover plans.

### 2. Plan logic (`src/lib/plans.ts`, pure, tested)

- [ ] Status, progress and current set.
- [ ] Build a plan from a session, from a day, or blank.
- [ ] `bumpTargets`, `diffFromTarget`.
- [ ] Op builders: tick, untick, set targets, add/skip set, skip/add exercise, finish/reopen, move, duplicate, delete.
- [ ] `opsDeleteEntry`, wired into `EntryRow` and `EntryDialog`.

### 3. Plans page and editor

- [ ] `#/plan` with the Missed, Next 14 days and Later sections, plan cards and their actions.
- [ ] **+ Plan** source picker. Plan editor page for new and existing plans.

### 4. Workout screen

- [ ] Set rows with tick and untick that save immediately.
- [ ] Inline set editor with steppers.
- [ ] The "Use it for sets 3–4 too?" prompt.
- [ ] Add/skip set, skip/add exercise.
- [ ] Single-effort rows.
- [ ] Current-set highlight and scroll.
- [ ] Live-region announcements.
- [ ] Finish summary and reopen.

### 5. Entry points

- [ ] Today: the Planned card.
- [ ] Calendar: dashed outlines and the plan list in the day dialog.
- [ ] Log: **Plan for later**, and **Start workout** in `SessionLogger`.

### 6. Docs and verification

- [ ] README: the Plans section and the edge case of editing a plan's entry in History.
- [ ] Typecheck, tests and build.
- [ ] Browser check at phone width (375 px) and desktop, light and dark:
  - plan three days ahead;
  - two plans on one day;
  - start, tick, adjust, untick and finish a plan;
  - reload mid-workout and resume;
  - delete a plan's entry from History and see the ticks clear.

## Later (not in this version)

- Keep the screen awake during a workout (Screen Wake Lock API).
- Progression rules, such as "+5 lb when every set is hit".
- Repeating plans or weekly programmes.
- Supersets and circuits.
- Reordering plans within a day.
