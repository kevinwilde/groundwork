import { put, type Op } from '../data/ops';
import { addDays, dayOfWeek, daysBetween, parseDate, type DateStr } from '../lib/dates';
import { clamp } from '../lib/format';
import { uid } from '../lib/ids';
import type { BodyPart, Checkin, Entry, Exercise, ExerciseType, SavedSession, Snack, Tag } from './types';

type TypeSeed = Omit<ExerciseType, 'createdAt' | 'builtin'>;

export const STARTER_TYPES: TypeSeed[] = [
  {
    id: 'type_lift', name: 'Lift', mode: 'sets', order: 1, color: '#2459D1',
    fields: [
      { key: 'reps', label: 'Reps', kind: 'int' },
      { key: 'weight', label: 'Weight', kind: 'number', unit: 'lb' },
    ],
  },
  {
    id: 'type_run', name: 'Run', mode: 'single', order: 2, color: '#EB7415',
    fields: [
      { key: 'duration', label: 'Time', kind: 'duration', plain: 'min' },
      { key: 'distance', label: 'Distance', kind: 'number', unit: 'mi' },
      { key: 'avgHr', label: 'Avg HR', kind: 'int', unit: 'bpm' },
      { key: 'maxHr', label: 'Max HR', kind: 'int', unit: 'bpm' },
      { key: 'elevation', label: 'Elevation gain', kind: 'int', unit: 'ft' },
      { key: 'rpe', label: 'RPE', kind: 'int' },
    ],
  },
  { id: 'type_hold', name: 'Timed hold', mode: 'sets', order: 3, color: '#2E9A55', fields: [{ key: 'duration', label: 'Time', kind: 'duration', plain: 's' }] },
  { id: 'type_bw', name: 'Bodyweight', mode: 'sets', order: 4, color: '#7A52D1', fields: [{ key: 'reps', label: 'Reps', kind: 'int' }] },
];

const TAGS: [string, string, string][] = [
  ['tag_lower', 'lower body', '#D7303E'],
  ['tag_upper', 'upper body', '#2459D1'],
  ['tag_glutes', 'glutes', '#C93C87'],
  ['tag_hams', 'hamstrings', '#EB7415'],
  ['tag_quads', 'quads', '#E0A800'],
  ['tag_core', 'core', '#2E9A55'],
  ['tag_push', 'push', '#2F9BDF'],
  ['tag_pull', 'pull', '#12958F'],
  ['tag_cardio', 'cardio', '#7A52D1'],
  ['tag_mobility', 'mobility', '#7F9127'],
  ['tag_calves', 'calves', '#A5552B'],
];

const EXERCISES: [string, string, string, string[], string][] = [
  ['ex_rdl', 'Romanian Deadlift', 'type_lift', ['tag_lower', 'tag_glutes', 'tag_hams'], '#D7303E'],
  ['ex_squat', 'Back Squat', 'type_lift', ['tag_lower', 'tag_quads', 'tag_glutes'], '#E0A800'],
  ['ex_bss', 'Bulgarian Split Squat', 'type_lift', ['tag_lower', 'tag_quads', 'tag_glutes'], '#A5552B'],
  ['ex_hipthrust', 'Hip Thrust', 'type_lift', ['tag_lower', 'tag_glutes'], '#C93C87'],
  ['ex_bench', 'Bench Press', 'type_lift', ['tag_upper', 'tag_push'], '#2459D1'],
  ['ex_ohp', 'Overhead Press', 'type_lift', ['tag_upper', 'tag_push'], '#2F9BDF'],
  ['ex_row', 'Barbell Row', 'type_lift', ['tag_upper', 'tag_pull'], '#12958F'],
  ['ex_pullup', 'Pull-up', 'type_bw', ['tag_upper', 'tag_pull'], '#687686'],
  ['ex_pushup', 'Push-up', 'type_bw', ['tag_upper', 'tag_push'], '#7A52D1'],
  ['ex_plank', 'Plank', 'type_hold', ['tag_core'], '#2E9A55'],
  ['ex_sideplank', 'Side Plank', 'type_hold', ['tag_core'], '#7F9127'],
  ['ex_deadbug', 'Dead Bug', 'type_bw', ['tag_core'], '#12958F'],
  ['ex_calf', 'Calf Raise', 'type_bw', ['tag_lower', 'tag_calves'], '#A5552B'],
  ['ex_couch', 'Couch Stretch', 'type_hold', ['tag_mobility'], '#7F9127'],
  ['ex_run', 'Run', 'type_run', ['tag_cardio'], '#EB7415'],
];

const SNACKS: Omit<Snack, 'active' | 'order' | 'createdAt'>[] = [
  { id: 'sn_plank', exerciseId: 'ex_plank', sets: [{ duration: 60 }], instruction: 'Hold a plank for 60 seconds. Squeeze your glutes and keep your ribs down.', perDay: 1 },
  { id: 'sn_calf', exerciseId: 'ex_calf', sets: [{ reps: 15 }, { reps: 15 }], instruction: 'Slow calf raises, 2 sets of 15. Take three seconds on the way down.', perDay: 2 },
  { id: 'sn_pushup', exerciseId: 'ex_pushup', sets: [{ reps: 15 }], instruction: 'Do 15 push-ups.', perDay: 1 },
  { id: 'sn_couch', exerciseId: 'ex_couch', sets: [{ duration: 60 }, { duration: 60 }], instruction: 'Couch stretch, 60 seconds on each side.', perDay: 1 },
  { id: 'sn_deadbug', exerciseId: 'ex_deadbug', sets: [{ reps: 10 }, { reps: 10 }], instruction: 'Dead bugs, 2 sets of 10. Keep your low back flat on the floor.', perDay: 0 },
];

const sets = <T extends object>(n: number, set: T) => Array.from({ length: n }, () => ({ ...set }));

const SESSIONS: Omit<SavedSession, 'createdAt' | 'notes' | 'order'>[] = [
  {
    id: 'ses_upper_a',
    name: 'Upper A',
    items: [
      { exerciseId: 'ex_bench', sets: sets(3, { reps: 8, weight: 115 }) },
      { exerciseId: 'ex_pullup', sets: sets(3, { reps: 6 }) },
      { exerciseId: 'ex_ohp', sets: sets(3, { reps: 6, weight: 65 }) },
    ],
  },
  {
    id: 'ses_lower_a',
    name: 'Lower A',
    items: [
      { exerciseId: 'ex_rdl', sets: sets(3, { reps: 6, weight: 95 }) },
      { exerciseId: 'ex_squat', sets: sets(3, { reps: 5, weight: 135 }) },
      { exerciseId: 'ex_calf', sets: sets(3, { reps: 15 }) },
    ],
  },
  {
    id: 'ses_full_b',
    name: 'Full body B',
    items: [
      { exerciseId: 'ex_hipthrust', sets: sets(3, { reps: 10, weight: 135 }) },
      { exerciseId: 'ex_bss', sets: sets(3, { reps: 8, weight: 25 }) },
      { exerciseId: 'ex_row', sets: sets(3, { reps: 8, weight: 95 }) },
      { exerciseId: 'ex_plank', sets: sets(3, { duration: 45 }) },
    ],
  },
];

const BODY_PARTS: Omit<BodyPart, 'createdAt' | 'notes'>[] = [
  { id: 'bp_rknee', name: 'Right knee', active: true, order: 1 },
  { id: 'bp_lperoneal', name: 'Left peroneal tendon', active: true, order: 2 },
];

export function typeOps(now = Date.now()): Op[] {
  return STARTER_TYPES.map((t) => put('types', { ...t, builtin: true, createdAt: now }));
}

/** The starter library: types, tags, exercises, mini-exercises and body parts. */
export function libraryOps(now = Date.now()): Op[] {
  return [
    ...typeOps(now),
    ...TAGS.map(([id, name, color]): Op => put('tags', { id, name, color, createdAt: now } satisfies Tag)),
    ...EXERCISES.map(([id, name, typeId, tagIds, color]): Op =>
      put('exercises', { id, name, typeId, tagIds, color, notes: '', archived: false, createdAt: now } satisfies Exercise),
    ),
    ...SNACKS.map((s, i): Op => put('snacks', { ...s, active: true, order: i, createdAt: now } satisfies Snack)),
    ...SESSIONS.map((s, i): Op => put('sessions', { ...s, notes: '', order: i, createdAt: now } satisfies SavedSession)),
    ...BODY_PARTS.map((b): Op => put('bodyParts', { ...b, notes: '', createdAt: now } satisfies BodyPart)),
  ];
}

/** Deterministic PRNG so sample data looks the same every time. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function at(date: DateStr, hour: number, minute = 0): number {
  const d = parseDate(date);
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
}

export interface SampleContext {
  today: DateStr;
  exerciseIds: Set<string>;
  snackIds: Set<string>;
  sessionIds: Set<string>;
  bodyPartIds: Set<string>;
}

/** Ten weeks of made-up history, every record flagged `sample: true`. */
export function sampleOps(ctx: SampleContext): Op[] {
  const r = rng(20260925);
  const pick = <T,>(arr: readonly T[]) => arr[Math.floor(r() * arr.length)];
  const between = (a: number, b: number) => a + r() * (b - a);
  const DAYS = 70;
  const start = addDays(ctx.today, -DAYS);
  const end = addDays(ctx.today, -1);
  const ops: Op[] = [];
  const step = (from: number, to: number, p: number, inc: number) => from + Math.round(((to - from) * p) / inc) * inc;

  const add = (date: DateStr, exerciseId: string, perf: Pick<Entry, 'sets' | 'values'>, hour: number, extra?: Partial<Entry>) => {
    if (!ctx.exerciseIds.has(exerciseId)) return;
    const entry: Entry = { id: uid('en'), exerciseId, date, notes: '', source: 'log', ...perf, ...extra, sample: true, createdAt: at(date, hour, Math.floor(r() * 50)) };
    ops.push(put('entries', entry));
  };

  // Lifting days are logged as their saved session when it exists.
  const session = (id: string): Partial<Entry> => (ctx.sessionIds.has(id) ? { sessionId: id } : {});

  const morningNotes = ['Slept well.', 'Knee stiff on the stairs this morning.', 'A bit tired, short night.', 'Feeling springy.', 'Tendon a little tender after yesterday.', '', '', '', ''];
  const postNotes = ['Knee felt fine during squats.', 'Good session, legs heavy.', 'Easy effort, felt smooth.', 'Ankle tight on the downhill.', ''];

  for (let date = start; date <= end; date = addDays(date, 1)) {
    const p = daysBetween(start, date) / DAYS;
    const dow = dayOfWeek(date);
    const skip = r() < 0.1;
    let trained = false;
    if (!skip) {
      if (dow === 1) {
        const s = session('ses_lower_a');
        add(date, 'ex_rdl', { sets: sets(3, { reps: 6, weight: step(95, 135, p, 5) }) }, 17, s);
        add(date, 'ex_squat', { sets: sets(3, { reps: 5, weight: step(135, 175, p, 5) }) }, 17, s);
        add(date, 'ex_calf', { sets: sets(3, { reps: 15 }) }, 18, s);
        trained = true;
      } else if (dow === 3) {
        const s = session('ses_upper_a');
        add(date, 'ex_bench', { sets: sets(3, { reps: 8, weight: step(115, 140, p, 5) }) }, 17, s);
        add(date, 'ex_pullup', { sets: [{ reps: step(5, 8, p, 1) }, { reps: step(5, 8, p, 1) }, { reps: step(4, 7, p, 1) }] }, 17, s);
        add(date, 'ex_ohp', { sets: sets(3, { reps: 6, weight: step(65, 85, p, 5) }) }, 18, s);
        trained = true;
      } else if (dow === 5) {
        const s = session('ses_full_b');
        add(date, 'ex_hipthrust', { sets: sets(3, { reps: 10, weight: step(135, 185, p, 10) }) }, 17, s);
        add(date, 'ex_bss', { sets: sets(3, { reps: 8, weight: step(25, 40, p, 5) }) }, 17, s);
        add(date, 'ex_row', { sets: sets(3, { reps: 8, weight: step(95, 120, p, 5) }) }, 18, s);
        add(date, 'ex_plank', { sets: sets(3, { duration: 45 }) }, 18, s);
        trained = true;
      } else if (dow === 2 || dow === 4) {
        const dist = Math.round(between(3, 4.2) * 10) / 10;
        const paceS = between(540, 555) - p * 25;
        const hr = Math.round(between(146, 156));
        add(date, 'ex_run', { values: { duration: Math.round(dist * paceS), distance: dist, avgHr: hr, maxHr: hr + Math.round(between(10, 20)), elevation: Math.round(between(40, 160)), rpe: pick([5, 5, 6, 6, 7]) } }, 7);
        trained = true;
      } else if (dow === 6) {
        const dist = Math.round((5 + p * 3 + between(-0.3, 0.3)) * 10) / 10;
        const paceS = 585 - p * 20 + between(-8, 8);
        const hr = Math.round(between(141, 149));
        add(date, 'ex_run', { values: { duration: Math.round(dist * paceS), distance: dist, avgHr: hr, maxHr: hr + Math.round(between(12, 22)), elevation: Math.round(between(150, 420)), rpe: pick([6, 6, 7]) } }, 8);
        trained = true;
      } else if (dow === 0 && r() < 0.6) {
        add(date, 'ex_couch', { sets: sets(2, { duration: 60 }) }, 10);
      }
    }
    // Movement snacks
    if (ctx.snackIds.has('sn_plank') && r() < 0.6) add(date, 'ex_plank', { sets: [{ duration: 60 }] }, 12, { source: 'snack', snackId: 'sn_plank' });
    if (ctx.snackIds.has('sn_calf') && r() < 0.35) add(date, 'ex_calf', { sets: sets(2, { reps: 15 }) }, 14, { source: 'snack', snackId: 'sn_calf' });
    if (ctx.snackIds.has('sn_pushup') && r() < 0.3) add(date, 'ex_pushup', { sets: [{ reps: 15 }] }, 15, { source: 'snack', snackId: 'sn_pushup' });

    // Check-ins: knee improves over the ten weeks, the tendon flares after runs.
    const noise = () => Math.round(between(-1, 1));
    const afterLower = dow === 2 || dow === 6 ? 1 : 0;
    const afterRun = dow === 0 || dow === 3 || dow === 5 ? 1 : 0;
    const pains: Checkin['pains'] = [];
    if (ctx.bodyPartIds.has('bp_rknee')) pains.push({ bodyPartId: 'bp_rknee', score: clamp(Math.round(5 - 4 * p) + afterLower + noise(), 0, 10) });
    if (ctx.bodyPartIds.has('bp_lperoneal')) pains.push({ bodyPartId: 'bp_lperoneal', score: clamp(Math.round(3.4 - 3 * p) + afterRun + noise(), 0, 10) });
    if (r() < 0.88) {
      const hh = 6 + Math.floor(r() * 2);
      const mm = Math.floor(r() * 60);
      ops.push(
        put('checkins', {
          id: uid('ci'), date, time: `0${hh}:${String(mm).padStart(2, '0')}`, moment: 'Morning',
          overall: clamp(Math.round(between(2.6, 4.4) + p * 0.6), 1, 5), notes: pick(morningNotes), pains, sample: true, createdAt: at(date, hh, mm),
        }),
      );
    }
    if (trained && r() < 0.35) {
      const morningRun = dow === 2 || dow === 4 || dow === 6;
      ops.push(
        put('checkins', {
          id: uid('ci'), date, time: morningRun ? '09:10' : '18:40', moment: 'Post-workout', overall: pick([4, 4, 5]), notes: pick(postNotes),
          pains: pains.map((x) => ({ ...x, score: clamp(x.score + noise(), 0, 10) })), sample: true, createdAt: at(date, morningRun ? 9 : 18, morningRun ? 10 : 40),
        }),
      );
    }
  }
  return ops;
}
