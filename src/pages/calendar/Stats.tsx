import { WeekBars, TrendLine } from '../../components/charts';
import { SectionHead } from '../../components/ui';
import { useData } from '../../data/DataProvider';
import { useToday } from '../../data/hooks';
import type { CalendarConfig, Entry, Exercise } from '../../db/types';
import { lastMatch, weeklyActive, type Collected } from '../../lib/calendar';
import { daysBetween, fmtShort, type DateStr } from '../../lib/dates';
import { fmtNum, niceMax, plural } from '../../lib/format';
import { entriesFor, exerciseColor, metricDef, metrics, summarizeEntry, typeOf } from '../../lib/model';
import type { CalView } from './CalendarPage';

export function Stats({ data, config, view, from, to }: { data: Collected; config: CalendarConfig; view: CalView; from: DateStr; to: DateStr }) {
  const d = useData();
  const t = useToday();
  // Averages count from when tracking began, not from January 1st.
  const firstLogged = [...d.entriesByDate.keys()].sort()[0] ?? t;
  let start = view === 'list' ? ([...data.days.keys()].sort()[0] ?? t) : from;
  if (start < firstLogged) start = firstLogged;
  const end = to < t ? to : t;
  const future = end < start;
  const span = future ? 0 : daysBetween(start, end) + 1;
  const spanNote = start > from ? ' since you started' : end < to ? ' so far' : '';
  let active = 0;
  let entries = 0;
  let total = 0;
  for (const [date, day] of data.days) {
    if (date > t) continue;
    active++;
    entries += day.entries.length;
    total += day.metric;
  }
  const last = lastMatch(d, data.match, t);
  const metric = metricDef(config.metric);
  const tiles = [
    { label: 'Active days', value: fmtNum(active), sub: view === 'list' ? 'all time' : future ? 'nothing yet' : `of ${span} days${spanNote}` },
    { label: 'Per week', value: span ? fmtNum(active / Math.max(1, span / 7), 1) : '–', sub: 'days, on average' },
    { label: 'Entries', value: fmtNum(entries), sub: config.snacks ? 'including snacks' : 'excluding snacks' },
    ...(config.metric !== 'entries' ? [{ label: metric.short, value: metric.fmt(total), sub: 'total' }] : []),
    { label: 'Last done', value: last ? (last === t ? 'Today' : `${daysBetween(last, t)} d`) : '–', sub: last ? (last === t ? fmtShort(last) : `ago · ${fmtShort(last)}`) : 'never' },
  ];
  return (
    <div className="stats">
      {tiles.map((tile) => (
        <div className="stat" key={tile.label}>
          <div className="stat-label">{tile.label}</div>
          <div className="stat-value">{tile.value}</div>
          <div className="stat-sub">{tile.sub}</div>
        </div>
      ))}
    </div>
  );
}

export function Insights({ data, config }: { data: Collected; config: CalendarConfig }) {
  const d = useData();
  const t = useToday();
  const weeks = weeklyActive(d, config, t, d.weekStart, 16);
  const single = config.colorBy !== 'heat' && data.legend.length === 1 ? data.legend[0].color : undefined;
  const bars = weeks.map((w, i) => ({
    label: i % 4 === 0 || i === weeks.length - 1 ? fmtShort(w.start).replace(/, \d{4}$/, '') : '',
    value: w.active,
    title: `Week of ${fmtShort(w.start)}`,
    current: i === weeks.length - 1,
  }));
  const ex = config.show === 'exercises' && config.exerciseIds.length === 1 ? d.exercises.get(config.exerciseIds[0]) : undefined;
  return (
    <div className="stack">
      <section className="card">
        <SectionHead title="Days per week">
          <span className="muted small">last 16 weeks · this week is lighter</span>
        </SectionHead>
        <WeekBars data={bars} color={single} />
      </section>
      {ex && <Progress exercise={ex} includeSnacks={config.snacks} />}
    </div>
  );
}

function Progress({ exercise, includeSnacks }: { exercise: Exercise; includeSnacks: boolean }) {
  const d = useData();
  const type = typeOf(d, exercise);
  const unitOf = (key: string) => type.fields.find((f) => f.key === key)?.unit ?? '';
  const keys = type.fields.map((f) => f.key);
  const measure = keys.includes('weight')
    ? { label: 'Heaviest set', unit: unitOf('weight'), get: (e: Entry) => Math.max(0, ...(e.sets ?? []).map((s) => Number(s.weight) || 0)), digits: 1 }
    : keys.includes('distance')
      ? { label: 'Distance', unit: unitOf('distance'), get: (e: Entry) => metrics(e).distance, digits: 1 }
      : keys.includes('duration')
        ? { label: 'Total time', unit: 'min', get: (e: Entry) => metrics(e).duration / 60, digits: 1 }
        : { label: 'Total reps', unit: '', get: (e: Entry) => metrics(e).reps, digits: 0 };

  const list = entriesFor(d, exercise.id)
    .filter((e) => includeSnacks || e.source !== 'snack')
    .slice(0, 40)
    .reverse();
  const color = exerciseColor(d, exercise);
  const points = list.map((e, i) => ({ x: i, y: Math.round(measure.get(e) * 10) / 10, title: `${fmtShort(e.date)}: ${summarizeEntry(d, e)}`, color })).filter((p) => p.y > 0);

  const title = `${exercise.name} · ${measure.label.toLowerCase()}`;
  if (points.length < 2) {
    return (
      <section className="card">
        <SectionHead title={title} />
        <p className="muted">Log this exercise at least twice to see a trend.</p>
      </section>
    );
  }
  const first = points[0].y;
  const lastV = points[points.length - 1].y;
  const diff = lastV - first;
  const u = measure.unit ? ` ${measure.unit}` : '';
  return (
    <section className="card">
      <SectionHead title={title}>
        <span className="muted small">
          {fmtNum(lastV, measure.digits)}
          {u} latest · {diff >= 0 ? '+' : ''}
          {fmtNum(diff, measure.digits)}
          {u} over {plural(points.length, 'session')}
        </span>
      </SectionHead>
      <TrendLine
        points={points}
        n={list.length}
        yMax={niceMax(Math.max(...points.map((p) => p.y)))}
        xLabels={[fmtShort(list[0].date), fmtShort(list[list.length - 1].date)]}
        lineColor={color}
        unit={u}
        height={180}
      />
    </section>
  );
}
