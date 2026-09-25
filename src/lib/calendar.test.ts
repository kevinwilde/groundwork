import { describe, expect, it } from 'vitest';
import { put } from '../data/ops';
import { entry, library } from '../test/fixtures';
import { collect, DEFAULT_CONFIG, describeConfig, heatLevel, lastMatch, normalizeConfig, sameConfig, weeklyActive } from './calendar';

const rdl = entry('ex_rdl', '2026-09-07', { sets: [{ reps: 6, weight: 100 }, { reps: 6, weight: 100 }] });
const squat = entry('ex_squat', '2026-09-07', { sets: [{ reps: 5, weight: 135 }] });
const bench = entry('ex_bench', '2026-09-09', { sets: [{ reps: 8, weight: 115 }] });
const runE = entry('ex_run', '2026-09-10', { values: { duration: 1800, distance: 3.2 } });
const plank = entry('ex_plank', '2026-09-10', { sets: [{ duration: 60 }] }, { source: 'snack', snackId: 'sn_plank' });
const d = library([rdl, squat, bench, runE, plank].map((e) => put('entries', e)));
const SEPT = ['2026-09-01', '2026-09-30'] as const;

describe('filtering', () => {
  it('shows everything by default', () => {
    const c = collect(d, DEFAULT_CONFIG, ...SEPT);
    expect([...c.days.keys()].sort()).toEqual(['2026-09-07', '2026-09-09', '2026-09-10']);
  });
  it('filters by tag (any)', () => {
    const c = collect(d, { ...DEFAULT_CONFIG, show: 'tags', tagIds: ['tag_lower'] }, ...SEPT);
    expect([...c.days.keys()]).toEqual(['2026-09-07']);
    expect(c.days.get('2026-09-07')!.entries).toHaveLength(2);
  });
  it('filters by tag (all)', () => {
    const c = collect(d, { ...DEFAULT_CONFIG, show: 'tags', tagIds: ['tag_lower', 'tag_hams'], tagMatch: 'all' }, ...SEPT);
    expect(c.days.get('2026-09-07')!.entries.map((e) => e.exerciseId)).toEqual(['ex_rdl']);
  });
  it('filters by exercise and hides snacks when asked', () => {
    expect([...collect(d, { ...DEFAULT_CONFIG, show: 'exercises', exerciseIds: ['ex_plank'] }, ...SEPT).days.keys()]).toEqual(['2026-09-10']);
    expect(collect(d, { ...DEFAULT_CONFIG, show: 'exercises', exerciseIds: ['ex_plank'], snacks: false }, ...SEPT).days.size).toBe(0);
  });
  it('filters by saved session', () => {
    const inSession = entry('ex_ohp', '2026-09-16', { sets: [{ reps: 6, weight: 65 }] }, { sessionId: 'ses_upper_a' });
    const withRun = library([rdl, squat, bench, runE, plank, inSession].map((e) => put('entries', e)));
    const c = collect(withRun, { ...DEFAULT_CONFIG, show: 'sessions', sessionIds: ['ses_upper_a'] }, ...SEPT);
    expect([...c.days.keys()]).toEqual(['2026-09-16']);
    expect(describeConfig(withRun, { ...DEFAULT_CONFIG, show: 'sessions', sessionIds: ['ses_upper_a'] }).what).toBe('Upper A');
  });
  it('filters by type', () => {
    const c = collect(d, { ...DEFAULT_CONFIG, show: 'types', typeIds: ['type_run'] }, ...SEPT);
    expect([...c.days.keys()]).toEqual(['2026-09-10']);
  });
  it('respects the date range', () => {
    expect(collect(d, DEFAULT_CONFIG, '2026-09-08', '2026-09-09').days.size).toBe(1);
  });
});

describe('colour groups and legend', () => {
  it('counts days per tag and orders by frequency', () => {
    const c = collect(d, DEFAULT_CONFIG, ...SEPT);
    const lower = c.legend.find((g) => g.id === 'tag_lower')!;
    expect(lower.days).toBe(1);
    const glutes = c.legend.find((g) => g.id === 'tag_glutes')!;
    expect(glutes.days).toBe(1); // RDL and squat share glutes on the same day: one day
    const days = c.legend.map((g) => g.days);
    expect([...days].sort((a, b) => b - a)).toEqual(days);
  });
  it('limits tag colours to the selected tags', () => {
    const c = collect(d, { ...DEFAULT_CONFIG, show: 'tags', tagIds: ['tag_hams', 'tag_quads'] }, ...SEPT);
    expect(c.legend.map((g) => g.id).sort()).toEqual(['tag_hams', 'tag_quads']);
    expect(c.days.get('2026-09-07')!.groups.map((g) => g.id).sort()).toEqual(['tag_hams', 'tag_quads']);
  });
  it('groups by exercise or type', () => {
    expect(collect(d, { ...DEFAULT_CONFIG, colorBy: 'exercise' }, ...SEPT).legend).toHaveLength(5);
    expect(collect(d, { ...DEFAULT_CONFIG, colorBy: 'type' }, ...SEPT).legend.map((g) => g.id).sort()).toEqual(['type_hold', 'type_lift', 'type_run']);
  });
  it('sums the chosen measure per day for heat', () => {
    const c = collect(d, { ...DEFAULT_CONFIG, colorBy: 'heat', metric: 'volume' }, ...SEPT);
    expect(c.days.get('2026-09-07')!.metric).toBe(6 * 100 * 2 + 5 * 135);
    expect(c.max).toBe(1875);
    expect(heatLevel(1875, c.max)).toBe(4);
    expect(heatLevel(920, c.max)).toBe(2);
    expect(heatLevel(0, c.max)).toBe(0);
  });
});

describe('summaries over time', () => {
  it('counts active days per week', () => {
    const weeks = weeklyActive(d, DEFAULT_CONFIG, '2026-09-12', 0, 2);
    expect(weeks.map((w) => w.start)).toEqual(['2026-08-30', '2026-09-06']);
    expect(weeks.map((w) => w.active)).toEqual([0, 3]);
  });
  it('finds the last matching day', () => {
    const c = collect(d, { ...DEFAULT_CONFIG, show: 'exercises', exerciseIds: ['ex_rdl'] }, ...SEPT);
    expect(lastMatch(d, c.match, '2026-09-25')).toBe('2026-09-07');
  });
  it('describes and compares configs', () => {
    expect(describeConfig(d, { ...DEFAULT_CONFIG, show: 'tags', tagIds: ['tag_lower', 'tag_core'], tagMatch: 'all' }).what).toBe('lower body + core');
    expect(sameConfig(normalizeConfig({ show: 'all' }), DEFAULT_CONFIG)).toBe(true);
    expect(sameConfig(normalizeConfig({ colorBy: 'heat' }), DEFAULT_CONFIG)).toBe(false);
  });
});
